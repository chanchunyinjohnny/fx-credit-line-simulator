import type { Channel, PairId, Product, Tenor } from './types';

/** Who checks credit before a trade on a channel is final.
 *  OMS: the desk knows the counterparty and checks its own credit line first.
 *  CHANNEL: the channel matches against a limit it holds and does not ask; the
 *  desk learns the counterparty from the fill. */
export interface ChannelInfo {
  label: string;
  checkedBy: 'OMS' | 'CHANNEL';
  /** The one order the desk sends to a channel that checks credit itself. Room
   *  held for the channel is sized on this order's add-on. */
  only?: { product: Product; pair: PairId; tenor: Tenor };
}

export const CHANNELS: Record<Channel, ChannelInfo> = {
  '360T': { label: '360T', checkedBy: 'OMS' },
  FXGO: { label: 'FXGO', checkedBy: 'OMS' },
  EBSM: { label: 'EBS Market', checkedBy: 'CHANNEL', only: { product: 'NDF', pair: 'USDTWD', tenor: '1M' } },
};
