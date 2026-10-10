import { useEffect, useRef } from 'react';
import { ArrowUp, Check, Lock, Settings2, Sparkles, Square, Undo2, X, Eye, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useStore, wb, providerModel, type ChatMsg } from '../store';
import { approveProposal, cancelPrompt, rejectProposal, revertMessage, sendPrompt, toggleProposalAction } from '../ai/agent';
import { summarize } from '../ai/executor';
import { PROVIDERS } from '../ai/providers';
import { useT } from '../i18n';
import { focusGrid } from '../grid/GridCanvas';
import { MicButton, VoiceStrip } from './MicButton';

export function AiPanel() {
  const t = useT();
  const msgs = useStore((s) => s.msgs);
  const busy = useStore((s) => s.busy);
  const proposal = useStore((s) => s.proposal);
  const providerId = useStore((s) => s.providerId);
  const perms = useStore((s) => s.permissions);
  const set = useStore((s) => s.set);
  const text = useStore((s) => s.draft);
  const setText = (v: string) => set({ draft: v });
  const composing = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [msgs, busy, proposal]);

  useEffect(() => {
    const ta = taRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(140, ta.scrollHeight) + 'px';
    }
  }, [text]);

  const send = () => {
    const v = text.trim();
    if (!v || busy) return;
    setText('');
    void sendPrompt(v);
  };

  const provider = PROVIDERS.find((p) => p.id === providerId)!;
  const modeIcon = perms.mode === 'readonly' ? <Lock size={13} /> : perms.mode === 'ask' ? <ShieldCheck size={13} /> : <ShieldAlert size={13} />;
  const suggestions = [t('sug.1'), t('sug.2'), t('sug.3'), t('sug.4')];

  return (
    <aside className="ai-panel">
      <header className="panel-head">
        <div className="panel-title"><Sparkles size={15} /> {t('ai.title')}</div>
        <button className="chip" onClick={() => set({ settingsOpen: true })} title={t('ai.providerHint')}>
          <span className="dot" />
          {provider.label.split(' ')[0]} · {providerModel(providerId) || '—'}
        </button>
      </header>

      <div className="msgs">
        {msgs.length === 0 && (
          <div className="empty">
            <div className="empty-art"><Sparkles size={22} /></div>
            <h3>{t('ai.emptyTitle')}</h3>
            <p>{t('ai.emptyBody')}</p>
            <div className="sugs">
              {suggestions.map((s) => (
                <button key={s} className="sug" onClick={() => { setText(s); taRef.current?.focus(); }}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m) => (
          <Message key={m.id} m={m} />
        ))}
        {proposal && <ProposalCard />}
        {busy && (
          <div className="msg ai thinking">
            <span className="shimmer">{t('ai.thinking')}</span>
            <button className="mini" onClick={cancelPrompt}><Square size={11} /> {t('ai.stop')}</button>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <footer className="composer">
        <VoiceStrip />
        <div className="composer-box">
          <textarea
            ref={taRef}
            value={text}
            rows={1}
            placeholder={t('ai.placeholder')}
            onChange={(e) => {
              setText(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(140, e.target.scrollHeight) + 'px';
            }}
            onCompositionStart={() => (composing.current = true)}
            onCompositionEnd={() => (composing.current = false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !composing.current && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
                (e.target as HTMLTextAreaElement).style.height = 'auto';
              }
              if (e.key === 'Escape') focusGrid();
            }}
          />
          <MicButton onText={(v) => set({ draft: (useStore.getState().draft ? useStore.getState().draft + ' ' : '') + v })} />
          <button className="send" onClick={send} disabled={!text.trim() || busy} title={t('ai.send')} aria-label={t('ai.send')}>
            <ArrowUp size={16} />
          </button>
        </div>
        <div className="composer-meta">
          <label className={'mode mode-' + perms.mode} title={t('perm.title')}>
            {modeIcon}
            <select value={perms.mode} onChange={(e) => set({ permissions: { ...perms, mode: e.target.value as typeof perms.mode } })}>
              <option value="ask">{t('perm.ask')}</option>
              <option value="auto">{t('perm.auto')}</option>
              <option value="readonly">{t('perm.readonly')}</option>
            </select>
          </label>
          {perms.selectionOnly && <span className="tag">{t('perm.selOnlyTag')}</span>}
          <button className="icon-link" onClick={() => set({ settingsOpen: true })} title={t('settings.title')}><Settings2 size={14} /></button>
        </div>
      </footer>
    </aside>
  );
}

function Message({ m }: { m: ChatMsg }) {
  const t = useT();
  const undoable = m.result?.txId !== undefined && wb.undoStack.some((x) => x.id === m.result!.txId);
  return (
    <div className={'msg ' + m.role + (m.error ? ' error' : '')}>
      {m.text && <div className="msg-text">{m.text}</div>}
      {m.result && m.result.applied > 0 && (
        <div className="applied">
          <span className="ok"><Check size={13} /> {t('chat.applied', { n: m.result.applied })}</span>
          {undoable && (
            <button className="mini" onClick={() => revertMessage(m.id)}>
              <Undo2 size={12} /> {t('chat.revert')}
            </button>
          )}
        </div>
      )}
      {m.result && m.result.applied === 0 && m.result.denied > 0 && <div className="applied muted"><X size={13} /> {t('chat.notApplied')}</div>}
    </div>
  );
}

function ProposalCard() {
  const t = useT();
  const p = useStore((s) => s.proposal)!;
  const sheetName = (id: string) => wb.sheetById(id)?.name ?? '';
  void sheetName;
  return (
    <div className="proposal">
      <div className="proposal-head">
        <Eye size={14} /> {t('prop.title')}
        <span className="count">{t('prop.cells', { n: p.preview.totalCells })}</span>
      </div>
      <ul>
        {p.ok.map((o) => {
          const sm = summarize(o.action);
          return (
            <li key={o.index}>
              <label>
                <input type="checkbox" checked={p.selected.has(o.index)} onChange={() => toggleProposalAction(o.index)} />
                <span>{t(sm.key, sm.vars)}</span>
              </label>
            </li>
          );
        })}
      </ul>
      {p.preview.structural && <div className="note">{t('prop.structural')}</div>}
      <div className="note">{t('prop.previewHint')}</div>
      <div className="proposal-actions">
        <button className="btn ghost" onClick={rejectProposal}><X size={14} /> {t('prop.reject')}</button>
        <button className="btn primary" onClick={approveProposal} disabled={p.selected.size === 0}><Check size={14} /> {t('prop.apply')}</button>
      </div>
    </div>
  );
}
