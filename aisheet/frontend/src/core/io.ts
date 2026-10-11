import type { Border, Borders, BorderStyle, Cell, CellStyle, CFRule, ChartDef, DVRule, NumFmt, PageSetup, Sheet } from './types';
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
  accounting_inr: '_("₹"* #,##0.00_);_("₹"* (#,##0.00);_("₹"* "-"??_);_(@_)',
  date: 'dd/mm/yyyy',
  datetime: 'dd/mm/yyyy hh:mm',
  time: 'hh:mm:ss',
  scientific: '0.00E+00',
  text: '@',
};

function xlToFmt(f: string | undefined): NumFmt | undefined {
  if (!f || f === 'General') return undefined;
  if (f === '@') return 'text';
  if (f.includes('E+')) return 'scientific';
  if (f.includes('%')) return 'percent';
  if (f.includes('₹')) return f.includes('* ') ? 'accounting_inr' : 'currency_inr';
  if (f.includes('€')) return 'currency_eur';
  if (f.includes('$')) return 'currency_usd';
  if (/[dmy]{1,4}[/\-.][dmy]{1,4}.*h{1,2}:mm/i.test(f)) return 'datetime';
  if (/^h{1,2}:mm/i.test(f)) return 'time';
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
const hexToArgb = (h: string) => 'FF' + h.replace('#', '').toUpperCase().slice(-6);

const BORDER_OUT: Record<BorderStyle, string> = { thin: 'thin', medium: 'medium', thick: 'thick', dashed: 'dashed', dotted: 'dotted', double: 'double' };
const SIDES: [keyof Borders, 'top' | 'right' | 'bottom' | 'left'][] = [['t', 'top'], ['r', 'right'], ['b', 'bottom'], ['l', 'left']];

const META_SHEET = '__AiSheet';

interface SheetMeta {
  charts?: ChartDef[];
  cf?: CFRule[];
  page?: PageSetup;
  hideGrid?: boolean;
  filterAllowed?: Record<number, string[]>;
  freeze?: [number, number];
}

export interface LoadedWorkbook {
  sheets: Sheet[];
  names: Map<string, string>;
}

const rangeOf = (a: string) => {
  const m = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/i.exec(a.trim());
  if (!m) return null;
  const col = (n: string) => n.toUpperCase().split('').reduce((x, ch) => x * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return { r1: +m[2] - 1, c1: col(m[1]), r2: +(m[4] ?? m[2]) - 1, c2: col(m[3] ?? m[1]) };
};

export async function xlsxToWorkbook(bytes: Uint8Array): Promise<LoadedWorkbook> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  const out: Sheet[] = [];
  let meta: Record<string, SheetMeta> = {};
  const metaWs = wb.getWorksheet(META_SHEET);
  if (metaWs) {
    try {
      let json = '';
      for (let r = 1; r <= metaWs.rowCount; r++) json += String(metaWs.getCell(r, 1).value ?? '');
      meta = JSON.parse(json);
    } catch {
      /* ignore damaged metadata */
    }
  }
  wb.eachSheet((ws) => {
    if (ws.name === META_SHEET) return;
    const sh = makeSheet(ws.name);
    ws.eachRow({ includeEmpty: false }, (row, rn) => {
      if (row.hidden) sh.hiddenRows.add(rn - 1);
      row.eachCell({ includeEmpty: false }, (cell, cn) => {
        const master = (cell as unknown as { master?: { address: string } }).master;
        if (cell.isMerged && master && master.address !== cell.address) return; // covered by a merge
        let raw: string | number | boolean;
        const v = cell.value as unknown;
        if (v && typeof v === 'object' && 'formula' in (v as object)) {
          raw = '=' + (v as { formula: string }).formula;
        } else if (v && typeof v === 'object' && 'sharedFormula' in (v as object)) {
          const res = (v as { result?: unknown }).result;
          raw = typeof res === 'number' || typeof res === 'string' || typeof res === 'boolean' ? res : '';
        } else if (v instanceof Date) {
          raw = v.getTime() / 86400000 + 25569;
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
        const al = cell.alignment;
        if (al?.horizontal === 'left' || al?.horizontal === 'center' || al?.horizontal === 'right') style.align = al.horizontal as 'left' | 'center' | 'right';
        else if ((al?.horizontal as string) === 'centerContinuous') style.align = 'center';
        if (al?.wrapText) style.wrap = true;
        if (al?.vertical === 'top' || al?.vertical === 'bottom') style.valign = al.vertical;
        else if (al?.vertical === 'middle') style.valign = 'middle';
        if (al?.indent) style.indent = al.indent;
        const nf = xlToFmt(cell.numFmt);
        if (nf) style.fmt = nf;
        const b = cell.border as Partial<Record<'top' | 'right' | 'bottom' | 'left', { style?: string; color?: { argb?: string } }>> | undefined;
        if (b) {
          const bd: Borders = {};
          for (const [k, name] of SIDES) {
            const side = b[name];
            if (side?.style) bd[k] = { s: (Object.keys(BORDER_OUT).includes(side.style) ? side.style : side.style === 'hair' ? 'dotted' : side.style === 'mediumDashed' ? 'dashed' : 'thin') as BorderStyle, c: argbToHex(side.color) } as Border;
          }
          if (Object.keys(bd).length) style.bd = bd;
        }
        if (raw === '' && !Object.keys(style).length) return;
        sh.cells.set(keyOf(rn - 1, cn - 1), { raw, style: Object.keys(style).length ? style : undefined });
        // data validation
        const dv = (cell as unknown as { dataValidation?: { type?: string; formulae?: string[]; operator?: string; error?: string } }).dataValidation;
        if (dv?.type) {
          const f0 = dv.formulae?.[0] ?? '';
          const rule: DVRule = { id: `x${rn}_${cn}`, range: { r1: rn - 1, c1: cn - 1, r2: rn - 1, c2: cn - 1 }, kind: 'custom', message: dv.error };
          if (dv.type === 'list') {
            rule.kind = 'list';
            if (f0.startsWith('"')) rule.items = f0.replace(/^"|"$/g, '').split(',');
            else rule.source = f0.replace(/\$/g, '');
          } else if (dv.type === 'whole' || dv.type === 'decimal' || dv.type === 'textLength' || dv.type === 'date') {
            rule.kind = dv.type;
            rule.op = ({ between: 'between', notBetween: 'notBetween', equal: '=', notEqual: '<>', greaterThan: '>', lessThan: '<', greaterThanOrEqual: '>=', lessThanOrEqual: '<=' } as Record<string, DVRule['op']>)[dv.operator ?? 'between'];
            rule.v1 = Number(f0);
            rule.v2 = Number(dv.formulae?.[1] ?? 0);
          }
          if (rule.kind !== 'custom') {
            // merge adjacent identical rules vertically to keep the rule list small
            const last = sh.validations[sh.validations.length - 1];
            const same = last && last.kind === rule.kind && JSON.stringify({ ...last, id: 0, range: 0 }) === JSON.stringify({ ...rule, id: 0, range: 0 });
            if (same && last.range.c1 === rule.range.c1 && last.range.c2 === rule.range.c2 && last.range.r2 + 1 === rule.range.r1) last.range = { ...last.range, r2: rule.range.r2 };
            else sh.validations.push(rule);
          }
        }
        const note = (cell as unknown as { note?: string | { texts?: { text: string }[] } }).note;
        if (note) sh.comments.set(keyOf(rn - 1, cn - 1), typeof note === 'string' ? note : (note.texts ?? []).map((x) => x.text).join(''));
      });
      if (row.height) sh.rowH.set(rn - 1, Math.round(row.height * (96 / 72)));
    });
    ws.columns?.forEach((col, i) => {
      if (col && col.width) sh.colW.set(i, Math.round(col.width * 7 + 5));
      if (col && col.hidden) sh.hiddenCols.add(i);
    });
    const merges = (ws.model as unknown as { merges?: string[] }).merges ?? [];
    for (const m of merges) {
      const R = rangeOf(m);
      if (R) sh.merges.push(R);
    }
    const af = ws.autoFilter as unknown;
    if (af) {
      const ref = typeof af === 'string' ? af : af && typeof af === 'object' && 'from' in af ? `${(af as { from: { row: number; column: number } }).from.row}:${(af as { from: { column: number } }).from.column}` : '';
      const R = typeof af === 'string' ? rangeOf(af) : af && typeof af === 'object' && 'from' in af && 'to' in af
        ? { r1: (af as { from: { row: number } }).from.row - 1, c1: (af as { from: { column: number } }).from.column - 1, r2: (af as { to: { row: number } }).to.row - 1, c2: (af as { to: { column: number } }).to.column - 1 } : null;
      void ref;
      if (R) sh.filter = { range: R, allowed: {} };
    }
    const frozen = ws.views?.find((v) => v.state === 'frozen') as { xSplit?: number; ySplit?: number } | undefined;
    if (frozen) {
      sh.freezeCols = frozen.xSplit ?? 0;
      sh.freezeRows = frozen.ySplit ?? 0;
    }
    const m = meta[ws.name];
    if (m) {
      if (m.charts) sh.charts = m.charts;
      if (m.cf) sh.cf = m.cf;
      if (m.page) sh.page = m.page;
      if (m.hideGrid) sh.hideGrid = true;
      if (sh.filter && m.filterAllowed) sh.filter.allowed = m.filterAllowed;
    }
    out.push(sh);
  });
  const names = new Map<string, string>();
  const dn = (wb.definedNames as unknown as { model?: { name: string; ranges: string[] }[] }).model ?? [];
  for (const d of dn) if (d.name && d.ranges?.[0]) names.set(d.name, d.ranges[0].replace(/\$/g, ''));
  return { sheets: out, names };
}

/** Back-compat helper for callers that only need sheets. */
export async function xlsxToSheets(bytes: Uint8Array): Promise<Sheet[]> {
  return (await xlsxToWorkbook(bytes)).sheets;
}

export async function workbookToXlsx(sheets: Sheet[], names: Map<string, string>, valueOf: (s: Sheet, r: number, c: number) => string | number | boolean | null): Promise<Uint8Array> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AiSheet';
  const meta: Record<string, SheetMeta> = {};
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
        if (s.bg && /^#[0-9a-f]{6}$/i.test(s.bg)) xc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hexToArgb(s.bg) } };
        if (s.align || s.wrap || s.valign || s.indent) xc.alignment = { horizontal: s.align, wrapText: s.wrap, vertical: s.valign, indent: s.indent };
        if (s.fmt && FMT_TO_XL[s.fmt]) xc.numFmt = FMT_TO_XL[s.fmt]!;
        if (s.bd) {
          const border: Record<string, unknown> = {};
          for (const [k2, name] of SIDES) {
            const b = s.bd[k2];
            if (b) border[name] = { style: BORDER_OUT[b.s], color: b.c ? { argb: hexToArgb(b.c) } : undefined };
          }
          xc.border = border as never;
        }
      }
      const note = sh.comments.get(k);
      if (note) xc.note = note;
    }
    // comments on empty cells
    for (const [k, text] of sh.comments) if (!sh.cells.has(k)) ws.getCell(Math.floor(k / 65536) + 1, (k % 65536) + 1).note = text;
    for (const m of sh.merges) ws.mergeCells(m.r1 + 1, m.c1 + 1, m.r2 + 1, m.c2 + 1);
    for (const [c, w] of sh.colW) ws.getColumn(c + 1).width = Math.max(2, (w - 5) / 7);
    for (const c of sh.hiddenCols) ws.getColumn(c + 1).hidden = true;
    for (const [r, h] of sh.rowH) ws.getRow(r + 1).height = h * (72 / 96);
    for (const r of sh.hiddenRows) ws.getRow(r + 1).hidden = true;
    for (const r of sh.filterHidden) ws.getRow(r + 1).hidden = true;
    if (sh.freezeRows || sh.freezeCols) ws.views = [{ state: 'frozen', xSplit: sh.freezeCols, ySplit: sh.freezeRows }];
    if (sh.filter) {
      const f = sh.filter.range;
      ws.autoFilter = { from: { row: f.r1 + 1, column: f.c1 + 1 }, to: { row: f.r2 + 1, column: f.c2 + 1 } };
    }
    for (const rule of sh.validations) {
      for (let r = rule.range.r1; r <= Math.min(rule.range.r2, rule.range.r1 + 5000); r++)
        for (let c = rule.range.c1; c <= Math.min(rule.range.c2, rule.range.c1 + 200); c++) {
          const cell = ws.getCell(r + 1, c + 1);
          if (rule.kind === 'list') cell.dataValidation = { type: 'list', allowBlank: true, formulae: [rule.items ? `"${rule.items.join(',')}"` : rule.source ?? ''], showErrorMessage: true, error: rule.message } as never;
          else if (rule.kind === 'whole' || rule.kind === 'decimal' || rule.kind === 'textLength' || rule.kind === 'date') {
            const opName = ({ between: 'between', notBetween: 'notBetween', '=': 'equal', '<>': 'notEqual', '>': 'greaterThan', '<': 'lessThan', '>=': 'greaterThanOrEqual', '<=': 'lessThanOrEqual' } as Record<string, string>)[rule.op ?? 'between'];
            cell.dataValidation = { type: rule.kind, operator: opName, allowBlank: true, formulae: [rule.v1 ?? 0, ...(opName === 'between' || opName === 'notBetween' ? [rule.v2 ?? 0] : [])], showErrorMessage: true, error: rule.message } as never;
          }
        }
    }
    const m: SheetMeta = {};
    if (sh.charts.length) m.charts = sh.charts;
    if (sh.cf.length) m.cf = sh.cf;
    if (sh.page.orientation !== 'portrait' || sh.page.gridlines || sh.page.headers || sh.page.paper !== 'A4' || !sh.page.fitWidth) m.page = sh.page;
    if (sh.hideGrid) m.hideGrid = true;
    if (sh.filter && Object.keys(sh.filter.allowed).length) m.filterAllowed = sh.filter.allowed;
    if (Object.keys(m).length) meta[sh.name] = m;
  }
  for (const [name, ref] of names) {
    try {
      const m = /^(?:'?([^'!]+)'?!)?(.+)$/.exec(ref);
      if (m) wb.definedNames.add(`${/[^A-Za-z0-9_]/.test(m[1] ?? sheets[0].name) ? `'${m[1] ?? sheets[0].name}'` : m[1] ?? sheets[0].name}!${m[2].replace(/([A-Z]+)(\d+)/gi, '$$$1$$$2')}`, name);
    } catch {
      /* skip invalid names */
    }
  }
  if (Object.keys(meta).length) {
    // AiSheet-only features (charts, conditional formats, page setup) live in a hidden sheet so they survive a save/open round trip.
    const ms = wb.addWorksheet(META_SHEET, { state: 'veryHidden' });
    const json = JSON.stringify(meta);
    for (let i = 0, r = 1; i < json.length; i += 30000, r++) ms.getCell(r, 1).value = json.slice(i, i + 30000);
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

export async function sheetsToXlsx(sheets: Sheet[], valueOf: (s: Sheet, r: number, c: number) => string | number | boolean | null): Promise<Uint8Array> {
  return workbookToXlsx(sheets, new Map(), valueOf);
}

export type { Cell };
