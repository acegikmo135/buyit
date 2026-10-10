import { describe, it, expect } from 'vitest';
import { parseReply } from '../src/ai/protocol';
import { screen, execute, DEFAULT_PERMISSIONS, dryRun } from '../src/ai/executor';
import { Workbook } from '../src/core/workbook';
import { localClean } from '../src/voice/clean';

describe('protocol', () => {
  it('parses fenced / noisy json', () => {
    const r = parseReply('Sure!\n```json\n{"message":"hi","actions":[{"type":"clear","range":"A1"},{"type":"bogus"}]}\n```');
    expect(r.message).toBe('hi');
    expect(r.actions).toHaveLength(1);
  });
  it('falls back to plain text', () => {
    expect(parseReply('just text').actions).toEqual([]);
  });
});

describe('executor', () => {
  const ctx = (wb: Workbook) => ({ activeSheetId: wb.sheets[0].id, selection: { r1: 0, c1: 0, r2: 2, c2: 2 } });
  it('applies fill_formula with relative shift and is one undo step', () => {
    const wb = new Workbook();
    wb.run('s', 'user', () => {
      wb.setValue(wb.sheets[0], 0, 0, 2);
      wb.setValue(wb.sheets[0], 1, 0, 3);
    });
    const n = wb.undoStack.length;
    execute(wb, [{ type: 'fill_formula', range: 'B1:B2', formula: '=A1*10' }], ctx(wb), 'AI');
    expect(wb.value(wb.sheets[0], 1, 1)).toBe(30);
    expect(wb.undoStack.length).toBe(n + 1);
    wb.undo();
    expect(wb.value(wb.sheets[0], 1, 1)).toBe(null);
  });
  it('enforces permissions and selection scope', () => {
    const wb = new Workbook();
    const c = ctx(wb);
    const acts = [
      { type: 'set_cells', cells: [{ ref: 'A1', value: 1 }] },
      { type: 'set_cells', cells: [{ ref: 'Z9', value: 1 }] },
      { type: 'delete_rows', at: 1 },
    ] as never[];
    const a = screen(acts, { ...DEFAULT_PERMISSIONS, selectionOnly: true }, c, wb);
    expect(a.ok).toHaveLength(1);
    expect(a.denied.map((d) => d.reason)).toEqual(['scope', 'scope']);
    const b = screen(acts, { ...DEFAULT_PERMISSIONS, mode: 'readonly' }, c, wb);
    expect(b.ok).toHaveLength(0);
    const d = screen(acts, { ...DEFAULT_PERMISSIONS, allow: { ...DEFAULT_PERMISSIONS.allow, delete: false } }, c, wb);
    expect(d.denied.map((x) => x.action.type)).toEqual(['delete_rows']);
  });
  it('dry run does not touch the real workbook', () => {
    const wb = new Workbook();
    const p = dryRun(wb, [{ type: 'set_range', range: 'A1:B1', values: [['x', 2]] }], ctx(wb));
    expect(p.totalCells).toBe(2);
    expect(wb.sheets[0].cells.size).toBe(0);
  });
});

describe('voice clean-up', () => {
  it('removes fillers and fixes refs', () => {
    expect(localClean('um sum a one to b five uh please')).toBe('Sum A1:B5 please');
    expect(localClean('the the total is is ready now')).toBe('The total is ready now.');
  });
  it('handles gujarati', () => {
    expect(localClean('અમ્મ કુલ ઉમેરો')).toBe('કુલ ઉમેરો');
  });
});
