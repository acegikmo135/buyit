import { activeSheet, execContext, useStore, wb, providerModel, type ChatMsg, type Proposal } from '../store';
import { streamChat, AiError, type ChatMessage } from './providers';
import { buildContext, parseReply, visibleText, SYSTEM_PROMPT } from './protocol';
import { categoryOf, dryRun, execute, screen, type Denied } from './executor';
import { getSecret } from '../platform';
import { tr } from '../i18n';
import type { Action } from './protocol';

const st = () => useStore.getState();
let msgSeq = 1;
let propSeq = 1;
let controller: AbortController | null = null;

export function pushMsg(m: Omit<ChatMsg, 'id'>): ChatMsg {
  const msg = { ...m, id: msgSeq++ };
  st().set({ msgs: [...st().msgs, msg] });
  return msg;
}

function patchMsg(id: number, patch: Partial<ChatMsg>) {
  st().set({ msgs: st().msgs.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
}

export async function loadKey(providerId: string): Promise<string> {
  const cached = st().keys[providerId as never];
  if (cached !== undefined) return cached;
  const k = await getSecret('key:' + providerId);
  st().set({ keys: { ...st().keys, [providerId]: k } });
  return k;
}

function historyFor(prompt: string, context: string): ChatMessage[] {
  const prior = st()
    .msgs.filter((m) => !m.error && !m.streaming && m.text)
    .slice(-12)
    .map<ChatMessage>((m) => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.role === 'sys' ? `[app] ${m.text}` : m.text }));
  // merge consecutive same-role messages (some providers require alternation)
  const merged: ChatMessage[] = [];
  for (const m of prior) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += '\n' + m.content;
    else merged.push({ ...m });
  }
  const final: ChatMessage = { role: 'user', content: `${context}\n\n## Request\n${prompt}` };
  const last = merged[merged.length - 1];
  if (last && last.role === 'user') {
    // the just-pushed user message is already the last entry; replace it with the contextual version
    merged[merged.length - 1] = final;
  } else merged.push(final);
  if (merged[0]?.role === 'assistant') merged.shift();
  return merged;
}

export function cancelPrompt() {
  controller?.abort();
}

export async function sendPrompt(prompt: string) {
  const s = st();
  if (s.busy || !prompt.trim()) return;
  const providerId = s.providerId;
  pushMsg({ role: 'user', text: prompt });
  const apiKey = await loadKey(providerId);
  st().set({ busy: true });
  const ctx = execContext();
  controller = new AbortController();
  const placeholder = pushMsg({ role: 'ai', text: '', streaming: true });
  let raw = '';
  try {
    const context = buildContext(wb, ctx.activeSheetId, ctx.selection);
    // history excludes the placeholder we just pushed
    const history = historyFor(prompt, context);
    raw = await streamChat(
      { id: providerId, model: providerModel(providerId), baseUrl: s.baseUrls[providerId], apiKey, strictPrivacy: s.strictPrivacy },
      SYSTEM_PROMPT(s.aiLang),
      history,
      (d) => {
        raw += d;
        patchMsg(placeholder.id, { text: visibleText(raw) });
      },
      controller.signal,
    );
    const reply = parseReply(raw);
    patchMsg(placeholder.id, { text: reply.message, streaming: false });
    if (reply.actions.length) handleActions(placeholder.id, reply.actions, prompt);
  } catch (e) {
    const partial = visibleText(raw);
    if (partial && (e as Error).name === 'AbortError') patchMsg(placeholder.id, { text: partial, streaming: false });
    else st().set({ msgs: st().msgs.filter((m) => m.id !== placeholder.id) });
    if ((e as Error).name === 'AbortError') pushMsg({ role: 'sys', text: tr('chat.cancelled') });
    else pushMsg({ role: 'sys', text: friendlyError(e), error: true });
  } finally {
    st().set({ busy: false });
    controller = null;
  }
}

export function clearChat() {
  cancelPrompt();
  st().set({ msgs: [], proposal: null });
}

function friendlyError(e: unknown): string {
  if (e instanceof AiError) {
    if (e.message === 'API key missing') return tr('err.nokey');
    if (e.message === 'PRIVACY_NO_ENDPOINT') return tr('err.privacy');
    if (e.status === 401 || e.status === 403) return tr('err.auth') + ' ' + e.message;
    if (e.status === 429) return tr('err.rate') + ' ' + e.message;
    return e.message;
  }
  return (e as Error).message || String(e);
}

function denialText(d: Denied): string {
  const reasons = { readonly: 'perm.denied.readonly', category: 'perm.denied.category', scope: 'perm.denied.scope', invalid: 'perm.denied.invalid' } as const;
  return `${tr(reasons[d.reason])} (${d.action.type})`;
}

function handleActions(msgId: number, actions: Action[], prompt: string) {
  const s = st();
  const ctx = execContext();
  const { ok, denied } = screen(actions, s.permissions, ctx, wb);
  if (denied.length) pushMsg({ role: 'sys', text: tr('perm.denied.summary', { n: denied.length }) + ' ' + [...new Set(denied.map(denialText))].join('; ') });
  if (!ok.length) return;
  const needsConfirm =
    s.permissions.mode === 'ask' || (s.permissions.confirmDestructive && ok.some((o) => categoryOf(o.action) === 'delete'));
  if (!needsConfirm) {
    runActions(msgId, ok.map((o) => o.action), prompt, denied.length);
    return;
  }
  const preview = dryRun(wb, ok.map((o) => o.action), ctx);
  const proposal: Proposal = {
    id: propSeq++,
    actions,
    ok,
    denied,
    preview,
    ctx,
    selected: new Set(ok.map((o) => o.index)),
    prompt,
    status: 'pending',
  };
  patchMsg(msgId, { proposalId: proposal.id });
  st().set({ proposal });
}

function runActions(msgId: number, actions: Action[], prompt: string, deniedCount: number) {
  const ctx = execContext();
  const label = 'AI: ' + (prompt.length > 48 ? prompt.slice(0, 47) + '…' : prompt);
  const before = wb.undoStack.length;
  const res = execute(wb, actions, ctx, label);
  const tx = wb.undoStack.length > before ? wb.undoStack[wb.undoStack.length - 1] : undefined;
  patchMsg(msgId, { result: { applied: res.applied, denied: deniedCount, errors: res.errors, txId: tx?.id } });
  if (res.errors.length) pushMsg({ role: 'sys', text: res.errors.join('\n'), error: true });
  return res;
}

export function approveProposal() {
  const p = st().proposal;
  if (!p || p.status !== 'pending') return;
  const chosen = p.ok.filter((o) => p.selected.has(o.index)).map((o) => o.action);
  const msg = st().msgs.find((m) => m.proposalId === p.id);
  if (chosen.length && msg) runActions(msg.id, chosen, p.prompt, p.denied.length);
  st().set({ proposal: null });
}

export function rejectProposal() {
  const p = st().proposal;
  if (!p) return;
  const msg = st().msgs.find((m) => m.proposalId === p.id);
  if (msg) patchMsg(msg.id, { result: { applied: 0, denied: p.ok.length, errors: [] } });
  pushMsg({ role: 'sys', text: tr('perm.rejected') });
  st().set({ proposal: null });
}

export function toggleProposalAction(index: number) {
  const p = st().proposal;
  if (!p) return;
  const sel = new Set(p.selected);
  if (sel.has(index)) sel.delete(index);
  else sel.add(index);
  // recompute preview for the chosen subset
  const chosen = p.ok.filter((o) => sel.has(o.index)).map((o) => o.action);
  const preview = dryRun(wb, chosen, p.ctx);
  st().set({ proposal: { ...p, selected: sel, preview } });
}

/** Reverts the transaction created by an AI message (and everything after it). */
export function revertMessage(msgId: number) {
  const m = st().msgs.find((x) => x.id === msgId);
  const txId = m?.result?.txId;
  if (txId === undefined) return;
  const idx = wb.undoStack.findIndex((t) => t.id === txId);
  if (idx < 0) return;
  wb.revertTo(idx);
  patchMsg(msgId, { result: { ...m!.result!, txId: undefined, applied: 0 } });
  pushMsg({ role: 'sys', text: tr('chat.reverted') });
}

void activeSheet;
