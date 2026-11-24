#!/usr/bin/env python3
"""Reference values for the FX Credit Line Simulator, computed with QuantLib.

Writes two files into src/data/:
  holidays.json  weekday holidays per currency, from QuantLib's calendars
  golden.json    value dates, forward rates, discount factors and trade market
                 values that the app's own engine must reproduce (see tests/)

What QuantLib decides here:
  - which days are holidays, and tenor date arithmetic (JointCalendar.advance)
  - the market value of each FX forward leg (FxForward + DiscountingFxForwardEngine)
What this script decides on its own, as a second implementation of the same
written rule as the app (src/engine/calendar.ts, src/engine/market.ts):
  - the T+2 spot-date rule, linear interpolation of swap points, and the simple
    Act/360 USD discount factor

Run:  npm run oracle
"""
import json
import pathlib

import QuantLib as ql

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "src" / "data"
REF = json.loads((DATA / "reference.json").read_text())
MKT = json.loads((DATA / "market.json").read_text())

CALS = {
    "USD": ql.UnitedStates(ql.UnitedStates.FederalReserve),
    "EUR": ql.TARGET(),
    "GBP": ql.UnitedKingdom(),
    "JPY": ql.Japan(),
    "CNH": ql.HongKong(),
    "TWD": ql.Taiwan(),
}
QL_CCY = {
    "USD": ql.USDCurrency(), "EUR": ql.EURCurrency(), "GBP": ql.GBPCurrency(),
    "JPY": ql.JPYCurrency(), "CNH": ql.CNHCurrency(), "TWD": ql.TWDCurrency(),
}
FAR_TENORS = ["SN", "1W", "1M", "2M", "3M", "6M", "9M", "1Y"]


def qd(s):
    y, m, d = map(int, s.split("-"))
    return ql.Date(d, m, y)


def iso(d):
    return f"{d.year():04d}-{d.month():02d}-{d.dayOfMonth():02d}"


# ---------------------------------------------------------------- calendars
def export_holidays(first_year=2026, last_year=2029):
    out = {}
    for ccy, cal in CALS.items():
        days = cal.holidayList(ql.Date(1, 1, first_year), ql.Date(31, 12, last_year), False)
        out[ccy] = [iso(d) for d in days]
    return out


def pair_ccys(pair):
    p = REF["pairs"][pair]
    return [p["base"], p["quote"]]


def all_ccys(pair):
    return sorted(set(pair_ccys(pair) + ["USD"]))


def good(d, ccys):
    return all(CALS[c].isBusinessDay(d) for c in ccys)


def next_good(d, ccys):
    d = d + 1
    while not good(d, ccys):
        d = d + 1
    return d


def tom_date(t0, pair):
    return next_good(t0, all_ccys(pair))


def spot_date(t0, pair):
    """T+2. The first day only has to be a business day for the non-USD
    currency; the spot date itself must be good for both currencies and USD."""
    non_usd = [c for c in pair_ccys(pair) if c != "USD"]
    return next_good(next_good(t0, non_usd), all_ccys(pair))


def joint(pair):
    return ql.JointCalendar(*[CALS[c] for c in all_ccys(pair)])


def tenor_date(spot, tenor, pair):
    cal = joint(pair)
    if tenor == "SN":
        return cal.advance(spot, 1, ql.Days, ql.Following)
    if tenor.endswith("W"):
        return cal.advance(spot, ql.Period(int(tenor[:-1]), ql.Weeks), ql.Following, False)
    months = 12 if tenor == "1Y" else int(tenor[:-1])
    return cal.advance(spot, ql.Period(months, ql.Months), ql.ModifiedFollowing, True)


# ------------------------------------------------------------- market data
def forward(t0, pair, d):
    """Outright rate for value date d: spot plus swap points, interpolated
    linearly in calendar days between the quoted tenor dates."""
    spot_rate = MKT["pairs"][pair]["spot"]
    pts = MKT["pairs"][pair]["points"]
    pip = REF["pairs"][pair]["pip"]
    tom, spot = tom_date(t0, pair), spot_date(t0, pair)
    if d >= spot:
        nodes = [(spot, 0.0)] + [(tenor_date(spot, t, pair), pts[t] * pip) for t in FAR_TENORS]
        for (d0, p0), (d1, p1) in zip(nodes, nodes[1:]):
            if d <= d1:
                return spot_rate + p0 + (p1 - p0) * (d - d0) / (d1 - d0)
        (d0, p0), (d1, p1) = nodes[-2], nodes[-1]
        return spot_rate + p1 + (p1 - p0) * (d - d1) / (d1 - d0)
    if tom < spot:
        if d == tom:
            return spot_rate - pts["TN"] * pip
        if d == t0:
            return spot_rate - (pts["TN"] + pts["ON"]) * pip
    elif d == t0:
        return spot_rate - pts["ON"] * pip
    raise ValueError(f"{iso(d)} is not a value date for {pair} on {iso(t0)}")


RATE_NODES = sorted((days, MKT["usdRates"][t] / 100.0) for t, days in REF["usdRateNodeDays"].items())


def usd_rate(n):
    if n <= RATE_NODES[0][0]:
        return RATE_NODES[0][1]
    for (n0, r0), (n1, r1) in zip(RATE_NODES, RATE_NODES[1:]):
        if n <= n1:
            return r0 + (r1 - r0) * (n - n0) / (n1 - n0)
    return RATE_NODES[-1][1]


def df_usd(t0, d):
    n = d - t0
    return 1.0 if n <= 0 else 1.0 / (1.0 + usd_rate(n) * n / 360.0)


# ---------------------------------------------------------------- pricing
def leg_mv_usd(t0, pair, base_amount, rate, d):
    """Market value in USD of one leg: we receive base_amount of the base
    currency (pay if negative) and pay base_amount * rate of the quote
    currency on d. Priced by QuantLib's FX forward engine."""
    p = REF["pairs"][pair]
    x0 = forward(t0, pair, t0)  # FX rate for value today
    if d == t0:
        # Settles today: nothing to discount and QuantLib treats it as expired.
        v_quote = base_amount * (x0 - rate)
        return v_quote if p["quote"] == "USD" else v_quote / x0
    ql.Settings.instance().evaluationDate = t0
    f, dfu, dc = forward(t0, pair, d), df_usd(t0, d), ql.Actual360()
    usd_curve = ql.YieldTermStructureHandle(ql.DiscountCurve([t0, d], [1.0, dfu], dc))
    pay_source = base_amount < 0
    n = abs(base_amount)
    spot_quote = ql.QuoteHandle(ql.SimpleQuote(x0))
    if p["quote"] == "USD":
        # Covered interest parity gives the base-currency discount factor.
        base_curve = ql.YieldTermStructureHandle(ql.DiscountCurve([t0, d], [1.0, f / x0 * dfu], dc))
        fwd = ql.FxForward(n, QL_CCY[p["base"]], n * rate, QL_CCY["USD"], d, pay_source, 0, ql.NullCalendar())
        fwd.setPricingEngine(ql.DiscountingFxForwardEngine(base_curve, usd_curve, spot_quote))
        return fwd.npvTargetCurrency()
    quote_curve = ql.YieldTermStructureHandle(ql.DiscountCurve([t0, d], [1.0, x0 / f * dfu], dc))
    fwd = ql.FxForward(n, QL_CCY["USD"], n * rate, QL_CCY[p["quote"]], d, pay_source, 0, ql.NullCalendar())
    fwd.setPricingEngine(ql.DiscountingFxForwardEngine(usd_curve, quote_curve, spot_quote))
    return fwd.npvSourceCurrency()


# ----------------------------------------------------------------- golden
TRADE_DATES = [
    "2026-11-24", "2026-11-25", "2026-11-30", "2026-12-23", "2026-12-29", "2027-01-27",
    "2027-02-24", "2027-03-29", "2027-06-28", "2027-11-23", "2027-11-24",
]


def golden_dates():
    rows = []
    for pair in REF["pairs"]:
        for td in TRADE_DATES:
            t0 = qd(td)
            spot = spot_date(t0, pair)
            row = {"pair": pair, "tradeDate": td, "tom": iso(tom_date(t0, pair)), "spot": iso(spot)}
            for t in FAR_TENORS:
                row[t] = iso(tenor_date(spot, t, pair))
            rows.append(row)
    return rows


def golden_scenario(business_date, legs):
    t0 = qd(business_date)
    forwards, dfs, seen = [], [], set()
    for pair in REF["pairs"]:
        spot = spot_date(t0, pair)
        dates = [t0, tom_date(t0, pair), spot] + [tenor_date(spot, t, pair) for t in FAR_TENORS]
        dates += [spot + 10, spot + 45, spot + 200, spot + 300]
        for d in sorted(set(dates)):
            forwards.append({"pair": pair, "date": iso(d), "forward": forward(t0, pair, d)})
            if d not in seen:
                seen.add(d)
                dfs.append({"date": iso(d), "df": df_usd(t0, d)})
    priced = []
    for leg in legs:
        d = qd(leg["date"])
        if d < t0:
            continue
        priced.append({**leg, "mvUsd": leg_mv_usd(t0, leg["pair"], leg["base"], leg["rate"], d)})
    return {"businessDate": business_date, "forwards": forwards, "dfs": sorted(dfs, key=lambda x: x["date"]), "legs": priced}


def sample_legs():
    """Legs dealt on 2026-11-30 at rates a little away from the market, so every
    market value is non-zero. Each swap contributes its near and far leg."""
    t0 = qd("2026-11-30")
    legs = []

    def add(pair, base, tenor, bump_pips, near=None):
        pip = REF["pairs"][pair]["pip"]
        spot = spot_date(t0, pair)
        far = tenor_date(spot, tenor, pair) if tenor not in ("ON", "TN") else (tom_date(t0, pair) if tenor == "ON" else spot)
        if near is not None:
            nd = {"today": t0, "tom": tom_date(t0, pair), "spot": spot}[near]
            legs.append({"pair": pair, "base": base, "rate": round(forward(t0, pair, nd) + bump_pips * pip, 8), "date": iso(nd)})
            base = -base
        legs.append({"pair": pair, "base": base, "rate": round(forward(t0, pair, far) - bump_pips * pip, 8), "date": iso(far)})

    add("EURUSD", 20_000_000, "3M", 12.5, near="spot")     # buy/sell swap
    add("EURUSD", -35_000_000, "1Y", -40.0, near="spot")    # sell/buy swap
    add("EURUSD", 10_000_000, "ON", 0.3, near="today")      # overnight swap
    add("GBPUSD", 15_000_000, "6M", 25.0)                   # outright forward, buy
    add("GBPUSD", -50_000_000, "1M", -8.0, near="spot")
    add("USDJPY", 25_000_000, "9M", 30.0, near="spot")
    add("USDJPY", -5_000_000, "2M", -15.0)                  # outright forward, sell
    add("USDCNH", 20_000_000, "3M", 60.0, near="spot")
    add("USDCNH", -30_000_000, "TN", -1.0, near="tom")      # tom-next swap
    add("USDTWD", 10_000_000, "6M", 45.0)                   # NDF, buy
    add("USDTWD", -8_000_000, "1Y", -90.0)                  # NDF, sell
    return legs


def main():
    (DATA / "holidays.json").write_text(json.dumps(export_holidays(), indent=1) + "\n")
    legs = sample_legs()
    golden = {
        "generatedWith": f"QuantLib {ql.__version__}",
        "dates": golden_dates(),
        "scenarios": [golden_scenario(bd, legs) for bd in ("2026-11-30", "2026-12-15", "2027-02-26")],
    }
    (DATA / "golden.json").write_text(json.dumps(golden, indent=1) + "\n")
    n_fwd = sum(len(s["forwards"]) for s in golden["scenarios"])
    n_leg = sum(len(s["legs"]) for s in golden["scenarios"])
    print(f"QuantLib {ql.__version__}: {len(golden['dates'])} date rows, {n_fwd} forwards, {n_leg} priced legs")


if __name__ == "__main__":
    main()
