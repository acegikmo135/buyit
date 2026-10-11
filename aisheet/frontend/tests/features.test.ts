import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook';
import { parseAddr, keyOf } from '../src/core/address';
import { findAll, replaceAll, removeDuplicates, buildPivot, textToColumns, profileRange, currentRegion, autoFitColumns } from '../src/core/tools';

function seed(data: string[][]) {
  const w = new Workbook();
  const s = w.sheets[0];
  w.run('seed', 'user', () => data.forEach((row, r) => row.forEach((v, c) => v !== '' && w.setInput(s, r, c, v))));
  return { w, s: w.sheets[0] };
}
const val = (w: Workbook, a: string, sheet = 0) => {
  const p = parseAddr(a)!;
  return w.value(w.sheets[sheet], p.r, p.c);
};

const SALES = [['Region', 'Rep', 'Amt'], ['North', 'A', '10'], ['South', 'B', '20'], ['North', 'B', '5'], ['South', 'A', '15'], ['North', 'A', '1']];

describe('formulas (extended)', () => {
  it('names, ifs, switch, maxifs, pmt', () => {
    const { w } = seed([['1', '2', '3'], ['=SUM(Nums)', '=IFS(A1>5,"big",A1>0,"small")', '=SWITCH(B1,1,"one",2,"two","other")'], ['=MAXIFS(A1:C1,A1:C1,"<3")', '=ROUND(PMT(0.01,12,-1000),2)', '=ROW()+COLUMN()']]);
    w.defineName('Nums', 'Sheet1!A1:C1');
    expect(val(w, 'A2')).toBe(6);
    expect(val(w, 'B2')).toBe('small');
    expect(val(w, 'C2')).toBe('two');
    expect(val(w, 'A3')).toBe(2);
    expect(val(w, 'B3')).toBe(88.85);
    expect(val(w, 'C3')).toBe(6);
  });
});

describe('structure metadata follows insert/delete', () => {
  it('shifts merges, comments, filter, names', () => {
    const { w, s } = seed(SALES);
    w.mergeCells(s, { r1: 3, c1: 0, r2: 4, c2: 0 });
    w.setComment(w.sheets[0], 5, 2, 'hello');
    w.setFilter(w.sheets[0], { r1: 0, c1: 0, r2: 5, c2: 2 });
    w.defineName('Amts', 'Sheet1!C2:C6');
    w.insertRows(w.sheets[0], 1, 2);
    const sh = w.sheets[0];
    expect(sh.merges[0]).toMatchObject({ r1: 5, r2: 6 });
    expect(sh.comments.get(keyOf(7, 2))).toBe('hello');
    expect(sh.filter!.range.r2).toBe(7);
    expect(w.names.get('Amts')).toBe('Sheet1!C4:C8');
    w.undo();
    expect(w.sheets[0].merges[0]).toMatchObject({ r1: 3, r2: 4 });
    expect(w.names.get('Amts')).toBe('Sheet1!C2:C6');
  });
  it('deleting a merged-away row removes the merge', () => {
    const { w, s } = seed(SALES);
    w.mergeCells(s, { r1: 2, c1: 0, r2: 2, c2: 1 });
    w.deleteRows(w.sheets[0], 2, 1);
    expect(w.sheets[0].merges).toHaveLength(0);
  });
});

describe('filter', () => {
  it('hides rows and restores on clear', () => {
    const { w, s } = seed(SALES);
    w.setFilter(s, { r1: 0, c1: 0, r2: 5, c2: 2 });
    expect(w.distinctValues(w.sheets[0], 0)).toEqual(['North', 'South']);
    w.setFilterColumn(w.sheets[0], 0, ['North']);
    expect([...w.sheets[0].filterHidden].sort()).toEqual([2, 4]);
    expect(w.isRowHidden(w.sheets[0], 2)).toBe(true);
    w.clearFilterCriteria(w.sheets[0]);
    expect(w.sheets[0].filterHidden.size).toBe(0);
  });
});

describe('validation', () => {
  it('list and number rules', () => {
    const { w, s } = seed(SALES);
    w.addDV(s, { id: 'a', range: { r1: 1, c1: 0, r2: 5, c2: 0 }, kind: 'list', items: ['North', 'South'] });
    w.addDV(w.sheets[0], { id: 'b', range: { r1: 1, c1: 2, r2: 5, c2: 2 }, kind: 'whole', op: 'between', v1: 0, v2: 100 });
    expect(w.validate(w.sheets[0], 1, 0, 'north')).toBeNull();
    expect(w.validate(w.sheets[0], 1, 0, 'East')).toBeTruthy();
    expect(w.validate(w.sheets[0], 1, 2, '50')).toBeNull();
    expect(w.validate(w.sheets[0], 1, 2, '500')).toBeTruthy();
    expect(w.validate(w.sheets[0], 1, 2, '1.5')).toBeTruthy();
  });
});

describe('tools', () => {
  it('find / replace', () => {
    const { w, s } = seed(SALES);
    expect(findAll(w, s.id, 'north').length).toBe(3);
    expect(findAll(w, s.id, 'north', { matchCase: true }).length).toBe(0);
    expect(replaceAll(w, s.id, 'North', 'East')).toBe(3);
    expect(val(w, 'A2')).toBe('East');
    w.undo();
    expect(val(w, 'A2')).toBe('North');
  });
  it('remove duplicates', () => {
    const { w, s } = seed([['k', 'v'], ['a', '1'], ['A', '2'], ['b', '3']]);
    expect(removeDuplicates(w, s, { r1: 0, c1: 0, r2: 3, c2: 1 }, [0], true)).toBe(1);
    expect(val(w, 'A3')).toBe('b');
    expect(val(w, 'A4')).toBeNull();
  });
  it('text to columns', () => {
    const { w, s } = seed([['a,b,c']]);
    textToColumns(w, s, { r1: 0, c1: 0, r2: 0, c2: 0 }, ',');
    expect([val(w, 'A1'), val(w, 'B1'), val(w, 'C1')]).toEqual(['a', 'b', 'c']);
  });
  it('pivot (rows × cols, live formulas)', () => {
    const { w, s } = seed(SALES);
    buildPivot(w, { sourceSheet: s.name, source: { r1: 0, c1: 0, r2: 5, c2: 2 }, rowField: 0, colField: 1, valueField: 2, agg: 'sum', target: 'Pivot' });
    const pv = (a: string) => val(w, a, 1);
    // layout: row1 title, row2 headers [Region, A, B, Grand Total]
    expect([pv('A2'), pv('B2'), pv('C2'), pv('D2')]).toEqual(['Region', 'A', 'B', 'Grand Total']);
    expect([pv('A3'), pv('B3'), pv('C3'), pv('D3')]).toEqual(['North', 11, 5, 16]);
    expect([pv('A4'), pv('B4'), pv('C4'), pv('D4')]).toEqual(['South', 15, 20, 35]);
    expect(pv('D5')).toBe(51);
    // live: change source
    w.setInput(w.sheets[0], 1, 2, '100');
    expect(pv('D5')).toBe(141);
  });
  it('pivot count / avg without column field', () => {
    const { w, s } = seed(SALES);
    buildPivot(w, { sourceSheet: s.name, source: { r1: 0, c1: 0, r2: 5, c2: 2 }, rowField: 0, valueField: 2, agg: 'avg', target: 'P2' });
    expect(val(w, 'B3', 1)).toBeCloseTo(16 / 3);
  });
  it('profile + current region + autofit', () => {
    const { w, s } = seed(SALES);
    const p = profileRange(w, s, { r1: 0, c1: 0, r2: 5, c2: 2 });
    expect(p[2]).toMatchObject({ header: 'Amt', type: 'number', min: 1, max: 20 });
    expect(p[0]).toMatchObject({ type: 'text', distinct: 2 });
    expect(currentRegion(w, s, 2, 1)).toEqual({ r1: 0, c1: 0, r2: 5, c2: 2 });
    const n = autoFitColumns(w, s, null, (t) => t.length * 10);
    expect(n).toBeGreaterThan(0);
    expect(w.sheets[0].colW.get(0)).toBe(Math.round('Region'.length * 10 + 22));
  });
});

describe('borders & merges', () => {
  it('outer border preset', () => {
    const { w, s } = seed(SALES);
    w.setBorders(s, { r1: 0, c1: 0, r2: 1, c2: 1 }, 'outer');
    const c = (r: number, cc: number) => w.sheets[0].cells.get(keyOf(r, cc))?.style?.bd;
    expect(c(0, 0)).toMatchObject({ t: { s: 'thin' }, l: { s: 'thin' } });
    expect(c(0, 0)?.b).toBeUndefined();
    expect(c(1, 1)).toMatchObject({ b: { s: 'thin' }, r: { s: 'thin' } });
    w.setBorders(w.sheets[0], { r1: 0, c1: 0, r2: 1, c2: 1 }, 'none');
    expect(c(0, 0)).toBeUndefined();
  });
  it('merge keeps top-left value only', () => {
    const { w, s } = seed([['x', 'y'], ['z', 'w']]);
    w.mergeCells(s, { r1: 0, c1: 0, r2: 1, c2: 1 });
    expect(val(w, 'A1')).toBe('x');
    expect(val(w, 'B1')).toBeNull();
    w.undo();
    expect(val(w, 'B1')).toBe('y');
  });
});
