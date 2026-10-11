import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownAZ, ArrowUpZA, Check, FilterX } from 'lucide-react';
import { Button, Checkbox, Input, ListBox, ScrollShadow } from '@heroui/react';
import { wb, useStore } from '../store';
import type { Sheet } from '../core/types';
import { colToName } from '../core/address';
import { useT } from '../i18n';

function useOutside(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('mousedown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [onClose]);
  return ref;
}

/** Excel-style AutoFilter dropdown for one column. */
export function FilterMenu({ sheet, col, x, y, onClose }: { sheet: Sheet; col: number; x: number; y: number; onClose: () => void }) {
  const t = useT();
  const ref = useOutside(onClose);
  const all = useMemo(() => wb.distinctValues(sheet, col), [sheet, col]);
  const current = sheet.filter?.allowed[col];
  const [chosen, setChosen] = useState<Set<string>>(new Set(current ?? all));
  const [q, setQ] = useState('');
  const shown = all.filter((v) => v.toLowerCase().includes(q.toLowerCase()));
  const f = sheet.filter!;
  const sort = (asc: boolean) => {
    wb.sortRange(sheet, f.range, col, asc, true);
    onClose();
  };
  return (
    <div ref={ref} className="bg-overlay absolute z-30 flex w-64 flex-col gap-2 rounded-xl border p-3 shadow-xl" style={{ left: Math.max(4, x - 240), top: y }} role="dialog" aria-label={t('flt.title')}>
      <div className="text-muted text-xs font-medium">{t('flt.column', { c: colToName(col) })}</div>
      <div className="flex gap-1.5">
        <Button size="sm" variant="tertiary" className="flex-1" onPress={() => sort(true)}><ArrowDownAZ size={14} />{t('flt.sortAsc')}</Button>
        <Button size="sm" variant="tertiary" className="flex-1" onPress={() => sort(false)}><ArrowUpZA size={14} />{t('flt.sortDesc')}</Button>
      </div>
      <Input aria-label={t('flt.search')} placeholder={t('flt.search')} value={q} onChange={(e) => setQ(e.target.value)} className="h-8" autoFocus />
      <Checkbox className="flex flex-row items-center gap-2" isSelected={shown.length > 0 && shown.every((v) => chosen.has(v))} onChange={(on) => setChosen((p) => { const n = new Set(p); shown.forEach((v) => (on ? n.add(v) : n.delete(v))); return n; })}>
        <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
        <Checkbox.Content><span className="text-[13px] font-medium">{t('flt.selectAll')}</span></Checkbox.Content>
      </Checkbox>
      <ScrollShadow className="max-h-52 border-y py-1.5">
        <div className="flex flex-col gap-1.5">
          {shown.map((v) => (
            <Checkbox key={v} className="flex flex-row items-center gap-2" isSelected={chosen.has(v)} onChange={(on) => setChosen((p) => { const n = new Set(p); on ? n.add(v) : n.delete(v); return n; })}>
              <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
              <Checkbox.Content><span className="text-[13px]">{v === '' ? t('flt.blanks') : v}</span></Checkbox.Content>
            </Checkbox>
          ))}
          {!shown.length && <div className="text-muted py-2 text-center text-xs">{t('flt.none')}</div>}
        </div>
      </ScrollShadow>
      <div className="flex justify-between gap-2">
        <Button size="sm" variant="ghost" isDisabled={!current} onPress={() => { wb.setFilterColumn(sheet, col, null); onClose(); }}><FilterX size={14} />{t('flt.clear')}</Button>
        <Button size="sm" variant="primary" onPress={() => { wb.setFilterColumn(sheet, col, chosen.size === all.length ? null : [...chosen]); onClose(); }}><Check size={14} />{t('flt.apply')}</Button>
      </div>
    </div>
  );
}

/** Dropdown list for a data-validation cell. */
export function DvMenu({ items, x, y, onPick, onClose }: { items: string[]; x: number; y: number; onPick: (v: string) => void; onClose: () => void }) {
  const ref = useOutside(onClose);
  return (
    <div ref={ref} className="bg-overlay absolute z-30 max-h-64 min-w-40 overflow-y-auto rounded-xl border p-1 shadow-xl" style={{ left: x, top: y }}>
      <ListBox aria-label="Choose a value" onAction={(k) => onPick(String(k))}>
        {items.map((v) => <ListBox.Item key={v} id={v} textValue={v}>{v}</ListBox.Item>)}
      </ListBox>
    </div>
  );
}

export function CommentTip({ text, x, y }: { text: string; x: number; y: number }) {
  return (
    <div className="bg-overlay pointer-events-none absolute z-30 max-w-64 rounded-lg border px-3 py-2 text-xs whitespace-pre-wrap shadow-xl" style={{ left: x, top: y }}>
      {text}
    </div>
  );
}

void useStore;
