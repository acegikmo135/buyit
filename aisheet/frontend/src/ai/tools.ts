// Read-only tools the model can call to look beyond the context it was given.
import { addr, keyOf, normRange, parseRange } from '../core/address';
import { displayValue } from '../core/format';
import { FormulaError } from '../core/types';
import { findAll, profileRange } from '../core/tools';
import type { Workbook } from '../core/workbook';
import type { ToolCall } from './protocol';

const MAX_CHARS = 7000;

function sheetOf(wb: Workbook, name: string | undefined, activeId: string) {
  return (name ? wb.sheetByName(name) : undefined) ?? wb.sheetById(activeId) ?? wb.sheets[0];
}

export function describeTool(t: ToolCall): string {
  switch (t.tool) {
    case 'read_range': return `Read ${t.sheet ? t.sheet + '!' : ''}${t.range}`;
    case 'search': return `Searched “${t.query}”`;
    case 'profile': return `Profiled ${t.sheet ?? 'sheet'}${t.range ? '!' + t.range : ''}`;
    case 'eval': return `Checked ${t.formula.slice(0, 40)}`;
  }
}

export function runTool(wb: Workbook, t: ToolCall, activeId: string): string {
  try {
    switch (t.tool) {
      case 'read_range': {
        const sh = sheetOf(wb, t.sheet, activeId);
        const ub = wb.usedBounds(sh);
        const R0 = parseRange(t.range, Math.max(ub.r, 0), Math.max(ub.c, 0));
        if (!R0) return `read_range: bad range "${t.range}"`;
        const R = normRange(R0);
        const r2 = Math.min(R.r2, Math.max(ub.r, R.r1), R.r1 + 399);
        const c2 = Math.min(R.c2, Math.max(ub.c, R.c1), R.c1 + 39);
        const lines: string[] = [`[${sh.name}!${addr(R.r1, R.c1)}:${addr(r2, c2)}]`];
        for (let r = R.r1; r <= r2; r++) {
          const parts: string[] = [];
          for (let c = R.c1; c <= c2; c++) {
            const cell = sh.cells.get(keyOf(r, c));
            if (!cell || cell.raw === '') continue;
            const v = wb.value(sh, r, c);
            const raw = cell.raw;
            parts.push(typeof raw === 'string' && raw.startsWith('=') ? `${addr(r, c)}=${raw} → ${v instanceof FormulaError ? v.code : displayValue(v, undefined)}` : `${addr(r, c)}=${JSON.stringify(raw)}`);
          }
          if (parts.length) lines.push(parts.join(' | '));
          if (lines.join('\n').length > MAX_CHARS) {
            lines.push('… (output truncated, narrow the range)');
            break;
          }
        }
        return lines.join('\n');
      }
      case 'search': {
        const hits = findAll(wb, activeId, t.query, { scope: t.sheet ? 'sheet' : 'workbook' }).filter((h) => !t.sheet || h.sheetName.toLowerCase() === t.sheet.toLowerCase());
        if (!hits.length) return `search "${t.query}": no matches`;
        return `search "${t.query}": ${hits.length} match(es)\n` + hits.slice(0, 40).map((h) => `${h.sheetName}!${addr(h.r, h.c)} = ${JSON.stringify(h.text)}`).join('\n');
      }
      case 'profile': {
        const sh = sheetOf(wb, t.sheet, activeId);
        const ub = wb.usedBounds(sh);
        const R = t.range ? parseRange(t.range, Math.max(ub.r, 0), Math.max(ub.c, 0)) : { r1: 0, c1: 0, r2: Math.max(ub.r, 0), c2: Math.max(ub.c, 0) };
        if (!R) return `profile: bad range "${t.range}"`;
        const prof = profileRange(wb, sh, { r1: R.r1, c1: R.c1, r2: Math.min(R.r2, ub.r), c2: Math.min(R.c2, ub.c) }, true);
        return `[profile ${sh.name}]\n` + prof.map((p) => `${p.col} "${p.header}": ${p.type}, filled ${p.filled}, distinct ${p.distinct}${p.min !== undefined ? `, min ${p.min}, max ${p.max}, mean ${Math.round((p.mean ?? 0) * 100) / 100}` : ''}${p.errors ? `, errors ${p.errors}` : ''}, samples ${JSON.stringify(p.samples)}`).join('\n');
      }
      case 'eval': {
        const sh = sheetOf(wb, t.sheet, activeId);
        const p = t.cell ? parseRange(t.cell) : null;
        const v = wb.evalExpr(sh, p?.r1 ?? 0, p?.c1 ?? 0, t.formula);
        return `eval ${t.formula} = ${v instanceof FormulaError ? v.code : JSON.stringify(v)}`;
      }
    }
  } catch (e) {
    return `tool error: ${(e as Error).message}`;
  }
}
