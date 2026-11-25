export type ISODate = string; // 'YYYY-MM-DD'
export type Ccy = 'USD' | 'EUR' | 'GBP' | 'JPY' | 'CNH' | 'TWD';
export type PairId = 'EURUSD' | 'GBPUSD' | 'USDJPY' | 'USDCNH' | 'USDTWD';
export type Tenor = 'ON' | 'TN' | 'SN' | '1W' | '1M' | '2M' | '3M' | '6M' | '9M' | '1Y';
export type RateTenor = 'ON' | '1W' | '1M' | '2M' | '3M' | '6M' | '9M' | '1Y';
export type Product = 'SWAP' | 'FORWARD' | 'NDF';
/** Of the base currency. For a swap it describes the near leg: BUY is buy/sell. */
export type Side = 'BUY' | 'SELL';
/** CLS: payment-versus-payment. GROSS: each side pays separately. CASH: one net payment (NDF). */
export type Settlement = 'CLS' | 'GROSS' | 'CASH';
/** UNFILLED: the order was filled with another counterparty, or with none, and this reservation was released. */
export type TradeStatus = 'IN_FLIGHT' | 'FILLED' | 'REJECTED' | 'UNFILLED' | 'EXPIRED';
export type Channel = '360T' | 'FXGO' | 'EBSM';

export interface PairInfo {
  label: string;
  base: Ccy;
  quote: Ccy;
  pip: number;
  dp: number;
  cls: boolean;
  deliverable: boolean;
}

export interface MarketData {
  usdRates: Record<RateTenor, number>; // percent, simple, Act/360
  pairs: Record<PairId, { spot: number; points: Record<Tenor, number> }>; // points in pips
}

/** One exchange: on `date` we receive `base` of the base currency (pay if negative)
 *  and pay `base * rate` of the quote currency. */
export interface Leg {
  date: ISODate;
  base: number;
  rate: number;
}

export interface Trade {
  id: string;
  product: Product;
  pair: PairId;
  tenor: Tenor;
  side: Side;
  amount: number; // base currency, unsigned
  legs: Leg[]; // one for a forward or NDF; near then far for a swap
  lpId: string;
  tradeDate: ISODate;
  settlement: Settlement;
  status: TradeStatus;
  /** Set when one order could fill with several counterparties: each of them carries a reservation for it. */
  orderId?: string;
}

/** The banking group that holds the credit lines. */
export interface Group {
  id: string;
  name: string;
  closeOutNetting: boolean; // market values offset across trades when measuring PSR
  paymentNetting: boolean; // same-currency flows on one date offset when measuring SR
  psrLines: number[]; // USD, one per time pillar
  srLine: number; // USD, the same for every settlement date
}

/** A legal entity of a group, as reached on one channel. */
export interface Lp {
  id: string;
  name: string;
  channel: Channel;
  groupId: string;
}

export interface AppState {
  businessDate: ISODate;
  market: MarketData;
  groups: Group[];
  lps: Lp[];
  /** LPs switched off on a channel that discloses after the trade: the channel will not match the desk with them. */
  channelOff: string[];
  /** Channels that disclose after the trade where the desk has switched its own check off: orders there are
   *  neither checked nor reserved, and a fill is booked when the channel reports it. */
  bookCheckOff: Channel[];
  addOnPct: number[]; // percent of notional, one per time pillar
  /** Internal variant: a negative market value reduces the add-on. Off is the standard method. */
  offsetNegativeMv?: boolean;
  trades: Trade[];
  nextId: number;
}

export interface Ticket {
  product: Product;
  pair: PairId;
  side: Side;
  amount: number;
  tenor: Tenor;
  lpId: string; // the LP the hedge is sent to
  /** Set when the order goes to a channel that discloses after the trade: the desk cannot choose the LP. */
  book?: Channel;
  settlement: 'AUTO' | Settlement;
}
