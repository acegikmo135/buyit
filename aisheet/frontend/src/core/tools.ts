// Spreadsheet "power tools" shared by the UI and the AI: find/replace, de-duplicate, text-to-columns, pivot tables, profiling, auto-fit.
import { addr, colToName, keyOf, normRange, parseRange, rangeToString, type Range } from './address';
import { displayValue, parseInput } from './format';
import type { Cell, Sheet } from './types';
import type { Workbook, TxSource } from './workbook';
import { FormulaError } from './types';

// ---------- current region (Excel's Ctrl+A on a cell / table detection) ----------
export function currentRegion(wb: Workbook, sheet: Sheet, r: number, c: number): Range {
  const has = (rr: number, cc: number) => {
    const cell = sheet.cells.get(keyOf(rr, cc));
    return !!cell && cell.raw !== '';
  };
  if (!has(r, c)) {
    // nearest filled neighbour
    for (const [dr, dc] of [[0, -1], [-1, 0], [0, 1], [1, 0]]) if (r + dr >= 0 && c + dc >= 0 && has(r + dr, c + dc)) return currentRegion(wb, sheet, r + dr, c + dc);
    return { r1: r, c1: c, r2: r, c2: c };
  }
  let r1 = r, r2 = r, c1 = c, c2 = c;
  let grew = true;
  while (grew) {
    grew = false;
    const rowHas = (rr: number) => { for (let cc = c1 - 1; cc <= c2 + 1; cc++) if (cc >= 0 && has(rr, cc)) return true; return false; };
    const colHas = (cc: number) => { for (let rr = r1 - 1; rr <= r2 + 1; rr++) if (rr >= 0 && has(rr, cc)) return true; return false; };
    if (r1 > 0 && rowHas(r1 - 1)) { r1--; grew = true; }
    if (rowHas(r2 + 1) && r2 < wb.usedBounds(sheet).r) { r2++; grew = true; }
    if (c1 > 0 && colHas(c1 - 1)) { c1--; grew = true; }
    if (colHas(c2 + 1) && c2 < wb.usedBounds(sheet).c) { c2++; grew = true; }
  }
  return { r1, c1, r2, c2 };
}

// ---------- find & replace ----------
export interface FindOpts {
  matchCase?: boolean;
  wholeCell?: boolean;
  inFormulas?: boolean;
  scope?: 'sheet' | 'workbook' | 'selection';
  selection?: Range;
}
export interface Match {
  sheetId: string;
  sheetName: string;
  r: number;
  c: number;
  text: string;
}

function matcher(query: string, o: FindOpts): (s: string) => boolean {
  const q = o.matchCase ? query : query.toLowerCase();
  return (s) => {
    const t = o.matchCase ? s : s.toLowerCase();
    return o.wholeCell ? t === q : t.includes(q);
  };
}

export function findAll(wb: Workbook, activeSheetId: string, query: string, o: FindOpts = {}): Match[] {
  if (!query) return [];
  const test = matcher(query, o);
  const out: Match[] = [];
  const sheets = o.scope === 'workbook' ? wb.sheets : wb.sheets.filter((s) => s.id === activeSheetId);
  for (const sh of sheets) {
    const keys = [...sh.cells.keys()].sort((a, b) => a - b);
    for (const k of keys) {
      const r = Math.floor(k / 65536);
      const c = k % 65536;
      if (o.scope === 'selection' && o.selection) {
        const S = normRange(o.selection);
        if (r < S.r1 || r > S.r2 || c < S.c1 || c > S.c2) continue;
      }
      const cell = sh.cells.get(k)!;
      const shown = displayValue(wb.value(sh, r, c), cell.style);
      const raw = typeof cell.raw === 'string' && cell.raw.startsWith('=') ? cell.raw : '';
      if (test(shown) || (o.inFormulas && raw && test(raw))) out.push({ sheetId: sh.id, sheetName: sh.name, r, c, text: shown });
    }
  }
  return out;
}

export function replaceAll(wb: Workbook, activeSheetId: string, query: string, replacement: string, o: FindOpts = {}, source: TxSource = 'user'): number {
  const matches = findAll(wb, activeSheetId, query, { ...o, inFormulas: true });
  let n = 0;
  const flags = o.matchCase ? 'g' : 'gi';
  const esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  wb.run('Replace all', source, () => {
    for (const m of matches) {
      const sh = wb.sheetById(m.sheetId)!;
      const cell = sh.cells.get(keyOf(m.r, m.c))!;
      const isFormula = typeof cell.raw === 'string' && cell.raw.startsWith('=');
      const base = isFormula || typeof cell.raw !== 'string' ? String(cell.raw) : cell.raw;
      const next = o.wholeCell ? replacement : base.replace(new RegExp(esc, flags), () => replacement);
      if (next === base) continue;
      wb.setCellRaw(sh, m.r, m.c, { raw: isFormula ? next : parseInput(next), style: cell.style });
      n++;
    }
  });
  return n;
}

// ---------- remove duplicates ----------
export function removeDuplicates(wb: Workbook, sheet: Sheet, rng: Range, cols: number[] | null, hasHeader: boolean, source: TxSource = 'user'): number {
  const R = normRange(rng);
  const top = R.r1 + (hasHeader ? 1 : 0);
  const keyCols = cols ?? Array.from({ length: R.c2 - R.c1 + 1 }, (_, i) => R.c1 + i);
  const seen = new Set<string>();
  const keep: (Cell | undefined)[][] = [];
  let removed = 0;
  for (let r = top; r <= R.r2; r++) {
    const key = keyCols.map((c) => displayValue(wb.value(sheet, r, c), undefined).trim().toLowerCase()).join('\u0001');
    if (seen.has(key)) {
      removed++;
      continue;
    }
    seen.add(key);
    const row: (Cell | undefined)[] = [];
    for (let c = R.c1; c <= R.c2; c++) row.push(sheet.cells.get(keyOf(r, c)));
    keep.push(row);
  }
  if (!removed) return 0;
  wb.run('Remove duplicates', source, () => {
    keep.forEach((row, i) => row.forEach((cell, j) => wb.setCellRaw(sheet, top + i, R.c1 + j, cell)));
    for (let r = top + keep.length; r <= R.r2; r++) for (let c = R.c1; c <= R.c2; c++) wb.setCellRaw(sheet, r, c, undefined);
  });
  return removed;
}

// ---------- text to columns ----------
export function textToColumns(wb: Workbook, sheet: Sheet, rng: Range, delimiter: string, source: TxSource = 'user') {
  const R = normRange(rng);
  const delim = delimiter === 'tab' ? '\t' : delimiter === 'space' ? ' ' : delimiter;
  wb.run('Text to columns', source, () => {
    for (let r = R.r1; r <= R.r2; r++) {
      const cell = sheet.cells.get(keyOf(r, R.c1));
      if (!cell || typeof cell.raw !== 'string') continue;
      const parts = cell.raw.split(delim);
      parts.forEach((p, i) => wb.setCellRaw(sheet, r, R.c1 + i, { raw: parseInput(p.trim()), style: i === 0 ? cell.style : undefined }));
    }
  });
}

// ---------- pivot table ----------
export type PivotAgg = 'sum' | 'count' | 'avg' | 'min' | 'max';
export interface PivotParams {
  sourceSheet: string;
  source: Range; // including header row
  rowField: number; // absolute column index
  colField?: number;
  valueField: number;
  agg: PivotAgg;
  target: string; // sheet name to (re)create
  grandTotals?: boolean;
}

const q = (name: string) => (/^[\p{L}_][\p{L}\p{N}_]*$/u.test(name) ? name : `'${name.replace(/'/g, "''")}'`);

export function buildPivot(wb: Workbook, p: PivotParams, source: TxSource = 'user'): { sheetId: string; rows: number; cols: number } {
  const src = wb.sheetByName(p.sourceSheet);
  if (!src) throw new Error(`Sheet "${p.sourceSheet}" not found`);
  const S = normRange(p.source);
  const first = S.r1 + 1;
  const col = (c: number) => `${q(src.name)}!$${colToName(c)}$${first + 1}:$${colToName(c)}$${S.r2 + 1}`;
  const distinct = (c: number) => {
    const set = new Map<string, string>();
    for (let r = first; r <= S.r2; r++) {
      const v = displayValue(wb.value(src, r, c), src.cells.get(keyOf(r, c))?.style);
      if (v !== '' && !set.has(v.toLowerCase())) set.set(v.toLowerCase(), v);
    }
    return [...set.values()].sort((a, b) => a.localeCompare(b, ['gu', 'en'], { numeric: true }));
  };
  const rowsV = distinct(p.rowField);
  const colsV = p.colField !== undefined ? distinct(p.colField) : [];
  const head = (c: number) => displayValue(wb.value(src, S.r1, c), undefined) || `Column ${colToName(c)}`;
  const agg = { sum: 'SUMIFS', count: 'COUNTIFS', avg: 'AVERAGEIFS', min: 'MINIFS', max: 'MAXIFS' }[p.agg];
  const cell = (conds: string) => (p.agg === 'count' ? `=COUNTIFS(${conds})` : `=${agg}(${col(p.valueField)},${conds})`);
  const total = (conds: string | null) => (conds ? cell(conds) : p.agg === 'count' ? `=COUNTA(${col(p.rowField)})` : `=${{ sum: 'SUM', avg: 'AVERAGE', min: 'MIN', max: 'MAX', count: 'COUNT' }[p.agg]}(${col(p.valueField)})`);
  const gt = p.grandTotals !== false;

  let target = wb.sheetByName(p.target);
  wb.run('Pivot table', source, () => {
    if (!target) target = wb.addSheet(p.target, source);
    const t = wb.sheetById(target.id)!;
    // clear old content
    for (const k of [...t.cells.keys()]) t.cells.delete(k);
    const set = (r: number, c: number, raw: string | number, bold = false, fmt?: Cell['style']) =>
      wb.setCellRaw(t, r, c, { raw, style: { ...(bold ? { b: true } : {}), ...fmt } });
    const hdr = { bg: '#e0e7ff', b: true } as const;
    set(0, 0, `${p.agg.toUpperCase()} of ${head(p.valueField)} by ${head(p.rowField)}${p.colField !== undefined ? ' × ' + head(p.colField) : ''}`, true);
    if (p.colField !== undefined) {
      set(1, 0, head(p.rowField), true, hdr);
      colsV.forEach((v, j) => set(1, 1 + j, v, true, { ...hdr, align: 'right' }));
      if (gt) set(1, 1 + colsV.length, 'Grand Total', true, { ...hdr, align: 'right' });
      rowsV.forEach((rv, i) => {
        const r = 2 + i;
        set(r, 0, rv);
        colsV.forEach((_, j) => set(r, 1 + j, cell(`${col(p.rowField)},$A${r + 1},${col(p.colField!)},${colToName(1 + j)}$2`), false, { fmt: 'thousands' }));
        if (gt) set(r, 1 + colsV.length, cell(`${col(p.rowField)},$A${r + 1}`), true, { fmt: 'thousands' });
      });
      if (gt) {
        const r = 2 + rowsV.length;
        set(r, 0, 'Grand Total', true, hdr);
        colsV.forEach((_, j) => set(r, 1 + j, cell(`${col(p.colField!)},${colToName(1 + j)}$2`), true, { fmt: 'thousands', ...hdr }));
        set(r, 1 + colsV.length, total(null), true, { fmt: 'thousands', ...hdr });
      }
    } else {
      set(1, 0, head(p.rowField), true, hdr);
      set(1, 1, `${p.agg} of ${head(p.valueField)}`, true, { ...hdr, align: 'right' });
      rowsV.forEach((rv, i) => {
        set(2 + i, 0, rv);
        set(2 + i, 1, cell(`${col(p.rowField)},$A${3 + i}`), false, { fmt: 'thousands' });
      });
      if (gt) {
        set(2 + rowsV.length, 0, 'Grand Total', true, hdr);
        set(2 + rowsV.length, 1, total(null), true, { fmt: 'thousands', ...hdr });
      }
    }
  });
  const t = wb.sheetByName(p.target)!;
  return { sheetId: t.id, rows: rowsV.length, cols: colsV.length };
}

// ---------- data profile (compact, for the AI) ----------
export interface ColumnProfile {
  col: string;
  header: string;
  type: 'number' | 'text' | 'mixed' | 'empty';
  filled: number;
  distinct: number;
  min?: number;
  max?: number;
  mean?: number;
  samples: string[];
  errors: number;
}

export function profileRange(wb: Workbook, sheet: Sheet, rng: Range, hasHeader = true): ColumnProfile[] {
  const R = normRange(rng);
  const out: ColumnProfile[] = [];
  for (let c = R.c1; c <= R.c2; c++) {
    const header = hasHeader ? displayValue(wb.value(sheet, R.r1, c), undefined) : '';
    let nums = 0, texts = 0, errors = 0, filled = 0, sum = 0;
    let min = Infinity, max = -Infinity;
    const distinct = new Set<string>();
    const samples: string[] = [];
    for (let r = R.r1 + (hasHeader ? 1 : 0); r <= R.r2; r++) {
      const v = wb.value(sheet, r, c);
      if (v === null || v === '') continue;
      filled++;
      if (v instanceof FormulaError) errors++;
      else if (typeof v === 'number') {
        nums++;
        sum += v;
        min = Math.min(min, v);
        max = Math.max(max, v);
      } else texts++;
      const shown = displayValue(v, undefined);
      if (distinct.size < 500) distinct.add(shown);
      if (samples.length < 4 && !samples.includes(shown)) samples.push(shown.length > 40 ? shown.slice(0, 40) + '…' : shown);
    }
    out.push({
      col: colToName(c), header, filled, errors, distinct: distinct.size, samples,
      type: !filled ? 'empty' : nums && texts ? 'mixed' : nums ? 'number' : 'text',
      ...(nums ? { min, max, mean: sum / nums } : {}),
    });
  }
  return out;
}

// ---------- auto-fit ----------
export type Measure = (text: string, style?: Cell['style']) => number;

export function autoFitColumns(wb: Workbook, sheet: Sheet, cols: number[] | null, measure: Measure, source: TxSource = 'user', opts: { onlyGrow?: boolean; silent?: boolean; minW?: number; maxW?: number } = {}) {
  const minW = opts.minW ?? 48;
  const maxW = opts.maxW ?? 420;
  const ub = wb.usedBounds(sheet);
  const targets = cols ?? Array.from({ length: ub.c + 1 }, (_, i) => i);
  const widths = new Map<number, number>();
  const skip = new Set<number>(); // rows inside merges don't drive width
  for (const m of sheet.merges) for (let r = m.r1; r <= m.r2; r++) if (m.c1 !== m.c2) skip.add(r * 65536 + m.c1);
  for (const [k, cell] of sheet.cells) {
    const c = k % 65536;
    if (!targets.includes(c) || skip.has(k)) continue;
    const r = Math.floor(k / 65536);
    const shown = displayValue(wb.value(sheet, r, c), cell.style);
    if (!shown) continue;
    const lines = cell.style?.wrap ? shown.split('\n') : [shown];
    const w = Math.max(...lines.map((l) => measure(l, cell.style))) + 22 + (sheet.filter && r === sheet.filter.range.r1 && c >= sheet.filter.range.c1 && c <= sheet.filter.range.c2 ? 18 : 0);
    widths.set(c, Math.max(widths.get(c) ?? 0, w));
  }
  const changes: [number, number][] = [];
  for (const c of targets) {
    const w = Math.round(Math.min(maxW, Math.max(minW, widths.get(c) ?? 0)));
    if (!widths.has(c)) continue;
    const cur = sheet.colW.get(c) ?? 104;
    if (opts.onlyGrow ? w > cur + 2 : Math.abs(cur - w) > 2) changes.push([c, w]);
  }
  if (!changes.length) return 0;
  if (opts.silent) wb.setColWidthsSilently(sheet, changes);
  else wb.setColWidths(sheet, changes, source);
  return changes.length;
}

export { addr, rangeToString, parseRange };

// ---------- auto-fit rows (wrapped text) ----------
export function autoFitRows(wb: Workbook, sheet: Sheet, rows: number[] | null, measure: Measure, wrap: (text: string, maxW: number) => string[], source: TxSource = 'user') {
  const ub = wb.usedBounds(sheet);
  const targets = new Set(rows ?? Array.from({ length: ub.r + 1 }, (_, i) => i));
  const heights = new Map<number, number>();
  for (const [k, cell] of sheet.cells) {
    const r = Math.floor(k / 65536);
    if (!targets.has(r) || !cell.style?.wrap) continue;
    const c = k % 65536;
    const w = (sheet.colW.get(c) ?? 104) - 12;
    const shown = displayValue(wb.value(sheet, r, c), cell.style);
    const lines = wrap(shown, w).length;
    heights.set(r, Math.max(heights.get(r) ?? 0, lines * 18 + 8));
  }
  void measure;
  const changes: [number, number][] = [];
  for (const [r, h] of heights) if (h > 24 && Math.abs((sheet.rowH.get(r) ?? 24) - h) > 2) changes.push([r, h]);
  if (!changes.length) return 0;
  wb.setRowHeights(sheet, changes, source);
  return changes.length;
}
