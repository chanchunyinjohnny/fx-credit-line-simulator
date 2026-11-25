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
export type TradeStatus = 'IN_FLIGHT' | 'FILLED' | 'REJECTED' | 'EXPIRED';
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

/** What the desk keeps available with one group on a channel that checks credit
 *  itself: the most the channel can fill before the desk hears of it. The desk
 *  tops it up after each fill for as long as the group's lines have room. */
export interface ChannelBuffer {
  channel: Channel;
  groupId: string;
  keepUsd: number; // notional of the largest trade the channel may fill; the desk keeps this much available there
}

export interface AppState {
  businessDate: ISODate;
  market: MarketData;
  groups: Group[];
  lps: Lp[];
  channelBuffers: ChannelBuffer[];
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
  lpId: string;
  settlement: 'AUTO' | Settlement;
}
