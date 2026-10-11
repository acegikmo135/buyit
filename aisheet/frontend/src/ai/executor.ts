import { keyOf, nameToCol, normRange, parseRange, rangeToString, addr, colToName, type Range } from '../core/address';
import { autoFitColumns, autoFitRows, buildPivot, findAll, removeDuplicates, replaceAll, textToColumns, currentRegion } from '../core/tools';
import { measureText, wrapLines } from '../grid/measure';
import { FormulaError, type CFRule, type DVRule, type ChartDef } from '../core/types';
import { displayValue } from '../core/format';
import type { Workbook } from '../core/workbook';
import type { Cell, CellStyle, NumFmt, Sheet } from '../core/types';
import { shiftFormula } from '../core/tokens';
import type { Action, StylePatch } from './protocol';

export type Category = 'write' | 'format' | 'structure' | 'sheets' | 'delete';

export interface Permissions {
  mode: 'ask' | 'auto' | 'readonly';
  allow: Record<Category, boolean>;
  /** Restrict cell-level edits to the current selection. */
  selectionOnly: boolean;
  /** In auto mode, still ask before destructive actions (clear / delete). */
  confirmDestructive: boolean;
}

export const DEFAULT_PERMISSIONS: Permissions = {
  mode: 'ask',
  allow: { write: true, format: true, structure: true, sheets: true, delete: true },
  selectionOnly: false,
  confirmDestructive: true,
};

export function categoryOf(a: Action): Category {
  switch (a.type) {
    case 'set_cells':
    case 'set_range':
    case 'fill_formula':
    case 'find_replace':
    case 'text_to_columns':
    case 'add_comment':
      return 'write';
    case 'format':
    case 'set_col_width':
    case 'set_row_height':
    case 'freeze':
    case 'autofit':
    case 'merge':
    case 'borders':
    case 'conditional_format':
    case 'clear_conditional_format':
    case 'hide':
      return 'format';
    case 'clear':
    case 'delete_rows':
    case 'delete_cols':
    case 'delete_sheet':
    case 'remove_duplicates':
    case 'delete_chart':
    case 'clear_data_validation':
      return 'delete';
    case 'insert_rows':
    case 'insert_cols':
    case 'sort':
    case 'filter':
    case 'data_validation':
    case 'define_name':
      return 'structure';
    case 'add_sheet':
    case 'rename_sheet':
    case 'pivot':
    case 'add_chart':
      return 'sheets';
  }
}

export interface ExecContext {
  activeSheetId: string;
  selection: Range | null;
}

export interface Denied {
  index: number;
  action: Action;
  reason: 'readonly' | 'category' | 'scope' | 'invalid';
  detail?: string;
}

const NUM_FMTS: NumFmt[] = ['general', 'number', 'integer', 'thousands', 'percent', 'currency_usd', 'currency_inr', 'currency_eur', 'accounting_inr', 'date', 'datetime', 'time', 'scientific', 'text'];
const NAMED_COLORS: Record<string, string> = { red: '#ef4444', green: '#22c55e', blue: '#3b82f6', yellow: '#facc15', orange: '#f97316', purple: '#a855f7', gray: '#9ca3af', grey: '#9ca3af', black: '#000000', white: '#ffffff', pink: '#ec4899' };

function normColor(c: unknown): string | undefined | null {
  if (c === null || c === '') return null;
  if (typeof c !== 'string') return undefined;
  const t = c.trim().toLowerCase();
  if (NAMED_COLORS[t]) return NAMED_COLORS[t];
  if (/^#[0-9a-f]{6}$/.test(t)) return t;
  if (/^#[0-9a-f]{3}$/.test(t)) return '#' + [...t.slice(1)].map((x) => x + x).join('');
  if (/^[0-9a-f]{6}$/.test(t)) return '#' + t;
  return undefined;
}

export function toCellStyle(p: StylePatch): Partial<CellStyle> {
  const s: Partial<CellStyle> = {};
  if (p.bold !== undefined) s.b = !!p.bold;
  if (p.italic !== undefined) s.i = !!p.italic;
  if (p.underline !== undefined) s.u = !!p.underline;
  if (p.wrap !== undefined) s.wrap = !!p.wrap;
  if (p.align === 'left' || p.align === 'center' || p.align === 'right') s.align = p.align;
  if (p.valign === 'top' || p.valign === 'middle' || p.valign === 'bottom') s.valign = p.valign;
  if (typeof p.indent === 'number') s.indent = Math.max(0, Math.min(10, Math.round(p.indent)));
  if (p.color !== undefined) {
    const c = normColor(p.color);
    if (c !== undefined) s.color = c ?? undefined;
  }
  if (p.background !== undefined) {
    const c = normColor(p.background);
    if (c !== undefined) s.bg = c ?? undefined;
  }
  if (p.numberFormat && NUM_FMTS.includes(p.numberFormat as NumFmt)) s.fmt = p.numberFormat === 'general' ? undefined : (p.numberFormat as NumFmt);
  return s;
}

function colSpec(v: string | number): number {
  if (typeof v === 'number') return Math.max(0, Math.floor(v) - 1);
  return /^\d+$/.test(v) ? parseInt(v, 10) - 1 : nameToCol(v);
}

function clampRange(sheetBounds: { r: number; c: number }, R: Range): Range {
  // whole-column/row ranges are clipped to the used area (+ a small margin) so actions stay bounded
  return {
    r1: R.r1,
    c1: R.c1,
    r2: Math.min(R.r2, Math.max(sheetBounds.r, R.r1) + 1000),
    c2: Math.min(R.c2, Math.max(sheetBounds.c, R.c1) + 50),
  };
}

/** Rectangle touched by a cell-level action (for scope checks). */
function footprint(a: Action): Range | null {
  switch (a.type) {
    case 'set_cells': {
      let acc: Range | null = null;
      for (const c of a.cells) {
        const r = parseRange(c.ref);
        if (!r) continue;
        acc = acc ? { r1: Math.min(acc.r1, r.r1), c1: Math.min(acc.c1, r.c1), r2: Math.max(acc.r2, r.r2), c2: Math.max(acc.c2, r.c2) } : r;
      }
      return acc;
    }
    case 'set_range':
    case 'fill_formula':
    case 'format':
    case 'clear':
    case 'sort':
    case 'merge':
    case 'borders':
    case 'conditional_format':
    case 'remove_duplicates':
    case 'text_to_columns':
      return parseRange(a.range);
    case 'add_comment':
      return parseRange(a.ref);
    default:
      return null;
  }
}

const contains = (outer: Range, inner: Range) => inner.r1 >= outer.r1 && inner.r2 <= outer.r2 && inner.c1 >= outer.c1 && inner.c2 <= outer.c2;

/** Decide which actions are allowed under the permissions. */
export function screen(actions: Action[], perms: Permissions, ctx: ExecContext, wb: Workbook): { ok: { index: number; action: Action }[]; denied: Denied[] } {
  const ok: { index: number; action: Action }[] = [];
  const denied: Denied[] = [];
  actions.forEach((action, index) => {
    if (perms.mode === 'readonly') return denied.push({ index, action, reason: 'readonly' });
    if (!perms.allow[categoryOf(action)]) return denied.push({ index, action, reason: 'category' });
    if (perms.selectionOnly && ctx.selection) {
      const sheetName = 'sheet' in action ? (action as { sheet?: string }).sheet : undefined;
      const sh = sheetName ? wb.sheetByName(sheetName) : wb.sheetById(ctx.activeSheetId);
      const onActive = sh?.id === ctx.activeSheetId;
      const fp = footprint(action);
      if (!fp || !onActive || !contains(normRange(ctx.selection), fp)) return denied.push({ index, action, reason: 'scope' });
    }
    ok.push({ index, action });
  });
  return { ok, denied };
}

export interface ExecResult {
  applied: number;
  errors: string[];
}

/** Applies actions inside a single transaction. Caller is responsible for permission screening. */
export function execute(wb: Workbook, actions: Action[], ctx: ExecContext, label: string): ExecResult {
  const errors: string[] = [];
  let applied = 0;
  wb.run(label, 'ai', () => {
    for (const a of actions) {
      try {
        if (apply(wb, a, ctx)) applied++;
      } catch (e) {
        errors.push(`${a.type}: ${(e as Error).message}`);
      }
    }
  });
  return { applied, errors };
}

function sheetOf(wb: Workbook, name: string | undefined, ctx: ExecContext): Sheet {
  if (!name) return wb.sheetById(ctx.activeSheetId) ?? wb.sheets[0];
  const s = wb.sheetByName(name);
  if (!s) throw new Error(`Sheet "${name}" not found`);
  return s;
}

function rangeOf(wb: Workbook, sh: Sheet, ref: string): Range {
  const R = parseRange(ref);
  if (!R) throw new Error(`Bad range "${ref}"`);
  return clampRange(wb.usedBounds(sh), R);
}

function literal(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  return String(v);
}

function apply(wb: Workbook, a: Action, ctx: ExecContext): boolean {
  switch (a.type) {
    case 'set_cells': {
      const sh = sheetOf(wb, a.sheet, ctx);
      for (const c of a.cells ?? []) {
        const p = parseRange(c.ref);
        if (!p) throw new Error(`Bad ref "${c.ref}"`);
        wb.setValue(sh, p.r1, p.c1, literal(c.value));
        if (c.style) wb.applyStyle(sh, p, toCellStyle(c.style), 'AI format', 'ai');
      }
      return true;
    }
    case 'set_range': {
      const sh = sheetOf(wb, a.sheet, ctx);
      const R = parseRange(a.range);
      if (!R) throw new Error(`Bad range "${a.range}"`);
      a.values.forEach((row, i) => row.forEach((v, j) => wb.setValue(sh, R.r1 + i, R.c1 + j, literal(v))));
      return true;
    }
    case 'fill_formula': {
      const sh = sheetOf(wb, a.sheet, ctx);
      const R = rangeOf(wb, sh, a.range);
      const f = a.formula.startsWith('=') ? a.formula : '=' + a.formula;
      for (let r = R.r1; r <= R.r2; r++)
        for (let c = R.c1; c <= R.c2; c++) wb.setValue(sh, r, c, shiftFormula(f, r - R.r1, c - R.c1));
      return true;
    }
    case 'format': {
      const sh = sheetOf(wb, a.sheet, ctx);
      wb.applyStyle(sh, rangeOf(wb, sh, a.range), toCellStyle(a.style ?? {}), 'AI format', 'ai');
      return true;
    }
    case 'clear': {
      const sh = sheetOf(wb, a.sheet, ctx);
      wb.clearRange(sh, rangeOf(wb, sh, a.range), { contents: true, styles: !!a.formatToo }, 'AI clear', 'ai');
      return true;
    }
    case 'insert_rows':
    case 'delete_rows': {
      const sh = sheetOf(wb, a.sheet, ctx);
      const at = Math.max(0, colSpec(a.at));
      const n = Math.max(1, Math.min(10000, a.count ?? 1));
      if (a.type === 'insert_rows') wb.insertRows(sh, at, n, 'ai');
      else wb.deleteRows(sh, at, n, 'ai');
      return true;
    }
    case 'insert_cols':
    case 'delete_cols': {
      const sh = sheetOf(wb, a.sheet, ctx);
      const at = Math.max(0, colSpec(a.at));
      const n = Math.max(1, Math.min(1000, a.count ?? 1));
      if (a.type === 'insert_cols') wb.insertCols(sh, at, n, 'ai');
      else wb.deleteCols(sh, at, n, 'ai');
      return true;
    }
    case 'sort': {
      const sh = sheetOf(wb, a.sheet, ctx);
      wb.sortRange(sh, rangeOf(wb, sh, a.range), colSpec(a.by), (a.order ?? 'asc') !== 'desc', a.hasHeader !== false, 'ai');
      return true;
    }
    case 'add_sheet':
      wb.addSheet(a.name, 'ai');
      return true;
    case 'rename_sheet': {
      const sh = sheetOf(wb, a.sheet, ctx);
      if (!wb.renameSheet(sh, a.name, 'ai')) throw new Error('Could not rename sheet');
      return true;
    }
    case 'delete_sheet': {
      const sh = sheetOf(wb, a.sheet, ctx);
      if (!wb.deleteSheet(sh, 'ai')) throw new Error('Cannot delete the last sheet');
      return true;
    }
    case 'set_col_width': {
      const sh = sheetOf(wb, a.sheet, ctx);
      wb.setColWidth(sh, colSpec(a.col), Number(a.width), 'ai');
      return true;
    }
    case 'freeze': {
      const sh = sheetOf(wb, a.sheet, ctx);
      wb.setFreeze(sh, a.rows ?? 0, a.cols ?? 0, 'ai');
      return true;
    }
    case 'set_row_height': {
      const sh = sheetOf(wb, a.sheet, ctx);
      wb.setRowHeight(sh, Math.max(0, Math.floor(a.row) - 1), Number(a.height), 'ai');
      return true;
    }
    case 'autofit': {
      const sh = sheetOf(wb, a.sheet, ctx);
      const ub = wb.usedBounds(sh);
      let cols: number[] | null = null;
      if (a.cols && a.cols !== 'all') {
        const R = parseRange(a.cols.includes(':') ? a.cols : `${a.cols}:${a.cols}`);
        if (R) cols = Array.from({ length: Math.min(R.c2, ub.c + 5) - R.c1 + 1 }, (_, i) => R.c1 + i);
      }
      if (typeof document === 'undefined') return false; // no fonts to measure with (tests / headless)
      autoFitColumns(wb, sh, cols, measureText, 'ai');
      if (a.rows !== false) autoFitRows(wb, sh, null, measureText, (t, w) => wrapLines(t, w, (x) => measureText(x)), 'ai');
      return true;
    }
    case 'merge': {
      const sh = sheetOf(wb, a.sheet, ctx);
      const R = rangeOf(wb, sh, a.range);
      if (a.unmerge) wb.unmergeCells(sh, R, 'ai');
      else wb.mergeCells(sh, R, 'ai');
      return true;
    }
    case 'borders': {
      const sh = sheetOf(wb, a.sheet, ctx);
      const color = a.color ? normColor(a.color) : undefined;
      wb.setBorders(sh, rangeOf(wb, sh, a.range), a.preset, { s: a.style ?? 'thin', c: color ?? undefined }, 'ai');
      return true;
    }
    case 'add_chart': {
      const sh = sheetOf(wb, a.sheet, ctx);
      const rng = a.range.includes('!') ? a.range : a.range;
      let left = 20;
      let top = 20;
      const at = a.at ? parseRange(a.at) : null;
      if (at) {
        left = 0;
        for (let c = 0; c < at.c1; c++) left += sh.colW.get(c) ?? 104;
        top = 0;
        for (let r = 0; r < at.r1; r++) top += sh.rowH.get(r) ?? 24;
      } else {
        const R = parseRange(rng.replace(/^.*!/, ''));
        if (R) {
          left = 0;
          for (let c = 0; c <= R.c2; c++) left += sh.colW.get(c) ?? 104;
          left += 12;
          top = Math.max(0, (R.r1) * 24);
          // stack under existing charts at the same place
          top += sh.charts.length * 24;
        }
      }
      const chart: ChartDef = {
        id: a.id || 'ch' + Date.now().toString(36) + Math.floor(Math.random() * 100),
        type: a.chartType, title: a.title ?? '', range: rng, headerRow: a.headerRow !== false, headerCol: a.headerCol !== false,
        stacked: !!a.stacked, legend: a.legend !== false, x: left, y: top, w: a.width ?? 480, h: a.height ?? 300,
      };
      wb.addChart(sh, chart, 'ai');
      return true;
    }
    case 'delete_chart': {
      const sh = sheetOf(wb, a.sheet, ctx);
      wb.removeChart(sh, a.id, 'ai');
      return true;
    }
    case 'conditional_format': {
      const sh = sheetOf(wb, a.sheet, ctx);
      const R = rangeOf(wb, sh, a.range);
      const kindMap = { cell: 'cell', text: 'text', top: 'top', bottom: 'top', duplicates: 'dupes', color_scale: 'colorScale', data_bar: 'dataBar', formula: 'formula' } as const;
      const rule: CFRule = { id: 'cf' + Date.now().toString(36) + Math.floor(Math.random() * 1000), range: R, kind: kindMap[a.rule] };
      if (a.rule === 'cell') Object.assign(rule, { op: a.op ?? '>', v1: a.value, v2: a.value2 });
      if (a.rule === 'text') rule.text = a.text ?? String(a.value ?? '');
      if (a.rule === 'top' || a.rule === 'bottom') Object.assign(rule, { rank: a.rank ?? 10, bottom: a.rule === 'bottom' });
      if (a.rule === 'formula') rule.formula = a.formula;
      const bg = a.background ? normColor(a.background) : undefined;
      const fg = a.color ? normColor(a.color) : undefined;
      if (a.rule === 'color_scale') rule.colors = (a.colors ?? ['#f8696b', '#ffeb84', '#63be7b']).map((c) => normColor(c) ?? '#999999');
      else if (a.rule === 'data_bar') rule.color = (a.background ? normColor(a.background) : undefined) ?? '#6d8ff0';
      else rule.style = { bg: bg ?? '#fecaca', color: fg ?? (bg ? undefined : '#991b1b'), b: a.bold };
      wb.addCF(sh, rule, 'ai');
      return true;
    }
    case 'clear_conditional_format': {
      const sh = sheetOf(wb, a.sheet, ctx);
      if (!a.range) wb.removeCF(sh, 'all', 'ai');
      else {
        const R = parseRange(a.range);
        const ids = sh.cf.filter((r) => R && !(r.range.r2 < R.r1 || r.range.r1 > R.r2 || r.range.c2 < R.c1 || r.range.c1 > R.c2)).map((r) => r.id);
        ids.forEach((id) => wb.removeCF(sh, id, 'ai'));
      }
      return true;
    }
    case 'data_validation': {
      const sh = sheetOf(wb, a.sheet, ctx);
      const rule: DVRule = { id: 'dv' + Date.now().toString(36) + Math.floor(Math.random() * 1000), range: rangeOf(wb, sh, a.range), kind: a.kind, message: a.message };
      if (a.kind === 'list') {
        if (a.items?.length) rule.items = a.items.map(String);
        else if (a.source) rule.source = a.source;
        else throw new Error('list validation needs "items" or "source"');
      } else Object.assign(rule, { op: a.op ?? 'between', v1: a.min, v2: a.max });
      wb.addDV(sh, rule, 'ai');
      return true;
    }
    case 'clear_data_validation': {
      const sh = sheetOf(wb, a.sheet, ctx);
      if (!a.range) wb.removeDV(sh, 'all', 'ai');
      else {
        const R = parseRange(a.range);
        sh.validations.filter((r) => R && !(r.range.r2 < R.r1 || r.range.r1 > R.r2 || r.range.c2 < R.c1 || r.range.c1 > R.c2)).forEach((r) => wb.removeDV(sh, r.id, 'ai'));
      }
      return true;
    }
    case 'filter': {
      const sh = sheetOf(wb, a.sheet, ctx);
      if (a.range === null) return void wb.setFilter(sh, null, 'ai'), true;
      if (a.range) wb.setFilter(sh, rangeOf(wb, sh, a.range), 'ai');
      const cur = wb.sheetById(sh.id)!;
      if (a.column && a.values && cur.filter) {
        const col = nameToCol(a.column.toUpperCase());
        wb.setFilterColumn(cur, col, a.values.map(String), 'ai');
      }
      return true;
    }
    case 'pivot': {
      const src = wb.sheetByName(a.sourceSheet ?? '') ?? sheetOf(wb, undefined, ctx);
      const R = rangeOf(wb, src, a.source);
      const colOf = (name: string) => {
        const byHeader = Array.from({ length: R.c2 - R.c1 + 1 }, (_, i) => R.c1 + i).find((c) => String(wb.value(src, R.r1, c) ?? '').trim().toLowerCase() === name.trim().toLowerCase());
        if (byHeader !== undefined) return byHeader;
        if (/^[A-Za-z]{1,3}$/.test(name.trim())) return nameToCol(name.trim().toUpperCase());
        throw new Error(`Pivot field "${name}" not found in the header row of ${a.source}`);
      };
      buildPivot(wb, { sourceSheet: src.name, source: R, rowField: colOf(a.rows), colField: a.columns ? colOf(a.columns) : undefined, valueField: colOf(a.values), agg: a.agg ?? 'sum', target: a.targetSheet ?? 'Pivot', grandTotals: a.grandTotals !== false }, 'ai');
      return true;
    }
    case 'find_replace': {
      const sh = sheetOf(wb, a.sheet, ctx);
      const n = replaceAll(wb, sh.id, a.find, a.replace, { matchCase: a.matchCase, wholeCell: a.wholeCell, scope: a.allSheets ? 'workbook' : 'sheet' }, 'ai');
      void findAll;
      return n > 0;
    }
    case 'remove_duplicates': {
      const sh = sheetOf(wb, a.sheet, ctx);
      const R = rangeOf(wb, sh, a.range);
      const cols = a.columns?.map((x) => nameToCol(x.toUpperCase()));
      return removeDuplicates(wb, sh, R, cols ?? null, a.hasHeader !== false, 'ai') > 0;
    }
    case 'text_to_columns': {
      const sh = sheetOf(wb, a.sheet, ctx);
      textToColumns(wb, sh, rangeOf(wb, sh, a.range), a.delimiter, 'ai');
      return true;
    }
    case 'add_comment': {
      const sh = sheetOf(wb, a.sheet, ctx);
      const p = parseRange(a.ref);
      if (!p) throw new Error(`Bad ref "${a.ref}"`);
      wb.setComment(sh, p.r1, p.c1, a.text, 'ai');
      return true;
    }
    case 'define_name': {
      if (!/^[\p{L}_][\p{L}\p{N}_.]*$/u.test(a.name)) throw new Error(`Invalid name "${a.name}"`);
      wb.defineName(a.name, a.ref, 'ai');
      return true;
    }
    case 'hide': {
      const sh = sheetOf(wb, a.sheet, ctx);
      const hidden = a.hidden !== false;
      if (a.rows) {
        const m = /^(\d+)(?::(\d+))?$/.exec(a.rows);
        if (m) wb.setHidden(sh, 'row', +m[1] - 1, +(m[2] ?? m[1]) - 1, hidden, 'ai');
      }
      if (a.cols) {
        const R = parseRange(a.cols.includes(':') ? a.cols : `${a.cols}:${a.cols}`);
        if (R) wb.setHidden(sh, 'col', R.c1, R.c2, hidden, 'ai');
      }
      return true;
    }
  }
}

// ---------- preview (dry run on a clone) ----------
export interface PreviewCell {
  key: number;
  text: string;
  was: string;
}
export interface NewError {
  sheet: string;
  ref: string;
  code: string;
  formula: string;
}
export interface Preview {
  /** formula errors that the plan would introduce (self-check) */
  newErrors: NewError[];
  /** changed cells by sheet id (existing sheets only) */
  bySheet: Map<string, Map<number, PreviewCell>>;
  totalCells: number;
  structural: boolean;
  errors: string[];
}

export function dryRun(wb: Workbook, actions: Action[], ctx: ExecContext): Preview {
  const clone = wb.clone();
  const res = execute(clone, actions, ctx, 'preview');
  const bySheet = new Map<string, Map<number, PreviewCell>>();
  let total = 0;
  const sameStyle = (a?: CellStyle, b?: CellStyle) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
  for (const s of wb.sheets) {
    const cs = clone.sheetById(s.id);
    if (!cs) continue;
    const m = new Map<number, PreviewCell>();
    const keys = new Set<number>([...s.cells.keys(), ...cs.cells.keys()]);
    for (const k of keys) {
      const a: Cell | undefined = s.cells.get(k);
      const b: Cell | undefined = cs.cells.get(k);
      if (a && b && a.raw === b.raw && sameStyle(a.style, b.style)) continue;
      if (!a && !b) continue;
      total++;
      if (m.size < 4000) {
        const r = Math.floor(k / 65536);
        const c = k % 65536;
        m.set(k, { key: k, text: b ? displayValue(clone.value(cs, r, c), b.style) : '', was: a ? displayValue(wb.value(s, r, c), a.style) : '' });
      }
    }
    if (m.size) bySheet.set(s.id, m);
  }
  const top = clone.undoStack[clone.undoStack.length - 1];
  // self-check: formulas that evaluate to an error after the plan but did not before
  const newErrors: NewError[] = [];
  outer: for (const cs of clone.sheets) {
    const os = wb.sheetById(cs.id);
    for (const [k, cell] of cs.cells) {
      if (typeof cell.raw !== 'string' || !cell.raw.startsWith('=')) continue;
      const r = Math.floor(k / 65536);
      const c = k % 65536;
      const v = clone.value(cs, r, c);
      if (!(v instanceof FormulaError)) continue;
      const was = os ? wb.value(os, r, c) : null;
      if (was instanceof FormulaError) continue;
      newErrors.push({ sheet: cs.name, ref: addr(r, c), code: v.code, formula: cell.raw });
      if (newErrors.length >= 12) break outer;
    }
  }
  return { bySheet, totalCells: total, structural: !!top && clone.hasStructuralChange(top), errors: res.errors, newErrors };
}

// ---------- human-readable summary ----------
export interface ActionSummary {
  key: string;
  vars: Record<string, string | number>;
}

export function summarize(a: Action): ActionSummary {
  const sheet = ('sheet' in a && (a as { sheet?: string }).sheet) || '';
  const r = (s: string) => {
    const p = parseRange(s);
    return p ? rangeToString(p) : s;
  };
  switch (a.type) {
    case 'set_cells':
      return { key: 'act.set_cells', vars: { n: a.cells?.length ?? 0, sheet } };
    case 'set_range':
      return { key: 'act.set_range', vars: { range: r(a.range), sheet } };
    case 'fill_formula':
      return { key: 'act.fill_formula', vars: { range: r(a.range), formula: a.formula, sheet } };
    case 'format':
      return { key: 'act.format', vars: { range: r(a.range), sheet } };
    case 'clear':
      return { key: 'act.clear', vars: { range: r(a.range), sheet } };
    case 'insert_rows':
      return { key: 'act.insert_rows', vars: { at: Number(a.at), n: a.count ?? 1, sheet } };
    case 'delete_rows':
      return { key: 'act.delete_rows', vars: { at: Number(a.at), n: a.count ?? 1, sheet } };
    case 'insert_cols':
      return { key: 'act.insert_cols', vars: { at: typeof a.at === 'number' ? addr(0, a.at - 1).replace(/\d+/, '') : String(a.at), n: a.count ?? 1, sheet } };
    case 'delete_cols':
      return { key: 'act.delete_cols', vars: { at: typeof a.at === 'number' ? addr(0, a.at - 1).replace(/\d+/, '') : String(a.at), n: a.count ?? 1, sheet } };
    case 'sort':
      return { key: 'act.sort', vars: { range: r(a.range), by: String(a.by), order: a.order ?? 'asc', sheet } };
    case 'add_sheet':
      return { key: 'act.add_sheet', vars: { name: a.name } };
    case 'rename_sheet':
      return { key: 'act.rename_sheet', vars: { sheet: a.sheet, name: a.name } };
    case 'delete_sheet':
      return { key: 'act.delete_sheet', vars: { sheet: a.sheet } };
    case 'set_col_width':
      return { key: 'act.set_col_width', vars: { col: String(a.col), width: a.width, sheet } };
    case 'freeze':
      return { key: 'act.freeze', vars: { rows: a.rows ?? 0, cols: a.cols ?? 0, sheet } };
    case 'set_row_height':
      return { key: 'act.set_row_height', vars: { row: a.row, height: a.height, sheet } };
    case 'autofit':
      return { key: 'act.autofit', vars: { cols: a.cols ?? 'all', sheet } };
    case 'merge':
      return { key: a.unmerge ? 'act.unmerge' : 'act.merge', vars: { range: r(a.range), sheet } };
    case 'borders':
      return { key: 'act.borders', vars: { range: r(a.range), preset: a.preset, sheet } };
    case 'add_chart':
      return { key: 'act.add_chart', vars: { type: a.chartType, range: a.range, title: a.title ?? '', sheet } };
    case 'delete_chart':
      return { key: 'act.delete_chart', vars: { id: a.id, sheet } };
    case 'conditional_format':
      return { key: 'act.conditional_format', vars: { range: r(a.range), rule: a.rule, sheet } };
    case 'clear_conditional_format':
      return { key: 'act.clear_conditional_format', vars: { range: a.range ?? 'all', sheet } };
    case 'data_validation':
      return { key: 'act.data_validation', vars: { range: r(a.range), kind: a.kind, sheet } };
    case 'clear_data_validation':
      return { key: 'act.clear_data_validation', vars: { range: a.range ?? 'all', sheet } };
    case 'filter':
      return { key: a.range === null ? 'act.filter_off' : 'act.filter', vars: { range: a.range ?? '', column: a.column ?? '', sheet } };
    case 'pivot':
      return { key: 'act.pivot', vars: { source: a.source, rows: a.rows, values: a.values, target: a.targetSheet ?? 'Pivot' } };
    case 'find_replace':
      return { key: 'act.find_replace', vars: { find: a.find, replace: a.replace } };
    case 'remove_duplicates':
      return { key: 'act.remove_duplicates', vars: { range: r(a.range), sheet } };
    case 'text_to_columns':
      return { key: 'act.text_to_columns', vars: { range: r(a.range), sheet } };
    case 'add_comment':
      return { key: a.text ? 'act.add_comment' : 'act.delete_comment', vars: { ref: a.ref, sheet } };
    case 'define_name':
      return { key: 'act.define_name', vars: { name: a.name, ref: a.ref ?? '' } };
    case 'hide':
      return { key: a.hidden === false ? 'act.unhide' : 'act.hide', vars: { rows: a.rows ?? '', cols: a.cols ?? '', sheet } };
  }
}

void keyOf;
