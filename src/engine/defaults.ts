import marketJson from '../data/market.json';
import type { AppState, MarketData } from './types';

export const START_DATE = '2026-11-30';
const M = 1_000_000;

/** The starting state. Every name, credit line, add-on and price is invented.
 *  Close-out netting starts off for every group: utilisation is measured gross until someone switches it on. */
export function defaultState(): AppState {
  const market: MarketData = structuredClone({ usdRates: marketJson.usdRates, pairs: marketJson.pairs });
  const group = (id: string, name: string, closeOutNetting: boolean, paymentNetting: boolean, psr: number[], sr: number) => ({
    id,
    name,
    closeOutNetting,
    paymentNetting,
    psrLines: psr.map((x) => x * M),
    srLine: sr * M,
  });
  return {
    businessDate: START_DATE,
    market,
    groups: [
      group('A', 'Bank A Group', false, true, [8, 8, 6, 5, 3, 2], 60),
      group('B', 'Bank B', false, false, [5, 5, 4, 3, 2, 1], 40),
      group('C', 'Bank C', false, false, [3, 3, 2, 1.5, 1, 0.5], 25),
      group('D', 'Bank D', false, true, [4, 4, 3, 2, 1, 0], 30),
      group('E', 'Bank E', false, false, [2, 2, 1.5, 1, 0.5, 0], 20),
    ],
    lps: [
      { id: 'A-LDN-360T', name: 'Bank A London', channel: '360T', groupId: 'A' },
      { id: 'A-LDN-FXGO', name: 'Bank A London', channel: 'FXGO', groupId: 'A' },
      { id: 'A-FFT-360T', name: 'Bank A Frankfurt', channel: '360T', groupId: 'A' },
      { id: 'B-360T', name: 'Bank B', channel: '360T', groupId: 'B' },
      { id: 'B-FXGO', name: 'Bank B', channel: 'FXGO', groupId: 'B' },
      { id: 'C-FXGO', name: 'Bank C', channel: 'FXGO', groupId: 'C' },
      { id: 'D-360T', name: 'Bank D', channel: '360T', groupId: 'D' },
      { id: 'E-360T', name: 'Bank E', channel: '360T', groupId: 'E' },
      { id: 'E-FXGO', name: 'Bank E', channel: 'FXGO', groupId: 'E' },
      { id: 'A-LDN-EBSM', name: 'Bank A London', channel: 'EBSM', groupId: 'A' },
      { id: 'B-EBSM', name: 'Bank B', channel: 'EBSM', groupId: 'B' },
    ],
    // USD 1m and 0.5m of room at the 1M add-on of 1%.
    channelLimits: [
      { channel: 'EBSM', groupId: 'A', limitUsd: 100 * M },
      { channel: 'EBSM', groupId: 'B', limitUsd: 50 * M },
    ],
    addOnPct: [0.2, 0.5, 1.0, 2.0, 3.0, 4.5],
    offsetNegativeMv: false,
    trades: [],
    nextId: 1,
  };
}
