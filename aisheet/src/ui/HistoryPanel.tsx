import { History, Sparkles, User, RotateCcw } from 'lucide-react';
import { useWbVersion, wb } from '../store';
import * as A from '../actions';
import { useT } from '../i18n';

export function HistoryPanel() {
  const t = useT();
  useWbVersion();
  const undo = wb.undoStack;
  const redo = [...wb.redoStack].reverse();
  const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return (
    <aside className="ai-panel">
      <header className="panel-head">
        <div className="panel-title"><History size={15} /> {t('hist.title')}</div>
      </header>
      <div className="msgs hist">
        {undo.length === 0 && redo.length === 0 && <div className="empty"><p>{t('hist.empty')}</p></div>}
        {redo.map((tx) => (
          <div key={tx.id} className="hist-item undone">
            {tx.source === 'ai' ? <Sparkles size={13} /> : <User size={13} />}
            <span className="hist-label">{tx.label}</span>
            <span className="hist-time">{t('hist.undone')}</span>
          </div>
        ))}
        {[...undo].reverse().map((tx, i) => {
          const keep = undo.length - i - 1;
          const isTop = i === 0;
          return (
            <div key={tx.id} className={'hist-item' + (tx.source === 'ai' ? ' ai' : '') + (isTop ? ' top' : '')}>
              {tx.source === 'ai' ? <Sparkles size={13} /> : <User size={13} />}
              <span className="hist-label" title={tx.label}>{tx.label}</span>
              <span className="hist-time">{time(tx.ts)}</span>
              <button className="mini" title={t('hist.revertHere')} onClick={() => { wb.revertTo(keep + 1 === undo.length ? keep : keep + 1); A.ensureActiveSheet(); }} hidden={isTop}>
                <RotateCcw size={11} /> {t('hist.restore')}
              </button>
              {isTop && <button className="mini" onClick={() => A.undo()}><RotateCcw size={11} /> {t('hist.undo')}</button>}
            </div>
          );
        })}
        <div className="hist-base">{t('hist.original')}</div>
      </div>
    </aside>
  );
}
