import { useEffect, useRef } from 'react';
import { AlertCircle, Check, CircleDashed, Eye, Loader2, Network, Search, Settings2, Sparkles, SquarePen, Undo2, X, Wand2, Table2, ArrowUpDown, MessageCircleQuestion, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Button, Card, Checkbox, Chip, Tooltip, ScrollShadow } from '@heroui/react';
import { useStore, wb, providerModel, type ChatMsg } from '../store';
import { approveProposal, clearChat, rejectProposal, revertMessage, toggleProposalAction, sendPrompt, patchMsg, cancelPrompt } from '../ai/agent';
import { runPlan, cancelPlan } from '../ai/orchestrator';
import { summarize } from '../ai/executor';
import { PROVIDERS } from '../ai/providers';
import { Markdown } from './Markdown';
import { Composer } from './Composer';
import { useT } from '../i18n';

function Avatar() {
  return (
    <div className="from-accent to-ai text-accent-foreground mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br">
      <Sparkles size={14} />
    </div>
  );
}

function Message({ m, last }: { m: ChatMsg; last: boolean }) {
  const t = useT();
  const proposal = useStore((s) => s.proposal);
  const undoable = m.result?.txId !== undefined && wb.undoStack.some((x) => x.id === m.result!.txId);

  if (m.role === 'user')
    return (
      <div className="rise flex justify-end">
        <div className="bg-surface-secondary max-w-[88%] rounded-2xl rounded-br-md px-3.5 py-2 text-[14px] leading-6 whitespace-pre-wrap select-text">{m.text}</div>
      </div>
    );

  if (m.role === 'sys')
    return (
      <div className={'rise flex items-start justify-center gap-1.5 px-2 text-center text-xs ' + (m.error ? 'text-danger' : 'text-muted')}>
        {m.error && <AlertCircle size={14} className="mt-0.5 shrink-0" />}
        <span className="whitespace-pre-wrap select-text">{m.text}</span>
      </div>
    );

  return (
    <div className="rise flex gap-3">
      <Avatar />
      <div className="min-w-0 flex-1">
        {!!m.steps?.length && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {m.steps.map((x, i) => (
              <Chip key={i} size="sm" variant="soft" className="text-[11px]"><Search size={11} />{x}</Chip>
            ))}
          </div>
        )}
        {m.streaming && !m.text ? <span className="shimmer-text text-sm">{t('ai.thinking')}</span> : <Markdown text={m.text} streaming={m.streaming} />}
        {m.agent && <AgentsCard msgId={m.id} />}
        {m.proposalId !== undefined && proposal?.id === m.proposalId && last && <ProposalCard />}
        {m.result && m.result.applied > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <Chip color="success" variant="soft" size="sm"><Check size={12} />{t('chat.applied', { n: m.result.applied })}</Chip>
            {undoable && (
              <Button size="sm" variant="tertiary" className="h-7 rounded-full px-3 text-xs" onPress={() => revertMessage(m.id)}>
                <Undo2 size={12} />{t('chat.revert')}
              </Button>
            )}
          </div>
        )}
        {m.result && m.result.applied === 0 && m.result.denied > 0 && (
          <div className="text-muted mt-2 flex items-center gap-1.5 text-xs"><X size={13} />{t('chat.notApplied')}</div>
        )}
      </div>
    </div>
  );
}

function AgentsCard({ msgId }: { msgId: number }) {
  const t = useT();
  const msg = useStore((s) => s.msgs.find((m) => m.id === msgId));
  const a = msg?.agent;
  if (!a) return null;
  const done = a.tasks.filter((x) => x.status === 'done').length;
  const pct = Math.round((a.tasks.filter((x) => x.status === 'done' || x.status === 'error' || x.status === 'skipped').length / a.tasks.length) * 100);
  const running = a.status === 'running' || a.status === 'merging';
  return (
    <Card variant="secondary" className="border-accent/30 mt-3 gap-3 border p-3.5">
      <div className="text-accent flex items-center gap-2 text-sm font-semibold">
        <Network size={15} /> {a.status === 'pending' ? t('agents.plan') : t('agents.title')}
        <Chip size="sm" variant="soft" className="ml-auto">{a.status === 'pending' ? t('agents.count', { n: a.tasks.length }) : `${done}/${a.tasks.length}`}</Chip>
      </div>
      {a.goal && <p className="text-muted text-xs leading-5">{a.goal}</p>}
      {a.status !== 'pending' && <div className="bg-default h-1.5 overflow-hidden rounded-full"><div className="bg-accent h-full rounded-full transition-all duration-500" style={{ width: `${pct}%` }} /></div>}
      <ul className="flex flex-col gap-2">
        {a.tasks.map((x) => (
          <li key={x.id} className="bg-surface flex gap-2.5 rounded-lg border p-2.5">
            <span className="mt-0.5 shrink-0">
              {x.status === 'running' ? <Loader2 size={15} className="text-accent animate-spin" /> : x.status === 'done' ? <Check size={15} className="text-success" /> : x.status === 'error' ? <X size={15} className="text-danger" /> : x.status === 'skipped' ? <X size={15} className="text-muted" /> : <CircleDashed size={15} className="text-muted" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[13px] font-medium">
                {x.title}
                {x.depends.length > 0 && <span className="text-muted text-[10px] font-normal">↳ {x.depends.join(', ')}</span>}
                {x.status === 'done' && <span className="text-muted ml-auto text-[10px] font-normal">{t('agents.actions', { n: x.actions })}</span>}
              </div>
              <div className="text-muted mt-0.5 line-clamp-2 text-xs leading-5">
                {x.status === 'running' && x.text ? x.text.slice(-160) : x.status === 'error' || x.error ? x.error : x.status === 'done' ? x.text.split('\n')[0] : x.instruction}
              </div>
              {x.steps.length > 0 && x.status === 'running' && <div className="text-muted mt-1 text-[10px]">{x.steps[x.steps.length - 1]}</div>}
            </div>
          </li>
        ))}
      </ul>
      {a.status === 'pending' && (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onPress={() => patchMsg(msgId, { agent: undefined })}>{t('agents.dismiss')}</Button>
          <Button size="sm" variant="primary" onPress={() => void runPlan(msgId)}><Network size={14} />{t('agents.run', { n: a.tasks.length })}</Button>
        </div>
      )}
      {running && (
        <div className="flex justify-end">
          <Button size="sm" variant="tertiary" onPress={() => { cancelPlan(); cancelPrompt(); }}>{a.status === 'merging' ? t('agents.merging') : t('agents.cancel')}</Button>
        </div>
      )}
    </Card>
  );
}

function ProposalCard() {
  const t = useT();
  const p = useStore((s) => s.proposal)!;
  return (
    <Card variant="secondary" className="border-ai/40 mt-3 gap-3 border p-3.5">
      <div className="text-ai flex items-center gap-2 text-sm font-semibold">
        <Eye size={15} /> {t('prop.title')}
        <Chip size="sm" variant="soft" className="ml-auto">{t('prop.cells', { n: p.preview.totalCells })}</Chip>
      </div>
      <ul className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
        {p.ok.map((o) => {
          const sm = summarize(o.action);
          return (
            <li key={o.index}>
              <Checkbox className="flex flex-row items-start gap-2.5" isSelected={p.selected.has(o.index)} onChange={() => toggleProposalAction(o.index)}>
                <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
                <Checkbox.Content><span className="text-[13px] leading-5">{t(sm.key, sm.vars)}</span></Checkbox.Content>
              </Checkbox>
            </li>
          );
        })}
      </ul>
      {p.preview.newErrors.length > 0 && (
        <div className="bg-danger/10 text-danger rounded-lg px-3 py-2 text-xs leading-5">
          <b>{t('prop.errors', { n: p.preview.newErrors.length })}</b> {p.preview.newErrors.slice(0, 3).map((e) => `${e.sheet}!${e.ref}`).join(', ')}
        </div>
      )}
      <p className="text-muted text-xs">{p.preview.structural ? t('prop.structural') + ' ' : ''}{t('prop.previewHint')}</p>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onPress={rejectProposal}><X size={14} />{t('prop.reject')}</Button>
        <Button size="sm" variant="primary" isDisabled={p.selected.size === 0} onPress={approveProposal}><Check size={14} />{t('prop.apply')}</Button>
      </div>
    </Card>
  );
}

function Empty() {
  const t = useT();
  const items = [
    { icon: <Table2 size={16} />, text: t('sug.1') },
    { icon: <Wand2 size={16} />, text: t('sug.2') },
    { icon: <ArrowUpDown size={16} />, text: t('sug.3') },
    { icon: <MessageCircleQuestion size={16} />, text: t('sug.4') },
  ];
  return (
    <div className="rise flex flex-1 flex-col items-center justify-center gap-6 px-2 py-8 text-center">
      <div className="from-accent to-ai text-accent-foreground flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br shadow-lg"><Sparkles size={22} /></div>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{t('ai.emptyTitle')}</h2>
        <p className="text-muted mx-auto mt-1.5 max-w-xs text-sm">{t('ai.emptyBody')}</p>
      </div>
      <div className="grid w-full grid-cols-1 gap-2">
        {items.map((it) => (
          <button
            key={it.text}
            type="button"
            onClick={() => useStore.getState().set({ draft: it.text })}
            className="bg-surface hover:bg-surface-secondary hover:border-accent/40 flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left text-[13px] leading-5 transition-colors"
          >
            <span className="text-accent shrink-0">{it.icon}</span>
            {it.text}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ChatPanel() {
  const t = useT();
  const msgs = useStore((s) => s.msgs);
  const busy = useStore((s) => s.busy);
  const proposal = useStore((s) => s.proposal);
  const providerId = useStore((s) => s.providerId);
  const set = useStore((s) => s.set);
  const width = useStore((s) => s.panelWidth);
  const end = useRef<HTMLDivElement>(null);
  const provider = PROVIDERS.find((p) => p.id === providerId)!;

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: busy ? 'auto' : 'smooth' });
  }, [msgs, proposal, busy]);

  return (
    <aside className="bg-surface relative flex h-full min-h-0 shrink-0 flex-col border-l" style={{ width }}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('ai.resize')}
        onPointerDown={(e) => {
          e.preventDefault();
          const sx = e.clientX;
          const w0 = width;
          const move = (ev: PointerEvent) => set({ panelWidth: Math.round(Math.min(Math.max(320, w0 + (sx - ev.clientX)), Math.min(760, window.innerWidth - 420))) });
          const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.style.cursor = ''; };
          document.body.style.cursor = 'col-resize';
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        }}
        onDoubleClick={() => set({ panelWidth: 400 })}
        className="hover:bg-accent/40 absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize transition-colors"
      />
      <header className="flex h-10 shrink-0 items-center gap-1.5 border-b px-3">
        <Sparkles size={16} className="text-ai" />
        <span className="font-semibold tracking-tight">{t('ai.title')}</span>
        <button type="button" onClick={() => set({ settingsOpen: true, settingsTab: 'ai' })} className="text-muted hover:text-foreground hover:bg-surface-secondary ml-1 flex max-w-[190px] items-center gap-1.5 truncate rounded-full border px-2.5 py-0.5 text-xs transition-colors" title={t('ai.providerHint')}>
          <span className="bg-ai size-1.5 shrink-0 rounded-full" />
          <span className="truncate">{provider.label.split(' ')[0]} · {providerModel(providerId) || '—'}</span>
        </button>
        <div className="flex-1" />
        <Tooltip delay={300}>
          <Button isIconOnly size="sm" variant="ghost" aria-label={t('ai.newChat')} isDisabled={!msgs.length} onPress={clearChat}><SquarePen size={16} /></Button>
          <Tooltip.Content>{t('ai.newChat')}</Tooltip.Content>
        </Tooltip>
        <Tooltip delay={300}>
          <Button isIconOnly size="sm" variant="ghost" aria-label={t('ai.minimize')} onPress={() => set({ panelMin: true })}><PanelRightClose size={16} /></Button>
          <Tooltip.Content>{t('ai.minimize')}</Tooltip.Content>
        </Tooltip>
        <Tooltip delay={300}>
          <Button isIconOnly size="sm" variant="ghost" aria-label={t('settings.title')} onPress={() => set({ settingsOpen: true, settingsTab: 'ai' })}><Settings2 size={16} /></Button>
          <Tooltip.Content>{t('settings.title')}</Tooltip.Content>
        </Tooltip>
      </header>

      <ScrollShadow className="min-h-0 flex-1" hideScrollBar={false}>
        <div className="flex min-h-full flex-col gap-4 px-3 py-3">
          {msgs.length === 0 ? <Empty /> : msgs.map((m, i) => <Message key={m.id} m={m} last={i === msgs.length - 1 || m.proposalId !== undefined} />)}
          <div ref={end} />
        </div>
      </ScrollShadow>

      <Composer />
    </aside>
  );
}

void sendPrompt;

/** Collapsed assistant: a slim rail with an expand button (and a dot while the AI is working). */
export function ChatRail() {
  const t = useT();
  const set = useStore((s) => s.set);
  const busy = useStore((s) => s.busy);
  const pending = useStore((s) => s.proposal?.status === 'pending');
  return (
    <aside className="bg-surface flex h-full w-11 shrink-0 flex-col items-center gap-2 border-l py-2">
      <Tooltip delay={300}>
        <Button isIconOnly size="sm" variant="ghost" aria-label={t('ai.expand')} onPress={() => set({ panelMin: false })}><PanelRightOpen size={17} /></Button>
        <Tooltip.Content>{t('ai.expand')}</Tooltip.Content>
      </Tooltip>
      <div className="relative">
        <Sparkles size={16} className="text-ai" />
        {(busy || pending) && <span className={'bg-accent absolute -top-1 -right-1 size-2 rounded-full ' + (busy ? 'animate-pulse' : '')} />}
      </div>
      <button type="button" onClick={() => set({ panelMin: false })} className="text-muted hover:text-foreground mt-2 text-xs font-medium tracking-wide [writing-mode:vertical-rl]">{t('ai.title')}</button>
    </aside>
  );
}
