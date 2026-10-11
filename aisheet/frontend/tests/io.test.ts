import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook';
import { workbookToXlsx, xlsxToWorkbook } from '../src/core/io';
import { keyOf } from '../src/core/address';

describe('xlsx round trip of Excel + AiSheet features', () => {
  it('keeps merges, borders, validation, comments, filter, names, charts, conditional formats', async () => {
    const w = new Workbook();
    const s = w.sheets[0];
    w.run('seed', 'user', () => {
      ['Region', 'Amt', 'Note'].forEach((v, c) => w.setInput(s, 0, c, v));
      [['North', '10'], ['South', '25'], ['East', '7']].forEach((row, i) => row.forEach((v, c) => w.setInput(s, i + 1, c, v)));
      w.setInput(s, 4, 1, '=SUM(B2:B4)');
    });
    w.mergeCells(w.sheets[0], { r1: 0, c1: 2, r2: 0, c2: 3 });
    w.setBorders(w.sheets[0], { r1: 0, c1: 0, r2: 1, c2: 1 }, 'all', { s: 'medium', c: '#ff0000' });
    w.addDV(w.sheets[0], { id: 'a', range: { r1: 1, c1: 0, r2: 3, c2: 0 }, kind: 'list', items: ['North', 'South', 'East'], message: 'Pick a region' });
    w.addDV(w.sheets[0], { id: 'b', range: { r1: 1, c1: 1, r2: 3, c2: 1 }, kind: 'whole', op: 'between', v1: 0, v2: 100 });
    w.setComment(w.sheets[0], 1, 1, 'check this');
    w.setFilter(w.sheets[0], { r1: 0, c1: 0, r2: 3, c2: 1 });
    w.defineName('Amounts', 'Sheet1!B2:B4');
    w.addChart(w.sheets[0], { id: 'c1', type: 'pie', title: 'Share', range: 'A1:B4', headerRow: true, headerCol: true, legend: true, x: 10, y: 20, w: 300, h: 200 });
    w.addCF(w.sheets[0], { id: 'k1', range: { r1: 1, c1: 1, r2: 3, c2: 1 }, kind: 'cell', op: '>', v1: 20, style: { bg: '#fecaca' } });
    w.setHidden(w.sheets[0], 'row', 3, 3, true);

    const bytes = await workbookToXlsx(w.sheets, w.names, (sh, r, c) => {
      const v = w.value(sh, r, c);
      return typeof v === 'object' && v !== null ? String((v as { code: string }).code) : v;
    });
    const back = await xlsxToWorkbook(bytes);
    const sh = back.sheets[0];
    expect(sh.merges).toContainEqual({ r1: 0, c1: 2, r2: 0, c2: 3 });
    expect(sh.cells.get(keyOf(0, 0))?.style?.bd?.t).toMatchObject({ s: 'medium' });
    expect(sh.comments.get(keyOf(1, 1))).toBe('check this');
    expect(sh.validations.some((v) => v.kind === 'list' && v.items?.includes('South'))).toBe(true);
    expect(sh.validations.some((v) => v.kind === 'whole' && v.v2 === 100)).toBe(true);
    expect(sh.filter?.range).toMatchObject({ r1: 0, c1: 0, r2: 3, c2: 1 });
    expect(back.names.get('Amounts')).toBe('Sheet1!B2:B4');
    expect(sh.charts[0]).toMatchObject({ type: 'pie', title: 'Share', range: 'A1:B4' });
    expect(sh.cf[0]).toMatchObject({ kind: 'cell', v1: 20 });
    expect(sh.hiddenRows.has(3)).toBe(true);
    expect(sh.cells.get(keyOf(4, 1))?.raw).toBe('=SUM(B2:B4)');
    // hidden metadata sheet must not appear as a real sheet
    expect(back.sheets.map((x) => x.name)).toEqual(['Sheet1']);
  });
});
