import { colToName, keyOf } from './address';
import { displayValue } from './format';
import type { Sheet } from './types';
import type { Workbook } from './workbook';
import { FormulaError } from './types';
import { cfFor } from '../grid/cf';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const BORDER_W: Record<string, string> = { thin: '1px', medium: '2px', thick: '3px', dashed: '1px', dotted: '1px', double: '3px' };

/** HTML table for the sheet's used range (print preview / PDF export). */
export function sheetToPrintHtml(wb: Workbook, sh: Sheet): string {
  const ub = wb.usedBounds(sh);
  if (ub.r < 0) return '<p>Empty sheet</p>';
  const p = sh.page;
  const cols: number[] = [];
  for (let c = 0; c <= ub.c; c++) if (!sh.hiddenCols.has(c)) cols.push(c);
  const rows: number[] = [];
  for (let r = 0; r <= ub.r; r++) if (!wb.isRowHidden(sh, r)) rows.push(r);
  const covered = new Set<number>();
  const mergeAt = new Map<number, { rs: number; cs: number }>();
  for (const m of sh.merges) {
    mergeAt.set(keyOf(m.r1, m.c1), { rs: m.r2 - m.r1 + 1, cs: m.c2 - m.c1 + 1 });
    for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if (r !== m.r1 || c !== m.c1) covered.add(keyOf(r, c));
  }
  let html = `<table class="pt${p.gridlines ? ' grid' : ''}"><colgroup>${p.headers ? '<col style="width:34px">' : ''}${cols.map((c) => `<col style="width:${sh.colW.get(c) ?? 104}px">`).join('')}</colgroup>`;
  if (p.headers) html += `<thead><tr><th></th>${cols.map((c) => `<th>${colToName(c)}</th>`).join('')}</tr></thead>`;
  html += '<tbody>';
  rows.forEach((r, ri) => {
    const repeat = p.repeatHeaderRow && ri === 0 ? ' class="hdr"' : '';
    html += `<tr${repeat}${sh.rowH.get(r) ? ` style="height:${sh.rowH.get(r)}px"` : ''}>`;
    if (p.headers) html += `<th>${r + 1}</th>`;
    for (const c of cols) {
      const key = keyOf(r, c);
      if (covered.has(key)) continue;
      const cell = sh.cells.get(key);
      const v = cell ? wb.value(sh, r, c) : null;
      const cf = cell ? cfFor(wb, sh, r, c, v) : null;
      const st = cell?.style;
      const css: string[] = [];
      const bg = cf?.bg ?? st?.bg;
      if (bg) css.push(`background:${bg}`);
      if (cf?.color ?? st?.color) css.push(`color:${cf?.color ?? st?.color}`);
      if (st?.b || cf?.b) css.push('font-weight:600');
      if (st?.i) css.push('font-style:italic');
      if (st?.u) css.push('text-decoration:underline');
      css.push(`text-align:${st?.align ?? (typeof v === 'number' ? 'right' : 'left')}`);
      if (st?.wrap) css.push('white-space:pre-wrap');
      if (st?.bd) for (const [side, name] of [['t', 'top'], ['r', 'right'], ['b', 'bottom'], ['l', 'left']] as const) {
        const b = st.bd[side];
        if (b) css.push(`border-${name}:${BORDER_W[b.s]} ${b.s === 'dashed' || b.s === 'dotted' || b.s === 'double' ? b.s : 'solid'} ${b.c ?? '#000'}`);
      }
      const m = mergeAt.get(key);
      const text = v instanceof FormulaError ? v.code : displayValue(v, st);
      html += `<td${m ? ` rowspan="${m.rs}" colspan="${m.cs}"` : ''} style="${css.join(';')}">${esc(text)}</td>`;
    }
    html += '</tr>';
  });
  return html + '</tbody></table>';
}

export function printSheet(wb: Workbook, sh: Sheet) {
  const p = sh.page;
  const root = document.createElement('div');
  root.id = 'print-root';
  const css = `
    @page { size: ${p.paper} ${p.orientation}; margin: 12mm; }
    #print-root { font-family: 'Inter Variable','Noto Sans Gujarati Variable','Nirmala UI','Segoe UI',sans-serif; font-size: 11px; color:#111; }
    #print-root h1 { font-size: 13px; margin: 0 0 6px; }
    #print-root table.pt { border-collapse: collapse; ${p.fitWidth ? 'width:100%;table-layout:auto;' : ''} }
    #print-root td, #print-root th { padding: 3px 6px; vertical-align: middle; }
    #print-root table.grid td, #print-root table.grid th { border: 1px solid #c8c8d0; }
    #print-root th { background:#f1f1f5; font-weight:600; color:#555; }
    #print-root thead, #print-root tr.hdr { display: table-header-group; }
  `;
  root.innerHTML = `<style>${css}</style><h1>${esc(sh.name)}</h1>${sheetToPrintHtml(wb, sh)}`;
  document.body.appendChild(root);
  const cleanup = () => {
    root.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  setTimeout(() => window.print(), 50);
  setTimeout(cleanup, 120000);
}
