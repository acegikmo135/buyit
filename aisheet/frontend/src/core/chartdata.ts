import { keyOf, parseRange } from './address';
import { displayValue } from './format';
import type { ChartDef, Sheet } from './types';
import type { Workbook } from './workbook';

export interface ChartData {
  categories: string[];
  series: { name: string; values: number[] }[];
  /** scatter: x values (numeric) */
  xs?: number[];
}

export function resolveRange(wb: Workbook, sheet: Sheet, ref: string) {
  const m = /^(?:'?([^'!]+)'?!)?(.+)$/.exec(ref.trim());
  const sh = (m?.[1] ? wb.sheetByName(m[1]) : sheet) ?? sheet;
  const R = m ? parseRange(m[2], wb.usedBounds(sh).r, wb.usedBounds(sh).c) : null;
  return R ? { sh, R } : null;
}

export function chartData(wb: Workbook, sheet: Sheet, def: ChartDef): ChartData | null {
  const res = resolveRange(wb, sheet, def.range);
  if (!res) return null;
  const { sh, R } = res;
  const get = (r: number, c: number) => wb.value(sh, r, c);
  const num = (r: number, c: number) => {
    const v = get(r, c);
    return typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)) ? Number(v) : 0;
  };
  const r0 = R.r1 + (def.headerRow ? 1 : 0);
  const c0 = R.c1 + (def.headerCol ? 1 : 0);
  const categories: string[] = [];
  for (let r = r0; r <= R.r2; r++) categories.push(def.headerCol ? displayValue(get(r, R.c1), sh.cells.get(keyOf(r, R.c1))?.style) : String(r - r0 + 1));
  const series: ChartData['series'] = [];
  for (let c = c0; c <= R.c2; c++) {
    const name = def.headerRow ? displayValue(get(R.r1, c), undefined) : `Series ${c - c0 + 1}`;
    const values: number[] = [];
    for (let r = r0; r <= R.r2; r++) values.push(num(r, c));
    series.push({ name: name || `Series ${c - c0 + 1}`, values });
  }
  if (def.type === 'scatter' && def.headerCol) {
    const xs: number[] = [];
    for (let r = r0; r <= R.r2; r++) xs.push(num(r, R.c1));
    return { categories, series, xs };
  }
  return { categories, series };
}

/** "Nice" axis ticks covering [min,max]. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) {
    max = min + 1;
  }
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v / step) * step);
  return out;
}

export const CHART_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#84cc16', '#ec4899'];
