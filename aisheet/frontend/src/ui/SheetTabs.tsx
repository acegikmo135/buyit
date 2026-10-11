import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button, Chip, Input, Tabs } from '@heroui/react';
import { useStore, useWbVersion, wb } from '../store';
import * as A from '../actions';
import { useT } from '../i18n';
import { focusGrid } from '../grid/GridCanvas';
import { confirmDialog } from '../platform';
import { keyOf, normRange } from '../core/address';
import { formatNumber } from '../core/format';
import { Tip } from './Tip';

function useSelectionStats() {
  const ver = useWbVersion();
  const sheetId = useStore((s) => s.activeSheetId);
  const anchor = useStore((s) => s.anchor);
  const active = useStore((s) => s.active);
  return useMemo(() => {
    const sh = wb.sheetById(sheetId);
    const R = normRange({ r1: anchor.r, c1: anchor.c, r2: active.r, c2: active.c });
    if (!sh || (R.r1 === R.r2 && R.c1 === R.c2)) return null;
    let n = 0;
    let count = 0;
    let sum = 0;
    const ub = wb.usedBounds(sh);
    const r2 = Math.min(R.r2, ub.r);
    const c2 = Math.min(R.c2, ub.c);
    for (let r = R.r1; r <= r2; r++)
      for (let c = R.c1; c <= c2; c++) {
        if (!sh.cells.has(keyOf(r, c))) continue;
        const v = wb.value(sh, r, c);
        if (v === null || v === '') continue;
        count++;
        if (typeof v === 'number') {
          n++;
          sum += v;
        }
      }
    return count ? { count, n, sum, avg: n ? sum / n : 0 } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ver, sheetId, anchor, active]);
}

export function SheetTabs() {
  const t = useT();
  useWbVersion();
  const activeId = useStore((s) => s.activeSheetId);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const stats = useSelectionStats();

  const finishRename = (id: string) => {
    const s = wb.sheetById(id);
    if (s && draft.trim() && draft !== s.name && !wb.renameSheet(s, draft)) useStore.getState().showToast(t('tabs.nameTaken'));
    setRenaming(null);
    focusGrid();
  };

  return (
    <footer className="bg-surface flex h-10 shrink-0 items-center gap-2 border-t px-2">
      <Tabs selectedKey={activeId} onSelectionChange={(k) => { A.switchSheet(String(k)); focusGrid(); }} className="min-w-0">
        <Tabs.ListContainer>
          <Tabs.List aria-label="Sheets" className="h-8">
            {wb.sheets.map((s) => (
              <Tabs.Tab key={s.id} id={s.id} onDoubleClick={() => { setRenaming(s.id); setDraft(s.name); }} className="h-7 px-3 text-[13px]">
                {renaming === s.id ? (
                  <Input
                    autoFocus
                    aria-label="Sheet name"
                    className="h-6 w-28 text-[13px]"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.nativeEvent.isComposing) return;
                      if (e.key === 'Enter') finishRename(s.id);
                      if (e.key === 'Escape') { setRenaming(null); focusGrid(); }
                    }}
                    onBlur={() => finishRename(s.id)}
                  />
                ) : (
                  <span className="flex items-center gap-1.5">
                    {s.name}
                    {s.id === activeId && wb.sheets.length > 1 && (
                      <span
                        role="button"
                        aria-label={t('tabs.delete')}
                        className="text-muted hover:text-danger -mr-1 rounded p-0.5"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (await confirmDialog(t('tabs.deleteConfirm', { name: s.name }))) {
                            wb.deleteSheet(s);
                            A.ensureActiveSheet();
                          }
                        }}
                      >
                        <X size={12} />
                      </span>
                    )}
                  </span>
                )}
                <Tabs.Indicator />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>
      </Tabs>
      <Tip label={t('tabs.add')}>
        <Button isIconOnly size="sm" variant="ghost" aria-label={t('tabs.add')} onPress={() => { A.addSheet(); focusGrid(); }}><Plus size={16} /></Button>
      </Tip>
      <div className="flex-1" />
      {stats && (
        <div className="flex items-center gap-1.5 pr-1">
          {stats.n > 0 && <Chip size="sm" variant="soft">{t('stat.sum')}: <b className="ml-1 tabular-nums">{formatNumber(stats.sum, 'thousands').replace(/\.00$/, '')}</b></Chip>}
          {stats.n > 1 && <Chip size="sm" variant="soft">{t('stat.avg')}: <b className="ml-1 tabular-nums">{formatNumber(stats.avg, 'thousands')}</b></Chip>}
          <Chip size="sm" variant="soft">{t('stat.count')}: <b className="ml-1 tabular-nums">{stats.count}</b></Chip>
        </div>
      )}
    </footer>
  );
}
