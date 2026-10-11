import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore, useWbVersion, wb, selectionRange } from '../store';
import { addr, keyOf, type Range } from '../core/address';
import { buildAxis, indexAt, DEF_COL_W, DEF_ROW_H, HEADER_H, HEADER_W } from './layout';
import { fxFor, fxTick, subscribeFx } from './fx';
import { renderGrid, readTheme, filterBtnRect, dvBtnRect, type Theme } from './render';
import { FONT_FAMILY, FONT_SIZE } from './measure';
import * as A from '../actions';
import { ContextMenu, type MenuItem } from '../ui/ContextMenu';
import { FilterMenu, DvMenu, CommentTip } from '../ui/GridPopups';
import { ChartView } from '../ui/ChartView';
import { useT } from '../i18n';

type Drag =
  | { kind: 'select' }
  | { kind: 'cols'; from: number }
  | { kind: 'rows'; from: number }
  | { kind: 'colResize'; col: number; startX: number; startW: number }
  | { kind: 'rowResize'; row: number; startY: number; startH: number }
  | { kind: 'fill'; src: Range };

let focusFn: (() => void) | null = null;
export const focusGrid = () => focusFn?.();

const measureCache = new Map<string, number>();

export function GridCanvas() {
  const t = useT();
  const ver = useWbVersion();
  const activeSheetId = useStore((s) => s.activeSheetId);
  const anchor = useStore((s) => s.anchor);
  const active = useStore((s) => s.active);
  const editing = useStore((s) => s.editing);
  const clip = useStore((s) => s.clip);
  const proposal = useStore((s) => s.proposal);
  const zoom = useStore((s) => s.zoom);
  const find = useStore((s) => s.find);

  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [grow, setGrow] = useState({ r: 0, c: 0 });
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [filterMenu, setFilterMenu] = useState<{ col: number; x: number; y: number } | null>(null);
  const [dvMenu, setDvMenu] = useState<{ r: number; c: number; items: string[]; x: number; y: number } | null>(null);
  const [tip, setTip] = useState<{ text: string; x: number; y: number; key: number } | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const hoverRef = useRef<string>('default');
  const fillTarget = useRef<Range | null>(null);
  const themeRef = useRef<Theme | null>(null);
  const rafRef = useRef(0);
  const composing = useRef(false);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const sheet = wb.sheetById(activeSheetId) ?? wb.sheets[0];

  // ---------- axes (hidden / filtered rows and hidden columns collapse to zero size) ----------
  const dims = useMemo(() => {
    const ub = wb.usedBounds(sheet);
    const nRows = Math.max(100, ub.r + 40, grow.r, active.r + 30);
    const nCols = Math.max(26, ub.c + 8, grow.c, active.c + 8);
    let rowOver = sheet.rowH;
    if (sheet.hiddenRows.size || sheet.filterHidden.size) {
      rowOver = new Map(sheet.rowH);
      sheet.hiddenRows.forEach((r) => rowOver.set(r, 0));
      sheet.filterHidden.forEach((r) => rowOver.set(r, 0));
    }
    let colOver = sheet.colW;
    if (sheet.hiddenCols.size) {
      colOver = new Map(sheet.colW);
      sheet.hiddenCols.forEach((c) => colOver.set(c, 0));
    }
    return { nRows, nCols, rows: buildAxis(nRows, DEF_ROW_H, rowOver), cols: buildAxis(nCols, DEF_COL_W, colOver) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ver, sheet.id, grow.r, grow.c, active.r, active.c]);

  const dimsRef = useRef(dims);
  dimsRef.current = dims;

  // ---------- drawing ----------
  const draw = useCallback(() => {
    rafRef.current = 0;
    const canvas = canvasRef.current;
    const scroller = scrollerRef.current;
    if (!canvas || !scroller) return;
    const Z = zoomRef.current;
    const dpr = window.devicePixelRatio || 1;
    const cwPx = scroller.clientWidth;
    const chPx = scroller.clientHeight;
    if (canvas.width !== Math.round(cwPx * dpr) || canvas.height !== Math.round(chPx * dpr)) {
      canvas.width = Math.round(cwPx * dpr);
      canvas.height = Math.round(chPx * dpr);
      canvas.style.width = cwPx + 'px';
      canvas.style.height = chPx + 'px';
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr * Z, 0, 0, dpr * Z, 0, 0);
    const th = (themeRef.current ??= readTheme(wrapRef.current!));
    const s = useStore.getState();
    const sh = wb.sheetById(s.activeSheetId) ?? wb.sheets[0];
    const { rows, cols, nRows, nCols } = dimsRef.current;
    const now = performance.now();
    const measure = (text: string, font: string) => {
      const k = font + '|' + text;
      let w = measureCache.get(k);
      if (w === undefined) {
        ctx.font = font;
        w = ctx.measureText(text).width;
        if (measureCache.size > 20000) measureCache.clear();
        measureCache.set(k, w);
      }
      return w;
    };
    const fxMap = fxFor(sh.id);
    renderGrid({
      ctx, W: cwPx / Z, H: chPx / Z, th, wb, sh, rows, cols, nRows, nCols,
      sl: scroller.scrollLeft / Z, st: scroller.scrollTop / Z, now,
      fx: fxMap, prevMap: s.proposal?.preview.bySheet.get(sh.id),
      anchor: s.anchor, active: s.active,
      clipRange: s.clip && s.clip.sheetId === sh.id ? s.clip.range : null,
      fillTarget: fillTarget.current, measure,
      searchHits: s.find && s.find.sheetId === sh.id ? new Set(s.find.keys) : undefined,
      currentHit: s.find ? s.find.keys[s.find.idx] ?? null : null,
    });
    const animating = fxTick(now) || !!s.clip;
    if (animating) rafRef.current = requestAnimationFrame(draw);
  }, []);

  const requestDraw = useCallback(() => {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(draw);
  }, [draw]);

  useEffect(() => {
    requestDraw();
  }, [ver, activeSheetId, anchor, active, editing, clip, proposal, size, dims, zoom, find, requestDraw]);
  useEffect(() => {
    const off = subscribeFx(requestDraw);
    return () => {
      off();
    };
  }, [requestDraw]);

  useEffect(() => {
    const h = () => {
      themeRef.current = null;
      requestDraw();
    };
    window.addEventListener('aisheet-theme', h);
    document.fonts?.ready.then(() => {
      measureCache.clear();
      requestDraw();
    });
    document.fonts?.addEventListener?.('loadingdone', h);
    return () => window.removeEventListener('aisheet-theme', h);
  }, [requestDraw]);

  useLayoutEffect(() => {
    const el = scrollerRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Ctrl + wheel zooms (needs a non-passive listener to cancel the browser's page zoom)
  useEffect(() => {
    const el = scrollerRef.current!;
    const h = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const z = Math.max(0.5, Math.min(2, +(useStore.getState().zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)).toFixed(2)));
      useStore.getState().set({ zoom: z });
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);

  // ---------- geometry (all in unzoomed "sheet" pixels) ----------
  const geom = () => {
    const sc = scrollerRef.current as HTMLDivElement;
    const Z = zoomRef.current;
    const { rows, cols, nRows, nCols } = dimsRef.current;
    const FR = Math.min(sheet.freezeRows, nRows);
    const FC = Math.min(sheet.freezeCols, nCols);
    return { sc, Z, rows, cols, nRows, nCols, FR, FC, sl: (sc?.scrollLeft ?? 0) / Z, st: (sc?.scrollTop ?? 0) / Z, vw: (sc?.clientWidth ?? 800) / Z, vh: (sc?.clientHeight ?? 500) / Z };
  };

  const colAtX = (x: number) => {
    const g = geom();
    const cx = x - HEADER_W;
    return indexAt(g.cols, cx < g.cols.off[g.FC] ? cx : cx + g.sl);
  };
  const rowAtY = (y: number) => {
    const g = geom();
    const cy = y - HEADER_H;
    return indexAt(g.rows, cy < g.rows.off[g.FR] ? cy : cy + g.st);
  };
  const cellRect = (r: number, c: number) => {
    const g = geom();
    const x = HEADER_W + g.cols.off[c] - (c < g.FC ? 0 : g.sl);
    const y = HEADER_H + g.rows.off[r] - (r < g.FR ? 0 : g.st);
    return { x, y, w: g.cols.off[c + 1] - g.cols.off[c], h: g.rows.off[r + 1] - g.rows.off[r] };
  };
  /** rect of a cell, expanded to its merged block */
  const logicalRect = (r: number, c: number) => {
    const m = wb.mergeAt(sheet, r, c);
    if (!m) return cellRect(r, c);
    const a = cellRect(m.r1, m.c1);
    const b = cellRect(m.r2, m.c2);
    return { x: a.x, y: a.y, w: b.x + b.w - a.x, h: b.y + b.h - a.y };
  };

  // scroll the active cell into view
  useEffect(() => {
    const g = geom();
    const { sc, Z } = g;
    if (!sc) return;
    const x = g.cols.off[active.c];
    const x2 = g.cols.off[active.c + 1];
    const y = g.rows.off[active.r];
    const y2 = g.rows.off[active.r + 1];
    const fw = g.cols.off[g.FC];
    const fh = g.rows.off[g.FR];
    const vw = g.vw - HEADER_W;
    const vh = g.vh - HEADER_H;
    if (active.c >= g.FC) {
      if (x - fw < g.sl) sc.scrollLeft = (x - fw) * Z;
      else if (x2 > g.sl + vw) sc.scrollLeft = (x2 - vw) * Z;
    }
    if (active.r >= g.FR) {
      if (y - fh < g.st) sc.scrollTop = (y - fh) * Z;
      else if (y2 > g.st + vh) sc.scrollTop = (y2 - vh) * Z;
    }
    requestDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.r, active.c, sheet.id]);

  const [sp, setSp] = useState({ x: 0, y: 0, w: 1200, h: 800 });
  useEffect(() => {
    const sc = scrollerRef.current;
    if (!sc) return;
    const ro = new ResizeObserver(() => setSp({ x: sc.scrollLeft, y: sc.scrollTop, w: sc.clientWidth, h: sc.clientHeight }));
    ro.observe(sc);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const sc = scrollerRef.current!;
    const g = dimsRef.current;
    const Z = zoomRef.current;
    if (sc.scrollTop + sc.clientHeight > (g.rows.off[g.nRows] + HEADER_H) * Z - 200) setGrow((p) => ({ ...p, r: g.nRows + 100 }));
    if (sc.scrollLeft + sc.clientWidth > (g.cols.off[g.nCols] + HEADER_W) * Z - 200) setGrow((p) => ({ ...p, c: g.nCols + 10 }));
    setFilterMenu(null);
    setDvMenu(null);
    setSp({ x: sc.scrollLeft, y: sc.scrollTop, w: sc.clientWidth, h: sc.clientHeight });
    requestDraw();
  };

  // ---------- pointer interaction ----------
  const localXY = (e: { clientX: number; clientY: number }) => {
    const rect = scrollerRef.current!.getBoundingClientRect();
    const Z = zoomRef.current;
    return { x: (e.clientX - rect.left) / Z, y: (e.clientY - rect.top) / Z };
  };

  const hit = (x: number, y: number) => {
    if (x < HEADER_W && y < HEADER_H) return { type: 'corner' as const };
    if (y < HEADER_H) {
      const c = colAtX(x);
      const rect = cellRect(0, c);
      if (Math.abs(x - (rect.x + rect.w)) < 4) return { type: 'colEdge' as const, c };
      if (c > 0 && Math.abs(x - rect.x) < 4) return { type: 'colEdge' as const, c: c - 1 };
      return { type: 'colHeader' as const, c };
    }
    if (x < HEADER_W) {
      const r = rowAtY(y);
      const rect = cellRect(r, 0);
      if (Math.abs(y - (rect.y + rect.h)) < 3) return { type: 'rowEdge' as const, r };
      return { type: 'rowHeader' as const, r };
    }
    const R = selectionRange();
    const br = logicalRect(Math.min(R.r2, dimsRef.current.nRows - 1), Math.min(R.c2, dimsRef.current.nCols - 1));
    if (Math.abs(x - (br.x + br.w)) < 6 && Math.abs(y - (br.y + br.h)) < 6) return { type: 'handle' as const };
    const r = rowAtY(y);
    const c = colAtX(x);
    const f = sheet.filter;
    if (f && r === f.range.r1 && c >= f.range.c1 && c <= f.range.c2) {
      const b = filterBtnRect(...(Object.values(cellRect(r, c)) as [number, number, number, number]));
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return { type: 'filterBtn' as const, r, c };
    }
    const st = useStore.getState();
    if (st.active.r === r && st.active.c === c) {
      const dv = sheet.validations.find((v) => v.kind === 'list' && r >= v.range.r1 && r <= v.range.r2 && c >= v.range.c1 && c <= v.range.c2);
      if (dv) {
        const b = dvBtnRect(...(Object.values(cellRect(r, c)) as [number, number, number, number]));
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return { type: 'dvBtn' as const, r, c };
      }
    }
    return { type: 'cell' as const, r, c };
  };

  const selectCell = (r: number, c: number, extend: boolean) => {
    const s = useStore.getState();
    const m = wb.mergeAt(sheet, r, c);
    if (m && !extend) s.select({ r: m.r1, c: m.c1 }, { r: m.r2, c: m.c2 });
    else if (extend) s.select(s.anchor, { r, c });
    else s.select({ r, c });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) {
      const { x, y } = localXY(e);
      const h = hit(x, y);
      if (h.type === 'cell') {
        const R = selectionRange();
        if (!(h.r >= R.r1 && h.r <= R.r2 && h.c >= R.c1 && h.c <= R.c2)) selectCell(h.r, h.c, false);
      }
      return;
    }
    if (e.button !== 0) return;
    const sc = scrollerRef.current!;
    const box = sc.getBoundingClientRect();
    if (e.clientX > box.left + sc.clientWidth || e.clientY > box.top + sc.clientHeight) return; // scrollbar
    setFilterMenu(null);
    setDvMenu(null);
    useStore.getState().set({ selectedChart: null });
    const { x, y } = localXY(e);
    const h = hit(x, y);
    const s = useStore.getState();
    if (s.editing && h.type === 'cell') {
      const txt = s.editing.text;
      if (txt.startsWith('=') && /[=+\-*/^&(,<>;:]$/.test(txt)) {
        s.set({ editing: { ...s.editing, text: txt + addr(h.r, h.c) } });
        e.preventDefault();
        return;
      }
    }
    if (s.editing) A.commitEdit('none');
    A.resetTabOrigin();
    if (h.type === 'filterBtn') {
      e.preventDefault();
      const rc = cellRect(h.r, h.c);
      setFilterMenu({ col: h.c, x: (rc.x + rc.w) * zoomRef.current, y: (rc.y + rc.h) * zoomRef.current });
      return;
    }
    if (h.type === 'dvBtn') {
      e.preventDefault();
      const dv = sheet.validations.find((v) => v.kind === 'list' && h.r >= v.range.r1 && h.r <= v.range.r2 && h.c >= v.range.c1 && h.c <= v.range.c2)!;
      const rc = cellRect(h.r, h.c);
      setDvMenu({ r: h.r, c: h.c, items: wb.listItems(sheet, dv), x: rc.x * zoomRef.current, y: (rc.y + rc.h) * zoomRef.current });
      return;
    }
    sc.setPointerCapture(e.pointerId);
    e.preventDefault();
    if (h.type === 'cell') {
      selectCell(h.r, h.c, e.shiftKey);
      dragRef.current = { kind: 'select' };
    } else if (h.type === 'colHeader') {
      const nr = 1048575;
      if (e.shiftKey) s.select({ r: 0, c: s.anchor.c }, { r: nr, c: h.c });
      else s.select({ r: 0, c: h.c }, { r: nr, c: h.c });
      dragRef.current = { kind: 'cols', from: e.shiftKey ? s.anchor.c : h.c };
    } else if (h.type === 'rowHeader') {
      const nc = 16383;
      if (e.shiftKey) s.select({ r: s.anchor.r, c: 0 }, { r: h.r, c: nc });
      else s.select({ r: h.r, c: 0 }, { r: h.r, c: nc });
      dragRef.current = { kind: 'rows', from: e.shiftKey ? s.anchor.r : h.r };
    } else if (h.type === 'corner') {
      s.select({ r: 0, c: 0 }, { r: 1048575, c: 16383 });
    } else if (h.type === 'colEdge') {
      const g = geom();
      dragRef.current = { kind: 'colResize', col: h.c, startX: x, startW: g.cols.off[h.c + 1] - g.cols.off[h.c] };
    } else if (h.type === 'rowEdge') {
      const g = geom();
      dragRef.current = { kind: 'rowResize', row: h.r, startY: y, startH: g.rows.off[h.r + 1] - g.rows.off[h.r] };
    } else if (h.type === 'handle') {
      dragRef.current = { kind: 'fill', src: selectionRange() };
    }
    A.ensureActiveSheet();
    focusGrid();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const { x, y } = localXY(e);
    const d = dragRef.current;
    const s = useStore.getState();
    if (!d) {
      const h = hit(x, y);
      const cur = h.type === 'colEdge' ? 'col-resize' : h.type === 'rowEdge' ? 'row-resize' : h.type === 'handle' ? 'crosshair' : h.type === 'filterBtn' || h.type === 'dvBtn' ? 'pointer' : h.type === 'cell' ? 'cell' : 'default';
      if (cur !== hoverRef.current) {
        hoverRef.current = cur;
        scrollerRef.current!.style.cursor = cur;
      }
      // comment tooltip
      if (h.type === 'cell' && sheet.comments.size) {
        const m = wb.mergeAt(sheet, h.r, h.c);
        const key = keyOf(m?.r1 ?? h.r, m?.c1 ?? h.c);
        const text = sheet.comments.get(key);
        if (text) {
          if (tip?.key !== key) {
            const rc = logicalRect(h.r, h.c);
            setTip({ text, key, x: (rc.x + rc.w + 4) * zoomRef.current, y: rc.y * zoomRef.current });
          }
        } else if (tip) setTip(null);
      } else if (tip) setTip(null);
      return;
    }
    if (d.kind === 'select') {
      const g = geom();
      const cx = Math.max(HEADER_W + 1, Math.min(x, g.vw - 1));
      const cy = Math.max(HEADER_H + 1, Math.min(y, g.vh - 1));
      const r = rowAtY(cy);
      const c = colAtX(cx);
      if (r !== s.active.r || c !== s.active.c) s.select(s.anchor, { r, c });
      const sc = g.sc;
      if (x > g.vw - 20) sc.scrollLeft += 20;
      else if (x < HEADER_W + 20) sc.scrollLeft -= 20;
      if (y > g.vh - 20) sc.scrollTop += 20;
      else if (y < HEADER_H + 20) sc.scrollTop -= 20;
    } else if (d.kind === 'cols') {
      s.select({ r: 0, c: d.from }, { r: 1048575, c: colAtX(Math.max(HEADER_W + 1, x)) });
    } else if (d.kind === 'rows') {
      s.select({ r: d.from, c: 0 }, { r: rowAtY(Math.max(HEADER_H + 1, y)), c: 16383 });
    } else if (d.kind === 'colResize') {
      sheet.colW.set(d.col, Math.max(24, d.startW + (x - d.startX)));
      setGrow((p) => ({ ...p }));
      requestDraw();
    } else if (d.kind === 'rowResize') {
      sheet.rowH.set(d.row, Math.max(14, d.startH + (y - d.startY)));
      setGrow((p) => ({ ...p }));
      requestDraw();
    } else if (d.kind === 'fill') {
      const r = rowAtY(Math.max(HEADER_H + 1, y));
      const c = colAtX(Math.max(HEADER_W + 1, x));
      const S = d.src;
      let T: Range = S;
      const dv = r > S.r2 ? r - S.r2 : r < S.r1 ? r - S.r1 : 0;
      const dh = c > S.c2 ? c - S.c2 : c < S.c1 ? c - S.c1 : 0;
      if (Math.abs(dv) >= Math.abs(dh) && dv !== 0) T = dv > 0 ? { ...S, r2: S.r2 + dv } : { ...S, r1: S.r1 + dv };
      else if (dh !== 0) T = dh > 0 ? { ...S, c2: S.c2 + dh } : { ...S, c1: S.c1 + dh };
      fillTarget.current = T;
      requestDraw();
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    try {
      scrollerRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (!d) return;
    if (d.kind === 'colResize') {
      const w = sheet.colW.get(d.col) ?? d.startW;
      sheet.colW.set(d.col, d.startW);
      if (w !== d.startW) {
        wb.setColWidth(sheet, d.col, w);
        A.markManualWidth(sheet.id, d.col);
      } else if (d.startW === DEF_COL_W) sheet.colW.delete(d.col);
    } else if (d.kind === 'rowResize') {
      const h = sheet.rowH.get(d.row) ?? d.startH;
      sheet.rowH.set(d.row, d.startH);
      if (h !== d.startH) wb.setRowHeight(sheet, d.row, h);
      else if (d.startH === DEF_ROW_H) sheet.rowH.delete(d.row);
    } else if (d.kind === 'fill') {
      const T = fillTarget.current;
      fillTarget.current = null;
      if (T) {
        wb.fillRange(wb.sheetById(sheet.id)!, d.src, T);
        useStore.getState().select({ r: T.r1, c: T.c1 }, { r: T.r2, c: T.c2 });
      }
      requestDraw();
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const { x, y } = localXY(e);
    const h = hit(x, y);
    if (h.type === 'cell') A.startEdit('cell');
    else if (h.type === 'colEdge') {
      A.autoFitCols([h.c]);
      A.markManualWidth(sheet.id, h.c);
    } else if (h.type === 'rowEdge') A.autoFitRowsNow();
  };

  // ---------- keyboard ----------
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const s = useStore.getState();
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key;
    if (composing.current || e.nativeEvent.isComposing) return;
    if (s.editing) {
      if (key === 'Enter' && !e.altKey) {
        e.preventDefault();
        A.commitEdit(e.shiftKey ? 'up' : 'down');
      } else if (key === 'Enter' && e.altKey) {
        e.preventDefault();
        const ta = e.currentTarget;
        const { selectionStart: a, selectionEnd: b } = ta;
        s.set({ editing: { ...s.editing, text: s.editing.text.slice(0, a) + '\n' + s.editing.text.slice(b) } });
        requestAnimationFrame(() => ta.setSelectionRange(a + 1, a + 1));
      } else if (key === 'Tab') {
        e.preventDefault();
        A.commitEdit(e.shiftKey ? 'left' : 'right');
      } else if (key === 'Escape') {
        e.preventDefault();
        A.cancelEdit();
      } else if (key === 'F4') {
        e.preventDefault();
        const ta = e.currentTarget;
        const text = s.editing.text;
        const pos = ta.selectionStart;
        const m = [...text.matchAll(/\$?[A-Za-z]{1,3}\$?\d+/g)].find((x) => x.index! <= pos && pos <= x.index! + x[0].length);
        if (m) {
          const body = m[0].replace(/\$/g, '');
          const mm = /^([A-Za-z]+)(\d+)$/.exec(body)!;
          const hasC = m[0].startsWith('$');
          const hasR = /\$\d+$/.test(m[0]);
          const next = !hasC && !hasR ? `$${mm[1]}$${mm[2]}` : hasC && hasR ? `${mm[1]}$${mm[2]}` : !hasC && hasR ? `$${mm[1]}${mm[2]}` : `${mm[1]}${mm[2]}`;
          s.set({ editing: { ...s.editing, text: text.slice(0, m.index!) + next + text.slice(m.index! + m[0].length) } });
        }
      }
      return;
    }
    const extend = e.shiftKey;
    const jump = (dr: number, dc: number) => {
      if (ctrl) {
        const ub = wb.usedBounds(sheet);
        const a = s.active;
        const filled = (r: number, c: number) => sheet.cells.has(keyOf(r, c)) && sheet.cells.get(keyOf(r, c))!.raw !== '';
        let r = a.r;
        let c = a.c;
        const maxR = Math.max(ub.r, 0);
        const maxC = Math.max(ub.c, 0);
        const step = () => {
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nc < 0 || nr > 1048575 || nc > 16383) return false;
          r = nr;
          c = nc;
          return true;
        };
        const startFilled = filled(r, c);
        const nextFilled = filled(r + dr, c + dc);
        if (startFilled && nextFilled) {
          while (step() && filled(r + dr, c + dc)) {
            /* walk to end of block */
          }
        } else {
          while (step() && !filled(r, c) && r <= maxR + 1 && c <= maxC + 1) {
            /* walk to next filled */
          }
          if (!filled(r, c)) {
            r = dr > 0 ? Math.max(maxR, a.r) : dr < 0 ? 0 : a.r;
            c = dc > 0 ? Math.max(maxC, a.c) : dc < 0 ? 0 : a.c;
          }
        }
        s.select(extend ? s.anchor : { r, c }, { r, c });
      } else A.moveSelection(dr, dc, extend);
    };
    switch (key) {
      case 'ArrowUp': e.preventDefault(); return jump(-1, 0);
      case 'ArrowDown': e.preventDefault(); return jump(1, 0);
      case 'ArrowLeft': e.preventDefault(); return jump(0, -1);
      case 'ArrowRight': e.preventDefault(); return jump(0, 1);
      case 'PageDown': e.preventDefault(); return A.moveSelection(20, 0, extend);
      case 'PageUp': e.preventDefault(); return A.moveSelection(-20, 0, extend);
      case 'Home':
        e.preventDefault();
        return s.select(ctrl ? { r: 0, c: 0 } : extend ? s.anchor : { r: s.active.r, c: 0 }, ctrl ? { r: 0, c: 0 } : { r: s.active.r, c: 0 });
      case 'End':
        if (ctrl) {
          e.preventDefault();
          const ub = wb.usedBounds(sheet);
          return s.select({ r: Math.max(0, ub.r), c: Math.max(0, ub.c) });
        }
        return;
      case 'Tab': e.preventDefault(); return A.pressTab(e.shiftKey);
      case 'Enter': e.preventDefault(); return A.pressEnter(e.shiftKey);
      case 'F2': e.preventDefault(); return A.startEdit('cell');
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        if (s.selectedChart) { wb.removeChart(sheet, s.selectedChart); s.set({ selectedChart: null }); return; }
        return A.clearSelection();
      case 'Escape': if (s.clip) s.set({ clip: null }); if (s.find) s.set({ find: null }); return;
      case ' ':
        if (ctrl) { e.preventDefault(); return s.select({ r: 0, c: s.active.c }, { r: 1048575, c: s.active.c }); }
        if (e.shiftKey) { e.preventDefault(); return s.select({ r: s.active.r, c: 0 }, { r: s.active.r, c: 16383 }); }
        return;
      case '=':
        if (e.altKey) { e.preventDefault(); return A.autoSum(); }
        return;
      case '+':
        if (ctrl) { e.preventDefault(); return A.insertRowAbove(); }
        return;
      case '-':
        if (ctrl) { e.preventDefault(); return A.deleteSelectedRows(); }
        return;
      case ';':
        if (ctrl) { e.preventDefault(); return A.insertToday(e.shiftKey); }
        return;
      case ':':
        if (ctrl) { e.preventDefault(); return A.insertToday(true); }
        return;
    }
    if (ctrl) {
      const k = key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); return A.undo(); }
      if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); return A.redo(); }
      if (k === 'b') { e.preventDefault(); return A.toggleStyle('b'); }
      if (k === 'i') { e.preventDefault(); return A.toggleStyle('i'); }
      if (k === 'u') { e.preventDefault(); return A.toggleStyle('u'); }
      if (k === 'd') { e.preventDefault(); return A.fillDown(); }
      if (k === 'r') { e.preventDefault(); return A.fillRight(); }
      if (k === 'a') { e.preventDefault(); return A.selectCurrentRegionOrAll(); }
      if (k === 'l' && e.shiftKey) { e.preventDefault(); return A.toggleFilter(); }
      if (k === '0') { e.preventDefault(); return s.set({ zoom: 1 }); }
      return;
    }
    // F-keys / typing-less shortcuts handled elsewhere
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const s = useStore.getState();
    if (s.editing) s.set({ editing: { ...s.editing, text: e.target.value } });
    else if (e.target.value) A.startEdit('cell', e.target.value);
  };

  useEffect(() => {
    focusFn = () => taRef.current?.focus({ preventScroll: true });
    focusFn();
    return () => {
      focusFn = null;
    };
  }, []);
  useEffect(() => {
    if (editing?.from === 'cell') {
      const ta = taRef.current;
      if (ta && document.activeElement !== ta) ta.focus({ preventScroll: true });
    }
  }, [editing]);

  // editor placement (sheet px → screen px via zoom)
  let edStyle: React.CSSProperties = { left: 0, top: 0, width: 1, height: 1, opacity: 0 };
  if (editing && editing.sheetId === sheet.id && editing.from === 'cell') {
    const rc = logicalRect(editing.r, editing.c);
    const lines = editing.text.split('\n');
    const longest = lines.reduce((a, b) => (b.length > a.length ? b : a), '');
    const tw = Math.min(520, Math.max(rc.w, longest.length * 8 + 28));
    edStyle = { left: rc.x * zoom, top: rc.y * zoom, width: tw * zoom, height: Math.max(rc.h, lines.length * 18 + 8) * zoom, opacity: 1, font: `${FONT_SIZE * zoom}px ${FONT_FAMILY}` };
  } else {
    const rc = cellRect(active.r, active.c);
    edStyle = { left: Math.max(0, rc.x * zoom), top: Math.max(0, rc.y * zoom), width: 1, height: 1, opacity: 0 };
  }

  const menuItems = (): MenuItem[] => {
    const R = selectionRange();
    const rows = R.r2 - R.r1 + 1;
    const cols = R.c2 - R.c1 + 1;
    const wholeRow = R.c1 === 0 && R.c2 === 16383;
    const wholeCol = R.r1 === 0 && R.r2 === 1048575;
    const multi = R.r1 !== R.r2 || R.c1 !== R.c2;
    const key = keyOf(R.r1, R.c1);
    const hasComment = sheet.comments.has(key);
    const err = typeof wb.value(sheet, R.r1, R.c1) === 'object' && wb.value(sheet, R.r1, R.c1) !== null;
    return [
      { label: t('menu.cut'), hint: 'Ctrl+X', run: () => A.copySelection(true) },
      { label: t('menu.copy'), hint: 'Ctrl+C', run: () => A.copySelection(false) },
      { label: t('menu.paste'), hint: 'Ctrl+V', run: async () => { try { A.pasteText(await navigator.clipboard.readText()); } catch { useStore.getState().showToast(t('menu.pasteHint')); } } },
      { label: t('menu.pasteValues'), run: async () => { try { A.pasteText(await navigator.clipboard.readText(), true); } catch { useStore.getState().showToast(t('menu.pasteHint')); } } },
      { sep: true },
      { label: wholeCol ? t('menu.insertCols', { n: cols }) : t('menu.insertRows', { n: rows }), run: wholeCol ? A.insertColLeft : A.insertRowAbove },
      { label: t('menu.insertCols', { n: cols }), run: A.insertColLeft, hidden: wholeCol },
      { label: wholeCol ? t('menu.deleteCols', { n: cols }) : t('menu.deleteRows', { n: rows }), run: wholeCol ? A.deleteSelectedCols : A.deleteSelectedRows },
      { label: t('menu.deleteCols', { n: cols }), run: A.deleteSelectedCols, hidden: wholeCol },
      { sep: true },
      { label: t('menu.clear'), hint: 'Del', run: A.clearSelection },
      { label: multi ? t('menu.merge') : t('menu.unmerge'), run: A.mergeSelection, hidden: !multi && !wb.mergeAt(sheet, R.r1, R.c1) },
      { label: wholeCol ? t('menu.hideCols') : t('menu.hideRows'), run: () => A.hideSelected(wholeCol ? 'col' : 'row', true) },
      { label: t('menu.unhide'), run: () => { A.hideSelected('row', false); A.hideSelected('col', false); } },
      { label: t('menu.autofit'), run: A.autoFitSelection, hidden: wholeRow && !wholeCol },
      { sep: true },
      { label: hasComment ? t('menu.editComment') : t('menu.addComment'), run: () => A.openDialog({ kind: 'comment', r: R.r1, c: R.c1 }) },
      { label: t('menu.chart'), run: () => A.createChartFromSelection() },
      { sep: true },
      { label: t('menu.formulaAi'), run: () => A.openDialog({ kind: 'formula', mode: 'create' }), accent: true },
      { label: err ? t('menu.fixAi') : t('menu.explainAi'), run: () => A.openDialog({ kind: 'formula', mode: err ? 'fix' : 'explain' }), accent: true },
      { label: t('menu.askAi'), run: () => useStore.getState().set({ panel: 'ai' }), accent: true },
    ];
  };

  const spacerW = (HEADER_W + dims.cols.off[dims.nCols]) * zoom;
  const spacerH = (HEADER_H + dims.rows.off[dims.nRows]) * zoom;

  return (
    <div className="grid-wrap" ref={wrapRef}>
      <div
        className="grid-scroller"
        ref={scrollerRef}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          const box = scrollerRef.current!.getBoundingClientRect();
          setMenu({ x: e.clientX - box.left + 8, y: e.clientY - box.top + 8 });
        }}
      >
        <div className="grid-sticky">
          <canvas ref={canvasRef} className="grid-canvas" />
          <textarea
            ref={taRef}
            className={'grid-editor' + (editing?.from === 'cell' ? ' on' : '')}
            style={edStyle}
            value={editing ? editing.text : ''}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onCompositionStart={() => (composing.current = true)}
            onCompositionEnd={() => (composing.current = false)}
            onCopy={(e) => { if (!editing) A.copySelection(false, e.nativeEvent); }}
            onCut={(e) => { if (!editing) A.copySelection(true, e.nativeEvent); }}
            onPaste={(e) => {
              if (editing) return;
              e.preventDefault();
              A.pasteText(e.clipboardData.getData('text/plain'));
            }}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label="cell input"
          />
          {sheet.charts.length > 0 && (
            <div style={{ position: 'absolute', left: HEADER_W * zoom, top: HEADER_H * zoom, width: Math.max(0, sp.w - HEADER_W * zoom), height: Math.max(0, sp.h - HEADER_H * zoom), overflow: 'hidden', pointerEvents: 'none', zIndex: 2 }}>
              <div style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${-sp.x}px, ${-sp.y}px) scale(${zoom})`, transformOrigin: '0 0', pointerEvents: 'auto' }}>
                {sheet.charts.map((ch) => (
                  <ChartView key={ch.id} def={ch} sheet={sheet} zoom={zoom} />
                ))}
              </div>
            </div>
          )}
        </div>
        <div style={{ width: spacerW, height: spacerH, position: 'relative' }} />
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => { setMenu(null); focusGrid(); }} />}
      {filterMenu && sheet.filter && <FilterMenu sheet={sheet} col={filterMenu.col} x={filterMenu.x} y={filterMenu.y} onClose={() => { setFilterMenu(null); focusGrid(); }} />}
      {dvMenu && (
        <DvMenu
          items={dvMenu.items}
          x={dvMenu.x}
          y={dvMenu.y}
          onPick={(v) => { wb.setInput(sheet, dvMenu.r, dvMenu.c, v, `Edit ${addr(dvMenu.r, dvMenu.c)}`); setDvMenu(null); focusGrid(); }}
          onClose={() => { setDvMenu(null); focusGrid(); }}
        />
      )}
      {tip && !menu && <CommentTip text={tip.text} x={tip.x} y={tip.y} />}
    </div>
  );
}
