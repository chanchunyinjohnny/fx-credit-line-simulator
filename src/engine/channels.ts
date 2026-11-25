import type { AppState, Channel, Lp, Product } from './types';

/** When the desk learns the counterparty on a channel.
 *  BEFORE: before the trade is final, so each hedge is checked against that one LP.
 *  AFTER: from the fill. The desk cannot choose the counterparty, so an order is
 *  checked against every counterparty that could fill it. */
export interface ChannelInfo {
  label: string;
  disclosed: 'BEFORE' | 'AFTER';
  /** The one product this app sends to the channel. */
  only?: Product;
}

export const CHANNELS: Record<Channel, ChannelInfo> = {
  '360T': { label: '360T', disclosed: 'BEFORE' },
  FXGO: { label: 'FXGO', disclosed: 'BEFORE' },
  EBSM: { label: 'EBS Market', disclosed: 'AFTER', only: 'NDF' },
};

/** Whether the desk checks and reserves before it places an order on this channel's book. */
export const checksBook = (s: AppState, channel: Channel) => !s.bookCheckOff.includes(channel);

/** The counterparties an order on this channel could fill with: those still switched on there. */
export const openOn = (s: AppState, channel: Channel): Lp[] => s.lps.filter((l) => l.channel === channel && !s.channelOff.includes(l.id));
