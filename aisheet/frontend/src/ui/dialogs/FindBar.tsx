import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Replace, Search, X } from 'lucide-react';
import { Button, Checkbox, Input } from '@heroui/react';
import { useStore, wb, activeSheet } from '../../store';
import { findAll, replaceAll } from '../../core/tools';
import { useT } from '../../i18n';
import { focusGrid } from '../../grid/GridCanvas';

/** Floating Find / Replace bar (Ctrl+F / Ctrl+H). */
export function FindBar({ replace }: { replace: boolean }) {
  const t = useT();
  const set = useStore((s) => s.set);
  const find = useStore((s) => s.find);
  const [q, setQ] = useState(find?.query ?? '');
  const [rep, setRep] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [whole, setWhole] = useState(false);
  const [all, setAll] = useState(false);
  const [showRep, setShowRep] = useState(replace);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const run = (query: string, mc = matchCase, wc = whole, ws = all, keepIdx = false) => {
    const sh = activeSheet();
    const hits = findAll(wb, sh.id, query, { matchCase: mc, wholeCell: wc, scope: ws ? 'workbook' : 'sheet' });
    const keys = hits.filter((h) => h.sheetId === sh.id).map((h) => h.r * 65536 + h.c);
    set({ find: query ? { query, keys, idx: keepIdx ? Math.min(find?.idx ?? 0, Math.max(0, keys.length - 1)) : 0, sheetId: sh.id } : null });
    return { hits, keys };
  };

  const go = (dir: 1 | -1) => {
    const f = useStore.getState().find;
    if (!f || !f.keys.length) return;
    const idx = (f.idx + dir + f.keys.length) % f.keys.length;
    const k = f.keys[idx];
    set({ find: { ...f, idx }, anchor: { r: Math.floor(k / 65536), c: k % 65536 }, active: { r: Math.floor(k / 65536), c: k % 65536 } });
  };

  const total = find?.keys.length ?? 0;

  return (
    <div className="bg-overlay absolute top-2 right-5 z-20 flex w-[360px] flex-col gap-2 rounded-xl border p-3 shadow-xl" role="search">
      <div className="flex items-center gap-1.5">
        <Input
          ref={input}
          aria-label={t('find.find')}
          placeholder={t('find.find')}
          value={q}
          className="h-8 flex-1"
          onChange={(e) => { setQ(e.target.value); run(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? -1 : 1); }
            if (e.key === 'Escape') { set({ find: null, dialog: null }); focusGrid(); }
          }}
        />
        <span className="text-muted w-16 text-center text-xs tabular-nums">{q ? (total ? `${(find?.idx ?? 0) + 1} / ${total}` : t('find.none')) : ''}</span>
        <Button isIconOnly size="sm" variant="ghost" aria-label={t('find.prev')} onPress={() => go(-1)}><ChevronUp size={15} /></Button>
        <Button isIconOnly size="sm" variant="ghost" aria-label={t('find.next')} onPress={() => go(1)}><ChevronDown size={15} /></Button>
        <Button isIconOnly size="sm" variant="ghost" aria-label={t('find.replaceToggle')} onPress={() => setShowRep(!showRep)}><Replace size={15} /></Button>
        <Button isIconOnly size="sm" variant="ghost" aria-label="Close" onPress={() => { set({ find: null, dialog: null }); focusGrid(); }}><X size={15} /></Button>
      </div>
      {showRep && (
        <div className="flex items-center gap-1.5">
          <Input aria-label={t('find.replaceWith')} placeholder={t('find.replaceWith')} value={rep} className="h-8 flex-1" onChange={(e) => setRep(e.target.value)} />
          <Button size="sm" variant="tertiary" isDisabled={!total} onPress={() => {
            const f = useStore.getState().find;
            if (!f) return;
            const k = f.keys[f.idx];
            const sh = activeSheet();
            const one = findAll(wb, sh.id, q, { matchCase, wholeCell: whole }).find((h) => h.r * 65536 + h.c === k);
            if (one) {
              wb.run('Replace', 'user', () => {
                const cell = sh.cells.get(k)!;
                const base = String(cell.raw);
                const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const next = whole ? rep : base.replace(new RegExp(esc, matchCase ? '' : 'i'), () => rep);
                wb.setInput(sh, one.r, one.c, next);
              });
              run(q, matchCase, whole, all, true);
            }
          }}>{t('find.replace')}</Button>
          <Button size="sm" variant="primary" isDisabled={!total} onPress={() => {
            const n = replaceAll(wb, activeSheet().id, q, rep, { matchCase, wholeCell: whole, scope: all ? 'workbook' : 'sheet' });
            useStore.getState().showToast(t('find.replaced', { n }));
            run(q);
          }}>{t('find.replaceAll')}</Button>
        </div>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {([['find.matchCase', matchCase, setMatchCase], ['find.wholeCell', whole, setWhole], ['find.allSheets', all, setAll]] as const).map(([k, v, setter]) => (
          <Checkbox key={k} className="flex flex-row items-center gap-1.5" isSelected={v} onChange={(on) => { setter(on); run(q, k === 'find.matchCase' ? on : matchCase, k === 'find.wholeCell' ? on : whole, k === 'find.allSheets' ? on : all); }}>
            <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
            <Checkbox.Content><span className="text-xs">{t(k)}</span></Checkbox.Content>
          </Checkbox>
        ))}
      </div>
      <Search className="hidden" />
    </div>
  );
}
