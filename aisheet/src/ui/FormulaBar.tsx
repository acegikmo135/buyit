import { useEffect, useState } from 'react';
import { useStore, wb, activeSheet, useWbVersion } from '../store';
import { addr, parseRange, rangeToString } from '../core/address';
import * as A from '../actions';
import { useT } from '../i18n';
import { focusGrid } from '../grid/GridCanvas';
import { FormulaError } from '../core/types';
import { keyOf } from '../core/address';

export function FormulaBar() {
  const t = useT();
  useWbVersion();
  const anchor = useStore((s) => s.anchor);
  const active = useStore((s) => s.active);
  const editing = useStore((s) => s.editing);
  const [name, setName] = useState('');
  const multi = anchor.r !== active.r || anchor.c !== active.c;
  const label = multi
    ? rangeToString({ r1: Math.min(anchor.r, active.r), c1: Math.min(anchor.c, active.c), r2: Math.min(Math.max(anchor.r, active.r), 1048575), c2: Math.max(anchor.c, active.c) })
    : addr(active.r, active.c);
  useEffect(() => setName(label), [label]);
  const sh = activeSheet();
  const cell = sh.cells.get(keyOf(active.r, active.c));
  const v = cell ? wb.value(sh, active.r, active.c) : null;
  const text = editing ? editing.text : A.rawText(active.r, active.c);
  return (
    <div className="formula-bar">
      <input
        className="name-box"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const R = parseRange(name);
            if (R) useStore.getState().select({ r: R.r1, c: R.c1 }, { r: R.r2, c: R.c2 });
            else setName(label);
            focusGrid();
          } else if (e.key === 'Escape') {
            setName(label);
            focusGrid();
          }
        }}
        onFocus={(e) => e.currentTarget.select()}
        aria-label={t('bar.namebox')}
      />
      <span className="fx-mark" aria-hidden>ƒx</span>
      <input
        className="formula-input"
        value={text}
        placeholder={t('bar.placeholder')}
        onFocus={() => {
          if (!useStore.getState().editing) A.startEdit('bar');
        }}
        onChange={(e) => {
          const s = useStore.getState();
          if (s.editing) s.set({ editing: { ...s.editing, text: e.target.value } });
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter') {
            A.commitEdit('down');
            focusGrid();
          } else if (e.key === 'Escape') {
            A.cancelEdit();
            focusGrid();
          }
        }}
        onBlur={() => {
          const s = useStore.getState();
          if (s.editing?.from === 'bar') A.commitEdit('none');
        }}
        aria-label={t('bar.formula')}
      />
      {v instanceof FormulaError && !editing && <span className="err-chip">{v.code}</span>}
    </div>
  );
}
