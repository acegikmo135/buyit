import type { CFRule, Scalar, Sheet } from '../core/types';
import { FormulaError } from '../core/types';
import type { Workbook } from '../core/workbook';
import { displayValue } from '../core/format';
import { shiftFormula } from '../core/tokens';
import { keyOf } from '../core/address';

export interface CFResult {
  bg?: string;
  color?: string;
  b?: boolean;
  bar?: { pct: number; color: string };
}

interface Stats {
  min: number;
  max: number;
  threshold?: number; // top/bottom N
  dupes?: Map<string, number>;
}

let cache: { ver: number; sheetId: string; stats: Map<string, Stats> } | null = null;

function hexToRgb(h: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(h);
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const lerp = (a: string, b: string, t: number) => {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return `rgb(${[0, 1, 2].map((i) => Math.round(x[i] + (y[i] - x[i]) * t)).join(',')})`;
};

function statsFor(wb: Workbook, sh: Sheet, rule: CFRule): Stats {
  if (!cache || cache.ver !== wb.version || cache.sheetId !== sh.id) cache = { ver: wb.version, sheetId: sh.id, stats: new Map() };
  let st = cache.stats.get(rule.id);
  if (st) return st;
  const nums: number[] = [];
  const dupes = new Map<string, number>();
  const R = rule.range;
  const ub = wb.usedBounds(sh);
  for (let r = R.r1; r <= Math.min(R.r2, ub.r); r++)
    for (let c = R.c1; c <= Math.min(R.c2, ub.c); c++) {
      const v = wb.value(sh, r, c);
      if (typeof v === 'number') nums.push(v);
      if (rule.kind === 'dupes' && v !== null && v !== '') {
        const k = displayValue(v, undefined).toLowerCase();
        dupes.set(k, (dupes.get(k) ?? 0) + 1);
      }
    }
  nums.sort((a, b) => a - b);
  st = { min: nums[0] ?? 0, max: nums[nums.length - 1] ?? 0, dupes };
  if (rule.kind === 'top' && nums.length) {
    const n = Math.min(rule.rank ?? 10, nums.length);
    st.threshold = rule.bottom ? nums[n - 1] : nums[nums.length - n];
  }
  cache.stats.set(rule.id, st);
  return st;
}

function cmp(op: CFRule['op'], v: Scalar, a: string | number | undefined, b: string | number | undefined): boolean {
  if (v === null || v instanceof FormulaError) return false;
  const numeric = typeof v === 'number';
  const x = numeric ? (v as number) : String(v).toLowerCase();
  const p = numeric ? Number(a) : String(a ?? '').toLowerCase();
  const q = numeric ? Number(b) : String(b ?? '').toLowerCase();
  if (numeric && (Number.isNaN(p) || (op === 'between' && Number.isNaN(q)))) return false;
  switch (op ?? '>') {
    case '>': return x > p;
    case '<': return x < p;
    case '>=': return x >= p;
    case '<=': return x <= p;
    case '=': return x === p;
    case '<>': return x !== p;
    case 'between': return x >= p && x <= q;
    case 'notBetween': return x < p || x > q;
  }
}

/** Merged effect of all rules covering (r,c). Later rules win for colours; bars/scales apply independently. */
export function cfFor(wb: Workbook, sh: Sheet, r: number, c: number, v: Scalar): CFResult | null {
  if (!sh.cf.length) return null;
  let out: CFResult | null = null;
  for (const rule of sh.cf) {
    const R = rule.range;
    if (r < R.r1 || r > R.r2 || c < R.c1 || c > R.c2) continue;
    let hit = false;
    let res: CFResult = {};
    switch (rule.kind) {
      case 'cell':
        hit = cmp(rule.op, v, rule.v1, rule.v2);
        res = { ...rule.style };
        break;
      case 'text':
        hit = !!rule.text && v !== null && displayValue(v, sh.cells.get(keyOf(r, c))?.style).toLowerCase().includes(rule.text.toLowerCase());
        res = { ...rule.style };
        break;
      case 'top': {
        if (typeof v !== 'number') break;
        const st = statsFor(wb, sh, rule);
        hit = st.threshold !== undefined && (rule.bottom ? v <= st.threshold : v >= st.threshold);
        res = { ...rule.style };
        break;
      }
      case 'dupes': {
        if (v === null || v === '') break;
        hit = (statsFor(wb, sh, rule).dupes?.get(displayValue(v, undefined).toLowerCase()) ?? 0) > 1;
        res = { ...rule.style };
        break;
      }
      case 'formula': {
        if (!rule.formula) break;
        const f = shiftFormula(rule.formula.startsWith('=') ? rule.formula : '=' + rule.formula, r - R.r1, c - R.c1);
        const x = wb.evalExpr(sh, r, c, f);
        hit = x === true || (typeof x === 'number' && x !== 0);
        res = { ...rule.style };
        break;
      }
      case 'colorScale': {
        if (typeof v !== 'number') break;
        const st = statsFor(wb, sh, rule);
        const cols = rule.colors?.length ? rule.colors : ['#f8696b', '#ffeb84', '#63be7b'];
        const t = st.max === st.min ? 0.5 : (v - st.min) / (st.max - st.min);
        res = { bg: cols.length === 2 ? lerp(cols[0], cols[1], t) : t < 0.5 ? lerp(cols[0], cols[1], t * 2) : lerp(cols[1], cols[2], (t - 0.5) * 2) };
        hit = true;
        break;
      }
      case 'dataBar': {
        if (typeof v !== 'number') break;
        const st = statsFor(wb, sh, rule);
        const lo = Math.min(0, st.min);
        const pct = st.max === lo ? 1 : (v - lo) / (st.max - lo);
        res = { bar: { pct: Math.max(0.02, Math.min(1, pct)), color: rule.color ?? '#6d8ff0' } };
        hit = true;
        break;
      }
    }
    if (hit) out = { ...(out ?? {}), ...res };
  }
  return out;
}
