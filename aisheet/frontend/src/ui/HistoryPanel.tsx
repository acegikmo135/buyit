import { History, Sparkles, User, RotateCcw } from 'lucide-react';
import { Button, ScrollShadow } from '@heroui/react';
import { useWbVersion, wb } from '../store';
import * as A from '../actions';
import { useT } from '../i18n';

export function HistoryPanel() {
  const t = useT();
  useWbVersion();
  const undo = wb.undoStack;
  const redo = [...wb.redoStack].reverse();
  const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <aside className="bg-surface flex h-full min-h-0 w-[440px] shrink-0 flex-col border-l">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <History size={16} className="text-accent" />
        <span className="font-semibold tracking-tight">{t('hist.title')}</span>
      </header>
      <ScrollShadow className="min-h-0 flex-1">
        <div className="flex flex-col gap-1 p-3">
          {undo.length === 0 && redo.length === 0 && <p className="text-muted px-3 py-10 text-center text-sm">{t('hist.empty')}</p>}
          {redo.map((tx) => (
            <div key={tx.id} className="text-muted flex items-center gap-3 rounded-xl px-3 py-2 line-through opacity-60">
              {tx.source === 'ai' ? <Sparkles size={14} /> : <User size={14} />}
              <span className="flex-1 truncate text-sm">{tx.label}</span>
              <span className="text-xs">{t('hist.undone')}</span>
            </div>
          ))}
          {[...undo].reverse().map((tx, i) => {
            const keep = undo.length - i - 1;
            const top = i === 0;
            return (
              <div key={tx.id} className={'group flex items-center gap-3 rounded-xl px-3 py-2 ' + (top ? 'bg-surface-secondary' : 'hover:bg-surface-secondary')}>
                <span className={tx.source === 'ai' ? 'text-ai' : 'text-muted'}>{tx.source === 'ai' ? <Sparkles size={14} /> : <User size={14} />}</span>
                <span className="flex-1 truncate text-sm" title={tx.label}>{tx.label}</span>
                <span className="text-muted text-xs tabular-nums">{time(tx.ts)}</span>
                <Button size="sm" variant="tertiary" className={'h-7 rounded-full px-2.5 text-xs ' + (top ? '' : 'opacity-0 group-hover:opacity-100')} onPress={() => { if (top) A.undo(); else { wb.revertTo(keep + 1); A.ensureActiveSheet(); } }}>
                  <RotateCcw size={12} />{top ? t('hist.undo') : t('hist.restore')}
                </Button>
              </div>
            );
          })}
          <div className="text-muted py-3 text-center text-xs">{t('hist.original')}</div>
        </div>
      </ScrollShadow>
    </aside>
  );
}
