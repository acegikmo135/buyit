import { keyOf, nameToCol, normRange, parseRange, rangeToString, addr, type Range } from '../core/address';
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
      return 'write';
    case 'format':
    case 'set_col_width':
    case 'freeze':
      return 'format';
    case 'clear':
    case 'delete_rows':
    case 'delete_cols':
    case 'delete_sheet':
      return 'delete';
    case 'insert_rows':
    case 'insert_cols':
    case 'sort':
      return 'structure';
    case 'add_sheet':
    case 'rename_sheet':
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

const NUM_FMTS: NumFmt[] = ['general', 'number', 'integer', 'thousands', 'percent', 'currency_usd', 'currency_inr', 'currency_eur', 'date', 'text'];
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
      return parseRange(a.range);
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
  }
}

// ---------- preview (dry run on a clone) ----------
export interface PreviewCell {
  key: number;
  text: string;
  was: string;
}
export interface Preview {
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
  return { bySheet, totalCells: total, structural: !!top && clone.hasStructuralChange(top), errors: res.errors };
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
  }
}

void keyOf;
