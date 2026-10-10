// App-level workflows that tie the store, the workbook and the platform together.
import { activeSheet, execContext, selectionRange, useStore, wb } from './store';
import { addr, keyOf, MAX_COLS, MAX_ROWS, normRange, type Range } from './core/address';
import { displayValue, parseInput } from './core/format';
import type { Cell, CellStyle } from './core/types';
import { csvToSheet, sheetToCsv, sheetsToXlsx, xlsxToSheets } from './core/io';
import { makeSheet } from './core/workbook';
import { openFileDialog, saveFileDialog } from './platform';
import { clearFx, playFx } from './grid/fx';

const st = () => useStore.getState();

// ---------- selection ----------
export function ensureActiveSheet() {
  if (!wb.sheetById(st().activeSheetId)) st().set({ activeSheetId: wb.sheets[0].id });
}

/** Column where a run of Tab-entries started; Enter returns there (like Excel). */
let tabOrigin: number | null = null;
export const resetTabOrigin = () => {
  tabOrigin = null;
};

export function moveSelection(dr: number, dc: number, extend: boolean) {
  tabOrigin = null;
  const { anchor, active } = st();
  const nr = Math.max(0, Math.min(MAX_ROWS - 1, active.r + dr));
  const nc = Math.max(0, Math.min(MAX_COLS - 1, active.c + dc));
  st().select(extend ? anchor : { r: nr, c: nc }, { r: nr, c: nc });
}

export function pressEnter(up: boolean) {
  const o = tabOrigin;
  moveSelection(up ? -1 : 1, 0, false);
  if (o !== null) st().select({ r: st().active.r, c: o });
}
export function pressTab(back: boolean) {
  const o = tabOrigin ?? st().active.c;
  moveSelection(0, back ? -1 : 1, false);
  tabOrigin = o;
}

export function cellText(sheetId: string, r: number, c: number): string {
  const sh = wb.sheetById(sheetId);
  if (!sh) return '';
  return displayValue(wb.value(sh, r, c), sh.cells.get(keyOf(r, c))?.style);
}

export function rawText(r: number, c: number): string {
  const cell = activeSheet().cells.get(keyOf(r, c));
  if (!cell) return '';
  const raw = cell.raw;
  if (typeof raw === 'boolean') return raw ? 'TRUE' : 'FALSE';
  if (typeof raw === 'string' && cell.style?.fmt !== 'text' && /^\s*[-+]?\d/.test(raw) && typeof parseInput(raw) === 'number') return "'" + raw;
  return String(raw);
}

// ---------- editing ----------
export function startEdit(from: 'cell' | 'bar', initial?: string) {
  const { active } = st();
  const sh = activeSheet();
  st().set({ editing: { r: active.r, c: active.c, sheetId: sh.id, text: initial ?? rawText(active.r, active.c), from } });
}

export function commitEdit(move: 'down' | 'right' | 'left' | 'up' | 'none' = 'down') {
  const e = st().editing;
  if (!e) return;
  const sh = wb.sheetById(e.sheetId);
  st().set({ editing: null });
  if (sh) {
    const prev = rawText(e.r, e.c);
    if (e.text !== prev) wb.setInput(sh, e.r, e.c, e.text, `Edit ${addr(e.r, e.c)}`);
  }
  const origin = tabOrigin ?? e.c;
  if (move === 'down' || move === 'up') {
    const returnTo = tabOrigin;
    moveSelection(move === 'down' ? 1 : -1, 0, false);
    if (returnTo !== null) {
      const a = st().active;
      st().select({ r: a.r, c: returnTo });
    }
  } else if (move === 'right' || move === 'left') {
    moveSelection(0, move === 'right' ? 1 : -1, false);
    tabOrigin = origin;
  }
}

export function cancelEdit() {
  st().set({ editing: null });
}

// ---------- clipboard ----------
function tsvOf(range: Range): string {
  const sh = activeSheet();
  const rows: string[] = [];
  for (let r = range.r1; r <= range.r2; r++) {
    const cols: string[] = [];
    for (let c = range.c1; c <= range.c2; c++) {
      const s = displayValue(wb.value(sh, r, c), sh.cells.get(keyOf(r, c))?.style);
      cols.push(/[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    }
    rows.push(cols.join('\t'));
  }
  return rows.join('\n');
}

export function copySelection(cut: boolean, e?: ClipboardEvent) {
  const R = clampSel();
  const sh = activeSheet();
  const tsv = tsvOf(R);
  st().set({ clip: { block: wb.readBlock(sh, R), from: { r: R.r1, c: R.c1 }, tsv, cut, sheetId: sh.id, range: R } });
  if (e?.clipboardData) {
    e.clipboardData.setData('text/plain', tsv);
    e.preventDefault();
  } else navigator.clipboard?.writeText(tsv).catch(() => {});
}

function clampSel(): Range {
  const R = selectionRange();
  const ub = wb.usedBounds(activeSheet());
  return { r1: R.r1, c1: R.c1, r2: Math.min(R.r2, Math.max(ub.r, R.r1)), c2: Math.min(R.c2, Math.max(ub.c, R.c1)) };
}

function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
    } else if (ch === '"' && cur === '') q = true;
    else if (ch === '\t') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      cur = '';
      rows.push(row);
      row = [];
    } else cur += ch;
  }
  if (cur !== '' || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

export function pasteText(text: string, valuesOnly = false) {
  const { active, clip } = st();
  const sh = activeSheet();
  const R = selectionRange();
  const r0 = R.r1;
  const c0 = R.c1;
  void active;
  if (clip && clip.tsv === text.replace(/\r\n/g, '\n').replace(/\n$/, '')) {
    wb.run(clip.cut ? 'Move' : 'Paste', 'user', () => {
      wb.pasteBlock(sh, r0, c0, clip.block, clip.from, { values: valuesOnly });
      if (clip.cut) {
        const src = wb.sheetById(clip.sheetId);
        if (src) {
          const h = clip.block.length;
          const w = clip.block[0]?.length ?? 0;
          // clear source cells not overwritten by the destination
          const dst: Range = { r1: r0, c1: c0, r2: r0 + h - 1, c2: c0 + w - 1 };
          for (let r = clip.range.r1; r <= clip.range.r2; r++)
            for (let c = clip.range.c1; c <= clip.range.c2; c++) {
              if (src.id === sh.id && r >= dst.r1 && r <= dst.r2 && c >= dst.c1 && c <= dst.c2) continue;
              wb.setCellRaw(src, r, c, undefined);
            }
        }
      }
    });
    if (clip.cut) st().set({ clip: null });
    const h = clip.block.length;
    const w = clip.block[0]?.length ?? 0;
    st().select({ r: r0, c: c0 }, { r: r0 + h - 1, c: c0 + w - 1 });
    return;
  }
  const rows = parseTsv(text);
  if (!rows.length) return;
  wb.run('Paste', 'user', () => {
    rows.forEach((row, i) =>
      row.forEach((v, j) => {
        const prev = sh.cells.get(keyOf(r0 + i, c0 + j));
        const raw = parseInput(v);
        wb.setCellRaw(sh, r0 + i, c0 + j, raw === '' ? (prev?.style ? { raw: '', style: prev.style } : undefined) : { raw, style: prev?.style });
      }),
    );
  });
  st().select({ r: r0, c: c0 }, { r: r0 + rows.length - 1, c: c0 + Math.max(...rows.map((r) => r.length)) - 1 });
}

export function clearSelection() {
  wb.clearRange(activeSheet(), selectionRange(), { contents: true });
}

export function fillDown() {
  const R = selectionRange();
  if (R.r2 === R.r1) return;
  wb.fillRange(activeSheet(), { ...R, r2: R.r1 }, R);
}
export function fillRight() {
  const R = selectionRange();
  if (R.c2 === R.c1) return;
  wb.fillRange(activeSheet(), { ...R, c2: R.c1 }, R);
}

// ---------- formatting ----------
export function styleAtActive(): CellStyle {
  const { active } = st();
  return activeSheet().cells.get(keyOf(active.r, active.c))?.style ?? {};
}

export function applyStyle(patch: Partial<CellStyle>) {
  wb.applyStyle(activeSheet(), selectionRange(), patch);
}

export function toggleStyle(key: 'b' | 'i' | 'u' | 'wrap') {
  const cur = styleAtActive()[key];
  applyStyle({ [key]: !cur });
}

// ---------- structure ----------
export function insertRowAbove() {
  const R = selectionRange();
  wb.insertRows(activeSheet(), R.r1, R.r2 - R.r1 + 1);
}
export function deleteSelectedRows() {
  const R = selectionRange();
  wb.deleteRows(activeSheet(), R.r1, R.r2 - R.r1 + 1);
}
export function insertColLeft() {
  const R = selectionRange();
  wb.insertCols(activeSheet(), R.c1, R.c2 - R.c1 + 1);
}
export function deleteSelectedCols() {
  const R = selectionRange();
  wb.deleteCols(activeSheet(), R.c1, R.c2 - R.c1 + 1);
}
export function sortSelection(asc: boolean) {
  const sh = activeSheet();
  let R = selectionRange();
  const ub = wb.usedBounds(sh);
  if (R.r1 === R.r2 && R.c1 === R.c2) R = { r1: 0, c1: 0, r2: ub.r, c2: ub.c }; // sort whole table around active cell
  const byCol = st().active.c;
  // header detection: first row all text while the next row has a number
  let hasHeader = false;
  const first = wb.value(sh, R.r1, byCol);
  const second = wb.value(sh, R.r1 + 1, byCol);
  if (typeof first === 'string' && typeof second === 'number') hasHeader = true;
  else if (R.r1 === 0) hasHeader = typeof first === 'string' && R.r2 > R.r1;
  wb.sortRange(sh, normRange(R), byCol, asc, hasHeader);
}
export function toggleFreeze() {
  const sh = activeSheet();
  const { active } = st();
  if (sh.freezeRows || sh.freezeCols) wb.setFreeze(sh, 0, 0);
  else wb.setFreeze(sh, active.r > 0 ? active.r : 1, active.c > 0 ? active.c : 0);
}

// ---------- sheets ----------
export function addSheet() {
  const s = wb.addSheet();
  st().set({ activeSheetId: s.id, anchor: { r: 0, c: 0 }, active: { r: 0, c: 0 } });
}
export function switchSheet(id: string) {
  cancelEdit();
  st().set({ activeSheetId: id, anchor: { r: 0, c: 0 }, active: { r: 0, c: 0 } });
}

// ---------- undo / redo ----------
export function undo() {
  cancelEdit();
  wb.undo();
  ensureActiveSheet();
}
export function redo() {
  cancelEdit();
  wb.redo();
  ensureActiveSheet();
}

// ---------- files ----------
function baseName(n: string) {
  return n.replace(/\.[^.]+$/, '');
}

export function newWorkbook() {
  clearFx();
  wb.loadSheets([makeSheet('Sheet1')]);
  st().set({ activeSheetId: wb.sheets[0].id, anchor: { r: 0, c: 0 }, active: { r: 0, c: 0 }, file: { name: 'Untitled', dirty: false }, msgs: [], proposal: null, editing: null, clip: null });
}

export async function openFile() {
  const f = await openFileDialog();
  if (!f) return;
  try {
    const lower = f.name.toLowerCase();
    clearFx();
    if (lower.endsWith('.xlsx')) wb.loadSheets(await xlsxToSheets(f.bytes));
    else wb.loadSheets([csvToSheet(new TextDecoder('utf-8').decode(f.bytes), baseName(f.name))]);
    st().set({ activeSheetId: wb.sheets[0].id, anchor: { r: 0, c: 0 }, active: { r: 0, c: 0 }, file: { name: f.name, path: lower.endsWith('.xlsx') ? f.path : undefined, dirty: false }, msgs: [], proposal: null, editing: null, clip: null });
  } catch (e) {
    st().showToast('Could not open file: ' + (e as Error).message);
  }
}

export async function saveFile(saveAs = false) {
  const { file } = st();
  try {
    const name = baseName(file.name) + '.xlsx';
    const bytes = await sheetsToXlsx(wb.sheets, (s, r, c) => {
      const v = wb.value(s, r, c);
      return v === null ? null : typeof v === 'object' ? String((v as { code: string }).code) : v;
    });
    const res = await saveFileDialog(name, bytes, saveAs || !file.path || !file.name.toLowerCase().endsWith('.xlsx') ? undefined : file.path);
    if (res) st().set({ file: { name: res.name, path: res.path, dirty: false } });
    return !!res;
  } catch (e) {
    st().showToast('Save failed: ' + (e as Error).message);
    return false;
  }
}

export async function exportCsv() {
  const sh = activeSheet();
  const ub = wb.usedBounds(sh);
  const text = sheetToCsv(sh, (r, c) => displayValue(wb.value(sh, r, c), undefined), ub.r, ub.c);
  await saveFileDialog(baseName(st().file.name) + '.csv', new TextEncoder().encode(text));
}

// ---------- fx hookup ----------
export function installFx() {
  wb.onTxApplied = (tx, dir) => {
    if (tx.label === 'preview') return;
    if (tx.source === 'user' && dir === 'do') return;
    const sheetId = st().activeSheetId;
    const changes = wb.cellChangesOf(tx).filter((c) => c.sheetId === sheetId);
    if (!changes.length) return;
    const sh = wb.sheetById(sheetId);
    if (!sh) return;
    const items = changes.map((ch) => {
      const r = Math.floor(ch.key / 65536);
      const c = ch.key % 65536;
      const prevCell = dir === 'undo' ? ch.after : ch.before;
      const prev = prevCell && !(typeof prevCell.raw === 'string' && prevCell.raw.startsWith('=')) ? displayValue(prevCell.raw, prevCell.style) : '';
      return { key: ch.key, prev, next: displayValue(wb.value(sh, r, c), sh.cells.get(ch.key)?.style) };
    });
    playFx(sheetId, items, tx.source === 'ai' ? 'ai' : 'user');
  };
  wb.subscribe(() => {
    const s = st();
    if (!s.file.dirty) s.set({ file: { ...s.file, dirty: true } });
  });
}

export { execContext };
