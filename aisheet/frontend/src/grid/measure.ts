import type { CellStyle } from '../core/types';

export const FONT_FAMILY = '"Inter Variable", "Noto Sans Gujarati Variable", "Nirmala UI", "Shruti", "Segoe UI", system-ui, sans-serif';
export const FONT_SIZE = 13;

let ctx: CanvasRenderingContext2D | null = null;
const cache = new Map<string, number>();

/** Text width in CSS pixels for a cell style, using the same font as the grid. */
export function measureText(text: string, style?: CellStyle): number {
  ctx ??= document.createElement('canvas').getContext('2d')!;
  const font = `${style?.i ? 'italic ' : ''}${style?.b ? 600 : 400} ${FONT_SIZE}px ${FONT_FAMILY}`;
  const k = font + '|' + text;
  let w = cache.get(k);
  if (w === undefined) {
    ctx.font = font;
    w = ctx.measureText(text).width;
    if (cache.size > 30000) cache.clear();
    cache.set(k, w);
  }
  return w;
}

export function wrapLines(text: string, maxW: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      if (measure(line + word) > maxW && line) {
        out.push(line.trimEnd());
        line = word.trimStart();
      } else line += word;
    }
    out.push(line);
  }
  return out;
}
