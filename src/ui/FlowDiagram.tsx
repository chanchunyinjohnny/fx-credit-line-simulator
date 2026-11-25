import { useLang, type Lang } from './i18n';

// Two flowcharts of the hedging flow, drawn on one shared geometry so they can
// be compared side by side. Shape carries the node type: oval for start and end,
// rectangle for a step, diamond for a decision. The accent marks what is new.

const INK = '#30343a';
const MUTED = '#676d76';
const PAPER = '#fafaf7';
const ACCENT = '#2148b8';
const TINT = 'rgba(33,72,184,0.08)';
const SOFT_FILL = 'rgba(48,52,58,0.03)';
const SOFT_STROKE = 'rgba(48,52,58,0.30)';
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang TC', 'Microsoft JhengHei', sans-serif";

const CX = 152; // centre line of the main path
const W = 240; // step width
const X = CX - W / 2;
const H = 48; // node height
const Y = { start: 24, external: 144, check: 224, ask: 296, pick: 368, accepts: 488, filled: 568, daily: 648 };
const LOOP_X = 396; // channel the "not accepted" path runs back up

interface Copy {
  title: string;
  desc: string;
  check: [string, string];
  ask: [string, string];
  pick: [string, string?];
  loop: string;
  filled: [string, string];
  daily?: [string, string];
}
interface Shared {
  start: string;
  external: string;
  noCheck: string;
  accepts: string;
  yes: string;
  no: string;
  legend: string;
}

const SHARED: Record<Lang, Shared> = {
  en: { start: 'Start a hedge', external: 'External hedge?', noCheck: 'No check', accepts: 'LP accepts?', yes: 'YES', no: 'NO', legend: 'New in the proposal' },
  zh: { start: '開始對沖', external: '對外對沖？', noCheck: '無需檢查', accepts: 'LP 接受？', yes: '是', no: '否', legend: '建議新增的步驟' },
};

const COPY: Record<Lang, Record<'draft' | 'proposed', Copy>> = {
  en: {
    draft: {
      title: 'First draft of the hedging flow',
      desc: 'Flowchart: an external hedge is checked against a limit kept per LP, prices are requested, the best LP is picked, and on a fill the trade size comes off the limit.',
      check: ['Check the limit', 'per LP; a trader can edit it'],
      ask: ['Ask LPs with limit', '360T stream · FXGO quote'],
      pick: ['Pick the best single LP'],
      loop: 'NO: NEXT BEST',
      filled: ['Filled', 'trade size comes off the limit'],
    },
    proposed: {
      title: 'Proposed hedging flow',
      desc: 'Flowchart: an external hedge gets an initial check on both risk measures per banking group, the picked LP is checked again and its room reserved, a rejection releases the reservation, a fill turns it into usage, and open hedges are revalued each day.',
      check: ['Initial check', 'both risk measures, per group'],
      ask: ['Ask LPs that fit', '360T stream · FXGO quote'],
      pick: ['Pick best LP and reserve', 'checked again, in one step'],
      loop: 'RELEASE, NEXT',
      filled: ['Filled', 'reservation becomes usage'],
      daily: ['Each day', 'revalue what is still open'],
    },
  },
  zh: {
    draft: {
      title: '對沖流程初稿',
      desc: '流程圖：對外對沖先對照按 LP 記錄的額度，再詢價、選出最佳 LP，成交後從額度扣除交易金額。',
      check: ['檢查額度', '按 LP 記錄，交易員可修改'],
      ask: ['向有額度的 LP 詢價', '360T 串流報價 · FXGO 詢價'],
      pick: ['選出最佳的單一 LP'],
      loop: '否：下一家',
      filled: ['成交', '從額度扣除交易金額'],
    },
    proposed: {
      title: '建議的對沖流程',
      desc: '流程圖：對外對沖先按銀行集團對兩種風險做初步檢查；選定 LP 後再檢查一次並預佔額度；被拒即釋放；成交後預佔轉為已用額度；未到期的對沖每日重估。',
      check: ['初步檢查', '兩種風險，按銀行集團'],
      ask: ['向放得進的 LP 詢價', '360T 串流報價 · FXGO 詢價'],
      pick: ['選最佳 LP 並預佔額度', '再檢查一次，一步完成'],
      loop: '釋放，下一家',
      filled: ['成交', '預佔轉為已用額度'],
      daily: ['每日', '重估未到期的對沖'],
    },
  },
};

const nameText = { fill: INK, fontSize: 13, fontWeight: 600, fontFamily: FONT, textAnchor: 'middle' as const };
const subText = { fill: MUTED, fontSize: 12, fontFamily: FONT, textAnchor: 'middle' as const };

function StepBox({ y, name, sub, focal }: { y: number; name: string; sub?: string; focal?: boolean }) {
  return (
    <>
      <rect x={X} y={y} width={W} height={H} rx={6} fill={PAPER} />
      <rect x={X} y={y} width={W} height={H} rx={6} fill={focal ? TINT : '#ffffff'} stroke={focal ? ACCENT : INK} strokeWidth={1} />
      <text x={CX} y={sub ? y + 21 : y + 29} {...nameText}>
        {name}
      </text>
      {sub && (
        <text x={CX} y={y + 38} {...subText}>
          {sub}
        </text>
      )}
    </>
  );
}

function Oval({ x, y, w, name }: { x: number; y: number; w: number; name: string }) {
  return (
    <>
      <rect x={x} y={y} width={w} height={H} rx={20} fill={PAPER} />
      <rect x={x} y={y} width={w} height={H} rx={20} fill={SOFT_FILL} stroke={SOFT_STROKE} strokeWidth={1} />
      <text x={x + w / 2} y={y + 29} {...nameText}>
        {name}
      </text>
    </>
  );
}

function Diamond({ cy, name }: { cy: number; name: string }) {
  return (
    <>
      <polygon points={`${CX},${cy - 48} ${CX + 100},${cy} ${CX},${cy + 48} ${CX - 100},${cy}`} fill="#ffffff" stroke={INK} strokeWidth={1} />
      <text x={CX} y={cy + 5} {...nameText}>
        {name}
      </text>
    </>
  );
}

/** A connector label on an opaque mask, kept 8px clear of its line. */
function Label({ x, y, w, text }: { x: number; y: number; w: number; text: string }) {
  return (
    <>
      <rect x={x} y={y} width={w} height={16} rx={2} fill={PAPER} />
      <text x={x + w / 2} y={y + 12} fill={MUTED} fontSize={12} fontWeight={500} fontFamily={FONT} textAnchor="middle" letterSpacing="0.04em">
        {text}
      </text>
    </>
  );
}

export function FlowDiagram({ variant }: { variant: 'draft' | 'proposed' }) {
  const lang = useLang();
  const c = COPY[lang][variant];
  const s = SHARED[lang];
  const id = `flow-${variant}`;
  const proposed = variant === 'proposed';
  const line = { stroke: MUTED, strokeWidth: 1.2, markerEnd: `url(#${id}-arrow)` };
  const down = (from: number, to: number) => <line x1={CX} y1={from} x2={CX} y2={to} {...line} />;
  return (
    <div className="diagram">
      <svg viewBox={`0 0 448 ${c.daily ? 760 : 640}`} xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby={`${id}-title ${id}-desc`}>
        <title id={`${id}-title`}>{c.title}</title>
        <desc id={`${id}-desc`}>{c.desc}</desc>
        <defs>
          <marker id={`${id}-arrow`} markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill={MUTED} />
          </marker>
        </defs>
        <rect width="100%" height="100%" fill={PAPER} />

        {/* Connectors first, so they sit behind the nodes. */}
        {down(Y.start + H, Y.external - 48)}
        <line x1={CX + 100} y1={Y.external} x2={304} y2={Y.external} {...line} />
        {down(Y.external + 48, Y.check)}
        {down(Y.check + H, Y.ask)}
        {down(Y.ask + H, Y.pick)}
        {down(Y.pick + H, Y.accepts - 48)}
        <path
          d={`M${CX + 100},${Y.accepts} H${LOOP_X - 8} a8,8 0 0 0 8,-8 V${Y.pick + H / 2 + 8} a8,8 0 0 0 -8,-8 H${X + W}`}
          fill="none"
          {...line}
        />
        {down(Y.accepts + 48, Y.filled)}
        {c.daily && <line x1={CX} y1={Y.filled + H} x2={CX} y2={Y.daily} {...line} strokeDasharray="5,4" />}

        <Label x={266} y={Y.external - 24} w={24} text={s.no} />
        <Label x={CX + 8} y={Y.external + 56} w={32} text={s.yes} />
        <Label x={276} y={432} w={112} text={c.loop} />
        <Label x={CX + 8} y={Y.accepts + 56} w={32} text={s.yes} />

        <Oval x={CX - 80} y={Y.start} w={160} name={s.start} />
        <Diamond cy={Y.external} name={s.external} />
        <Oval x={304} y={Y.external - 24} w={120} name={s.noCheck} />
        <StepBox y={Y.check} name={c.check[0]} sub={c.check[1]} />
        <StepBox y={Y.ask} name={c.ask[0]} sub={c.ask[1]} />
        <StepBox y={Y.pick} name={c.pick[0]} sub={c.pick[1]} focal={proposed} />
        <Diamond cy={Y.accepts} name={s.accepts} />
        <StepBox y={Y.filled} name={c.filled[0]} sub={c.filled[1]} />
        {c.daily && <StepBox y={Y.daily} name={c.daily[0]} sub={c.daily[1]} focal />}

        {c.daily && (
          <>
            <line x1={24} y1={720} x2={424} y2={720} stroke="rgba(48,52,58,0.12)" strokeWidth={0.8} />
            <rect x={24} y={732} width={16} height={12} rx={2} fill={TINT} stroke={ACCENT} strokeWidth={1} />
            <text x={48} y={742} fill={MUTED} fontSize={12} fontFamily={FONT}>
              {s.legend}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}

// Three short flows, one for each way a hedge is checked. They reuse the step
// box above; the accent marks the step where the desk decides on the credit line.
export type FlowKind = 'send' | 'callback' | 'channel';
interface FlowCopy {
  title: string;
  desc: string;
  steps: [string, string][];
  focal: number[];
  loop?: string; // label of the path from the last step back to the second
}

const FLOWS: Record<Lang, Record<FlowKind, FlowCopy>> = {
  en: {
    send: {
      title: 'Checked before sending',
      desc: 'Flow: an initial check, then the picked LP is checked and its room reserved in one step, the hedge is sent, and a fill turns the reservation into usage while a rejection releases it.',
      steps: [
        ['Initial check', 'ask only LPs that fit'],
        ['Pick LP: check and reserve', 'in one step'],
        ['Send', 'the LP fills or rejects'],
        ['Fill: reserved becomes used', 'reject: release it'],
      ],
      focal: [1],
    },
    callback: {
      title: 'Checked after the match',
      desc: 'Flow: an order rests on the channel, the channel matches it and asks the desk, the desk checks and reserves and answers in time, and a fill turns the reservation into usage while a cancel releases it.',
      steps: [
        ['Order rests on the channel', 'counterparty not yet known'],
        ['Channel matches, then asks', 'names counterparty and amount'],
        ['Check and reserve', 'answer within the time limit'],
        ['Fill: reserved becomes used', 'cancel: release it'],
      ],
      focal: [2],
    },
    channel: {
      title: 'The channel fills within its limit',
      desc: 'Flow: the desk holds room on the line for the largest trade it allows and sets the channel limit to that trade, the channel matches and fills within that limit without asking, the fill report names the counterparty and the held room becomes usage, and the desk holds room again and raises the limit if the line has room, which leads back to the channel matching.',
      steps: [
        ['Hold room, then set the limit', 'the largest trade, per counterparty'],
        ['Channel matches and fills', 'within the limit, without asking'],
        ['Fill report: held becomes used', 'the counterparty is now known'],
        ['Hold room again, raise limit', 'not if the line has no room'],
      ],
      focal: [0, 3],
      loop: 'NEXT FILL',
    },
  },
  zh: {
    send: {
      title: '送出前檢查',
      desc: '流程：先做初步檢查；選定 LP 後檢查並預佔，一步完成；送出；成交後預佔轉為已用，被拒則釋放。',
      steps: [
        ['初步檢查', '只向放得進的 LP 詢價'],
        ['選定 LP：檢查並預佔', '一步完成'],
        ['送出', 'LP 成交或拒絕'],
        ['成交：預佔轉為已用', '拒絕：釋放預佔'],
      ],
      focal: [1],
    },
    callback: {
      title: '撮合後檢查',
      desc: '流程：在場地掛單；場地撮合後來問交易台；交易台檢查並預佔，在時限內回覆；成交後預佔轉為已用，取消則釋放。',
      steps: [
        ['在場地掛單', '這時還不知道對手'],
        ['場地撮合，來問交易台', '帶對手、金額、日期'],
        ['檢查並預佔', '在時限內回覆通過或拒絕'],
        ['成交：預佔轉為已用', '取消：釋放預佔'],
      ],
      focal: [2],
    },
    channel: {
      title: '場地按限額成交',
      desc: '流程：交易台先在額度上按最大一筆預留場地切片，再把場地限額設為這一筆的金額；場地在限額之內撮合並成交，不問交易台；成交回報披露對手，切片轉為已用；額度有空間，交易台就再預留並補回限額，然後回到場地撮合。',
      steps: [
        ['先預留場地切片', '再設場地限額：最大一筆'],
        ['場地撮合並成交', '限額之內，不問交易台'],
        ['成交回報：切片轉為已用', '這時才知道對手'],
        ['從可用額度補回切片', '額度沒有空間就不補'],
      ],
      focal: [0, 3],
      loop: '下一筆',
    },
  },
};

export const flowTitle = (lang: Lang, kind: FlowKind) => FLOWS[lang][kind].title;

export function ChannelFlow({ kind }: { kind: FlowKind }) {
  const lang = useLang();
  const c = FLOWS[lang][kind];
  const id = `flow-${kind}`;
  const GAP = 32;
  const TOP = 8;
  const y = (i: number) => TOP + i * (H + GAP);
  const height = y(c.steps.length - 1) + H + TOP;
  const last = c.steps.length - 1;
  const right = X + W;
  const lane = right + 20; // the path a loop runs back up, beside the steps
  const line = { stroke: MUTED, strokeWidth: 1.2, markerEnd: `url(#${id}-arrow)` };
  return (
    <div className="diagram diagram-small">
      <svg viewBox={`${X - 8} 0 ${W + 44} ${height}`} xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby={`${id}-title ${id}-desc`}>
        <title id={`${id}-title`}>{c.title}</title>
        <desc id={`${id}-desc`}>{c.desc}</desc>
        <defs>
          <marker id={`${id}-arrow`} markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill={MUTED} />
          </marker>
        </defs>
        <rect x={X - 8} width={W + 44} height={height} fill={PAPER} />
        {c.steps.slice(1).map((_, i) => (
          <line key={i} x1={CX} y1={y(i) + H} x2={CX} y2={y(i + 1)} {...line} />
        ))}
        {c.loop && (
          <path d={`M${right},${y(last) + H / 2} H${lane - 8} a8,8 0 0 0 8,-8 V${y(1) + H / 2 + 8} a8,8 0 0 0 -8,-8 H${right}`} fill="none" {...line}>
            <title>{c.loop}</title>
          </path>
        )}
        {c.steps.map(([name, sub], i) => (
          <StepBox key={name} y={y(i)} name={name} sub={sub} focal={c.focal.includes(i)} />
        ))}
      </svg>
    </div>
  );
}
