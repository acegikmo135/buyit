import { useEffect, useRef } from 'react';
import { AlertCircle, Check, Eye, Settings2, Sparkles, SquarePen, Undo2, X, Wand2, Table2, ArrowUpDown, MessageCircleQuestion } from 'lucide-react';
import { Button, Card, Checkbox, Chip, Tooltip, ScrollShadow } from '@heroui/react';
import { useStore, wb, providerModel, type ChatMsg } from '../store';
import { approveProposal, clearChat, rejectProposal, revertMessage, toggleProposalAction, sendPrompt } from '../ai/agent';
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
        {m.streaming && !m.text ? <span className="shimmer-text text-sm">{t('ai.thinking')}</span> : <Markdown text={m.text} streaming={m.streaming} />}
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
  const end = useRef<HTMLDivElement>(null);
  const provider = PROVIDERS.find((p) => p.id === providerId)!;

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: busy ? 'auto' : 'smooth' });
  }, [msgs, proposal, busy]);

  return (
    <aside className="bg-surface flex h-full min-h-0 w-[440px] shrink-0 flex-col border-l">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
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
          <Button isIconOnly size="sm" variant="ghost" aria-label={t('settings.title')} onPress={() => set({ settingsOpen: true, settingsTab: 'ai' })}><Settings2 size={16} /></Button>
          <Tooltip.Content>{t('settings.title')}</Tooltip.Content>
        </Tooltip>
      </header>

      <ScrollShadow className="min-h-0 flex-1" hideScrollBar={false}>
        <div className="flex min-h-full flex-col gap-5 px-4 py-5">
          {msgs.length === 0 ? <Empty /> : msgs.map((m, i) => <Message key={m.id} m={m} last={i === msgs.length - 1 || m.proposalId !== undefined} />)}
          <div ref={end} />
        </div>
      </ScrollShadow>

      <Composer />
    </aside>
  );
}

void sendPrompt;
