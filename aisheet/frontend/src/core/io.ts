import type { Cell, CellStyle, NumFmt, Sheet } from './types';
import { keyOf } from './address';
import { makeSheet } from './workbook';
import { parseInput } from './format';

// ---------- CSV ----------
export function parseCsv(text: string, delim?: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (!delim) {
    const head = text.split('\n')[0] ?? '';
    delim = (head.match(/\t/g)?.length ?? 0) > (head.match(/,/g)?.length ?? 0) ? '\t' : head.includes(';') && !head.includes(',') ? ';' : ',';
  }
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
    } else if (ch === '"') q = true;
    else if (ch === delim) {
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

export function csvToSheet(text: string, name: string): Sheet {
  const sh = makeSheet(name);
  parseCsv(text).forEach((row, r) =>
    row.forEach((v, c) => {
      if (v === '') return;
      sh.cells.set(keyOf(r, c), { raw: parseInput(v) });
    }),
  );
  return sh;
}

export function sheetToCsv(sheet: Sheet, value: (r: number, c: number) => string, maxR: number, maxC: number, delim = ','): string {
  const lines: string[] = [];
  for (let r = 0; r <= maxR; r++) {
    const cols: string[] = [];
    for (let c = 0; c <= maxC; c++) {
      const s = value(r, c);
      cols.push(/["\n\r]/.test(s) || s.includes(delim) ? `"${s.replace(/"/g, '""')}"` : s);
    }
    lines.push(cols.join(delim));
  }
  return '﻿' + lines.join('\r\n');
}

// ---------- XLSX (exceljs, lazy-loaded) ----------
const FMT_TO_XL: Partial<Record<NumFmt, string>> = {
  number: '0.00',
  integer: '0',
  thousands: '#,##0.00',
  percent: '0.00%',
  currency_usd: '"$"#,##0.00',
  currency_eur: '"€"#,##0.00',
  currency_inr: '[>=10000000]"₹"##\\,##\\,##\\,##0.00;[>=100000]"₹"##\\,##\\,##0.00;"₹"##,##0.00',
  date: 'dd/mm/yyyy',
  text: '@',
};

function xlToFmt(f: string | undefined): NumFmt | undefined {
  if (!f || f === 'General') return undefined;
  if (f === '@') return 'text';
  if (f.includes('%')) return 'percent';
  if (f.includes('₹')) return 'currency_inr';
  if (f.includes('€')) return 'currency_eur';
  if (f.includes('$')) return 'currency_usd';
  if (/[dmy]{1,4}[/\-.][dmy]{1,4}/i.test(f)) return 'date';
  if (f.includes('#,##')) return 'thousands';
  if (f === '0') return 'integer';
  if (/^0\.0+$/.test(f)) return 'number';
  return undefined;
}

function argbToHex(c?: { argb?: string }): string | undefined {
  const a = c?.argb;
  if (!a) return undefined;
  return '#' + (a.length === 8 ? a.slice(2) : a);
}
const hexToArgb = (h: string) => 'FF' + h.replace('#', '').toUpperCase();

export async function xlsxToSheets(bytes: Uint8Array): Promise<Sheet[]> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  const out: Sheet[] = [];
  wb.eachSheet((ws) => {
    const sh = makeSheet(ws.name);
    ws.eachRow({ includeEmpty: false }, (row, rn) => {
      row.eachCell({ includeEmpty: false }, (cell, cn) => {
        let raw: string | number | boolean;
        const v = cell.value as unknown;
        if (v && typeof v === 'object' && 'formula' in (v as object)) {
          raw = '=' + (v as { formula: string }).formula;
        } else if (v && typeof v === 'object' && 'sharedFormula' in (v as object)) {
          const res = (v as { result?: unknown }).result;
          raw = typeof res === 'number' || typeof res === 'string' || typeof res === 'boolean' ? res : '';
        } else if (v instanceof Date) {
          raw = Math.floor(v.getTime() / 86400000 + 25569);
        } else if (v && typeof v === 'object' && 'richText' in (v as object)) {
          raw = (v as { richText: { text: string }[] }).richText.map((t) => t.text).join('');
        } else if (v && typeof v === 'object' && 'text' in (v as object)) {
          raw = String((v as { text: unknown }).text);
        } else if (v && typeof v === 'object' && 'error' in (v as object)) {
          raw = String((v as { error: string }).error);
        } else raw = (v as string | number | boolean) ?? '';
        const style: CellStyle = {};
        const f = cell.font;
        if (f?.bold) style.b = true;
        if (f?.italic) style.i = true;
        if (f?.underline) style.u = true;
        const fc = argbToHex(f?.color as { argb?: string });
        if (fc && fc !== '#000000') style.color = fc;
        const fill = cell.fill as { type?: string; fgColor?: { argb?: string } } | undefined;
        if (fill?.type === 'pattern') {
          const bg = argbToHex(fill.fgColor);
          if (bg) style.bg = bg;
        }
        const al = cell.alignment?.horizontal;
        if (al === 'left' || al === 'center' || al === 'right') style.align = al;
        if (cell.alignment?.wrapText) style.wrap = true;
        const nf = xlToFmt(cell.numFmt);
        if (nf) style.fmt = nf;
        if (raw === '' && !Object.keys(style).length) return;
        sh.cells.set(keyOf(rn - 1, cn - 1), { raw, style: Object.keys(style).length ? style : undefined });
      });
      if (row.height) sh.rowH.set(rn - 1, Math.round(row.height * (96 / 72)));
    });
    ws.columns?.forEach((col, i) => {
      if (col && col.width) sh.colW.set(i, Math.round(col.width * 7 + 5));
    });
    const frozen = ws.views?.find((v) => v.state === 'frozen') as { xSplit?: number; ySplit?: number } | undefined;
    if (frozen) {
      sh.freezeCols = frozen.xSplit ?? 0;
      sh.freezeRows = frozen.ySplit ?? 0;
    }
    out.push(sh);
  });
  return out;
}

export async function sheetsToXlsx(sheets: Sheet[], valueOf: (s: Sheet, r: number, c: number) => string | number | boolean | null): Promise<Uint8Array> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AiSheet';
  for (const sh of sheets) {
    const ws = wb.addWorksheet(sh.name);
    for (const [k, cell] of sh.cells) {
      const r = Math.floor(k / 65536) + 1;
      const c = (k % 65536) + 1;
      const xc = ws.getCell(r, c);
      const raw = cell.raw;
      if (typeof raw === 'string' && raw.startsWith('=') && cell.style?.fmt !== 'text') {
        const res = valueOf(sh, r - 1, c - 1);
        xc.value = { formula: raw.slice(1), result: res === null ? undefined : (res as never) };
      } else if (raw !== '') xc.value = raw as never;
      const s: CellStyle | undefined = cell.style;
      if (s) {
        xc.font = { bold: s.b, italic: s.i, underline: s.u, color: s.color ? { argb: hexToArgb(s.color) } : undefined };
        if (s.bg) xc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hexToArgb(s.bg) } };
        if (s.align || s.wrap) xc.alignment = { horizontal: s.align, wrapText: s.wrap };
        if (s.fmt && FMT_TO_XL[s.fmt]) xc.numFmt = FMT_TO_XL[s.fmt]!;
      }
    }
    for (const [c, w] of sh.colW) ws.getColumn(c + 1).width = Math.max(2, (w - 5) / 7);
    for (const [r, h] of sh.rowH) ws.getRow(r + 1).height = h * (72 / 96);
    if (sh.freezeRows || sh.freezeCols) ws.views = [{ state: 'frozen', xSplit: sh.freezeCols, ySplit: sh.freezeRows }];
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

export type { Cell };
