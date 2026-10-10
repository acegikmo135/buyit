import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook';
import { shiftFormula, adjustFormula } from '../src/core/tokens';
import { parseRange, addr, parseAddr } from '../src/core/address';
import { parseInput, formatNumber, normalizeDigits } from '../src/core/format';
import { FormulaError } from '../src/core/types';

function wb(data: Record<string, string>) {
  const w = new Workbook();
  const s = w.sheets[0];
  w.run('seed', 'user', () => {
    for (const [a, v] of Object.entries(data)) {
      const p = parseAddr(a)!;
      w.setInput(s, p.r, p.c, v);
    }
  });
  const get = (a: string) => {
    const p = parseAddr(a)!;
    return w.value(w.sheets[0], p.r, p.c);
  };
  return { w, get };
}

describe('addresses', () => {
  it('round trips', () => {
    expect(addr(0, 0)).toBe('A1');
    expect(addr(26, 27)).toBe('AB27');
    expect(parseRange('B2:A1')).toEqual({ r1: 0, c1: 0, r2: 1, c2: 1 });
  });
});

describe('formulas', () => {
  it('arithmetic & precedence', () => {
    const { get } = wb({ A1: '=1+2*3', A2: '=(1+2)*3', A3: '=2^3^2', A4: '=-2^2', A5: '=10%', A6: '="a"&"b"&1' });
    expect(get('A1')).toBe(7);
    expect(get('A2')).toBe(9);
    expect(get('A3')).toBe(512);
    expect(get('A4')).toBe(4); // excel: unary minus binds tighter
    expect(get('A5')).toBe(0.1);
    expect(get('A6')).toBe('ab1');
  });
  it('aggregates and refs', () => {
    const { get } = wb({ A1: '1', A2: '2', A3: '3', B1: '=SUM(A1:A3)', B2: '=AVERAGE(A1:A3)', B3: '=MAX(A:A)', B4: '=COUNT(A1:A5)', B5: '=IF(B1>5,"big","small")' });
    expect(get('B1')).toBe(6);
    expect(get('B2')).toBe(2);
    expect(get('B3')).toBe(3);
    expect(get('B4')).toBe(3);
    expect(get('B5')).toBe('big');
  });
  it('sumif / countif / vlookup', () => {
    const { get } = wb({ A1: 'x', A2: 'y', A3: 'x', B1: '10', B2: '20', B3: '30', C1: '=SUMIF(A1:A3,"x",B1:B3)', C2: '=COUNTIF(B1:B3,">15")', C3: '=VLOOKUP("y",A1:B3,2,FALSE)', C4: '=SUMIFS(B1:B3,A1:A3,"x",B1:B3,">10")' });
    expect(get('C1')).toBe(40);
    expect(get('C2')).toBe(2);
    expect(get('C3')).toBe(20);
    expect(get('C4')).toBe(30);
  });
  it('errors', () => {
    const { get } = wb({ A1: '=1/0', A2: '=A2', A3: '=NOPE(1)', A4: '=IFERROR(A1,"ok")', A5: '=A1+1' });
    expect((get('A1') as FormulaError).code).toBe('#DIV/0!');
    expect((get('A2') as FormulaError).code).toBe('#CIRC!');
    expect((get('A3') as FormulaError).code).toBe('#NAME?');
    expect(get('A4')).toBe('ok');
    expect((get('A5') as FormulaError).code).toBe('#DIV/0!');
  });
  it('gujarati text and digits', () => {
    const { get } = wb({ A1: 'નમસ્તે', B1: '=LEN(A1)', C1: '૧૨૩', D1: '=C1*2', E1: '=UPPER("abc")&A1' });
    expect(get('C1')).toBe(123);
    expect(get('D1')).toBe(246);
    expect(get('E1')).toBe('ABCનમસ્તે');
    expect(normalizeDigits('૧૨.૫')).toBe('12.5');
  });
});

describe('reference rewriting', () => {
  it('shifts relative only', () => {
    expect(shiftFormula('=A1+$B$2+C$3', 1, 1)).toBe('=B2+$B$2+D$3');
    expect(shiftFormula('=SUM(A1:B2)', 2, 0)).toBe('=SUM(A3:B4)');
  });
  it('insert / delete rows', () => {
    const ch = { sheetName: 'Sheet1', axis: 'row' as const, at: 1, count: 1 };
    expect(adjustFormula('=SUM(A1:A3)+B2', 'Sheet1', ch)).toBe('=SUM(A1:A4)+B3');
    const del = { sheetName: 'Sheet1', axis: 'row' as const, at: 1, count: -1 };
    expect(adjustFormula('=A2', 'Sheet1', del)).toBe('=#REF!');
    expect(adjustFormula('=SUM(A1:A3)', 'Sheet1', del)).toBe('=SUM(A1:A2)');
  });
});

describe('workbook', () => {
  it('undo / redo and revert', () => {
    const { w } = wb({});
    const s = w.sheets[0];
    w.setInput(s, 0, 0, '5');
    w.setInput(s, 0, 0, '6');
    expect(w.value(w.sheets[0], 0, 0)).toBe(6);
    w.undo();
    expect(w.value(w.sheets[0], 0, 0)).toBe(5);
    w.redo();
    expect(w.value(w.sheets[0], 0, 0)).toBe(6);
    w.revertTo(0);
    expect(w.value(w.sheets[0], 0, 0)).toBe(null);
  });
  it('insert row keeps formulas right and undo restores', () => {
    const { w } = wb({ A1: '1', A2: '2', A3: '=A1+A2' });
    w.insertRows(w.sheets[0], 1, 1);
    expect(w.sheets[0].cells.get(3 * 65536)?.raw).toBe('=A1+A3');
    expect(w.value(w.sheets[0], 3, 0)).toBe(3);
    w.undo();
    expect(w.sheets[0].cells.get(2 * 65536)?.raw).toBe('=A1+A2');
  });
  it('sort', () => {
    const { w } = wb({ A1: 'n', B1: 'v', A2: 'c', B2: '3', A3: 'a', B3: '1', A4: 'b', B4: '2' });
    w.sortRange(w.sheets[0], { r1: 0, c1: 0, r2: 3, c2: 1 }, 1, true, true);
    expect([1, 2, 3].map((r) => w.value(w.sheets[0], r, 0))).toEqual(['a', 'b', 'c']);
  });
  it('rename sheet rewrites refs', () => {
    const { w } = wb({ A1: '4' });
    const s2 = w.addSheet('Data');
    w.setInput(s2, 0, 0, '=Sheet1!A1*2');
    expect(w.value(w.sheetByName('Data')!, 0, 0)).toBe(8);
    w.renameSheet(w.sheets[0], 'Main');
    expect(w.value(w.sheetByName('Data')!, 0, 0)).toBe(8);
  });
});

describe('formatting', () => {
  it('parses input', () => {
    expect(parseInput('12')).toBe(12);
    expect(parseInput('1,234.5')).toBe(1234.5);
    expect(parseInput('50%')).toBe(0.5);
    expect(parseInput('hello')).toBe('hello');
    expect(parseInput('=A1')).toBe('=A1');
  });
  it('inr grouping', () => {
    expect(formatNumber(1234567.5, 'currency_inr')).toBe('₹12,34,567.50');
    expect(formatNumber(1234567.5, 'thousands')).toBe('1,234,567.50');
  });
});
