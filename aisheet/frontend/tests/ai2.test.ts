import { describe, it, expect } from 'vitest';
import { parseReply } from '../src/ai/protocol';
import { execute, dryRun } from '../src/ai/executor';
import type { Action } from '../src/ai/protocol';
import { Workbook } from '../src/core/workbook';

const seed = () => {
  const wb = new Workbook();
  const s = wb.sheets[0];
  wb.run('seed', 'user', () => {
    [['Region', 'Sales'], ['North', '100'], ['South', '200'], ['North', '50']].forEach((row, r) => row.forEach((v, c) => wb.setInput(s, r, c, v)));
  });
  return { wb, s, ctx: { activeSheetId: s.id, selection: null } };
};

describe('protocol: tools and plans', () => {
  it('parses tool calls and plans', () => {
    const r = parseReply('Looking.\n```tool\n[{"tool":"read_range","range":"A1:B4"}]\n```');
    expect(r.tools).toHaveLength(1);
    const p = parseReply('Plan\n```plan\n{"goal":"g","tasks":[{"id":"t1","title":"a","instruction":"do a"},{"id":"t2","title":"b","instruction":"do b","depends":["t1"]}]}\n```');
    expect(p.plan?.tasks).toHaveLength(2);
  });
});

describe('executor: Excel features', () => {
  it('merges, borders, charts, validation, filter, pivot, comments, names in one transaction', () => {
    const { wb, s, ctx } = seed();
    const acts: Action[] = [
      { type: 'merge', range: 'D1:E1' },
      { type: 'borders', range: 'A1:B4', preset: 'all' },
      { type: 'add_chart', chartType: 'column', range: 'A1:B4', title: 'T' },
      { type: 'data_validation', range: 'C2:C4', kind: 'list', items: ['a', 'b'] },
      { type: 'filter', range: 'A1:B4' },
      { type: 'add_comment', ref: 'A1', text: 'hello' },
      { type: 'define_name', name: 'SalesCol', ref: 'B2:B4' },
      { type: 'autofit' },
    ] as Action[];
    const res = execute(wb, acts, ctx, 'multi');
    expect(res.errors).toEqual([]);
    expect(s.merges).toHaveLength(1);
    expect(s.charts).toHaveLength(1);
    expect(s.validations).toHaveLength(1);
    expect(s.filter).toBeTruthy();
    expect(s.comments.size ?? Object.keys(s.comments).length).toBeGreaterThan(0);
    wb.setInput(s, 5, 1, '=SUM(SalesCol)');
    expect(wb.value(s, 5, 1)).toBe(350);
  });

  it('pivot action builds live totals', () => {
    const { wb, ctx } = seed();
    const res = execute(wb, [{ type: 'pivot', source: 'A1:B4', rows: 'Region', values: 'Sales', agg: 'sum', targetSheet: 'Pivot' } as Action], ctx, 'p');
    expect(res.errors).toEqual([]);
    const pv = wb.sheets.find((x) => x.name === 'Pivot')!;
    const vals: unknown[] = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 3; c++) vals.push(wb.value(pv, r, c));
    expect(vals).toContain(150);
    expect(vals).toContain(350);
  });

  it('dry-run flags newly introduced formula errors', () => {
    const { wb, ctx } = seed();
    const p = dryRun(wb, [{ type: 'set_cells', cells: [{ ref: 'D1', value: '=1/0' }] } as Action], ctx);
    expect(p.newErrors.length).toBe(1);
  });
});
