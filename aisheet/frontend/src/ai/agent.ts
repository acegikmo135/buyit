import { activeSheet, execContext, useStore, wb, providerModel, type ChatMsg, type Proposal } from '../store';
import { AiError, type ChatMessage, type ProviderConfig } from './providers';
import { buildContext, SYSTEM_PROMPT, type Action } from './protocol';
import { categoryOf, dryRun, execute, screen, type Denied } from './executor';
import { runModel } from './engine';
import { getSecret } from '../platform';
import { tr } from '../i18n';

const st = () => useStore.getState();
let msgSeq = 1;
let propSeq = 1;
let controller: AbortController | null = null;
export const currentSignal = () => controller?.signal;
let extraAbort: (() => void) | null = null;
export const onCancel = (fn: (() => void) | null) => (extraAbort = fn);

export function pushMsg(m: Omit<ChatMsg, 'id'>): ChatMsg {
  const msg = { ...m, id: msgSeq++ };
  st().set({ msgs: [...st().msgs, msg] });
  return msg;
}

export function patchMsg(id: number, patch: Partial<ChatMsg>) {
  st().set({ msgs: st().msgs.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
}

export async function loadKey(providerId: string): Promise<string> {
  const cached = st().keys[providerId as never];
  if (cached !== undefined) return cached;
  const k = await getSecret('key:' + providerId);
  st().set({ keys: { ...st().keys, [providerId]: k } });
  return k;
}

export async function providerConfig(): Promise<ProviderConfig> {
  const s = st();
  return { id: s.providerId, model: providerModel(s.providerId), baseUrl: s.baseUrls[s.providerId], apiKey: await loadKey(s.providerId), strictPrivacy: s.strictPrivacy };
}

function historyFor(prompt: string, context: string): ChatMessage[] {
  const prior = st()
    .msgs.filter((m) => !m.error && !m.streaming && m.text)
    .slice(-12)
    .map<ChatMessage>((m) => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.role === 'sys' ? `[app] ${m.text}` : m.text }));
  const merged: ChatMessage[] = [];
  for (const m of prior) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += '\n' + m.content;
    else merged.push({ ...m });
  }
  const final: ChatMessage = { role: 'user', content: `${context}\n\n## Request\n${prompt}` };
  const last = merged[merged.length - 1];
  if (last && last.role === 'user') merged[merged.length - 1] = final;
  else merged.push(final);
  if (merged[0]?.role === 'assistant') merged.shift();
  return merged;
}

export function cancelPrompt() {
  controller?.abort();
  extraAbort?.();
}

export async function sendPrompt(prompt: string) {
  const s = st();
  if (s.busy || !prompt.trim()) return;
  pushMsg({ role: 'user', text: prompt });
  await respond(prompt);
}

/** Runs one assistant turn for `prompt` (the user message must already be in the chat). */
export async function respond(prompt: string) {
  const s = st();
  const cfg = await providerConfig();
  st().set({ busy: true });
  const ctx = execContext();
  controller = new AbortController();
  const placeholder = pushMsg({ role: 'ai', text: '', streaming: true, steps: [] });
  let visible = '';
  try {
    const context = buildContext(wb, ctx.activeSheetId, ctx.selection);
    const history = historyFor(prompt, context);
    const run = await runModel({
      system: SYSTEM_PROMPT(s.aiLang, { multi: s.multiAgent }),
      messages: history,
      wb,
      activeSheetId: ctx.activeSheetId,
      cfg,
      signal: controller.signal,
      onText: (v) => {
        visible = v;
        patchMsg(placeholder.id, { text: v });
      },
      onStep: (step) => patchMsg(placeholder.id, { steps: [...(st().msgs.find((m) => m.id === placeholder.id)?.steps ?? []), step] }),
    });
    patchMsg(placeholder.id, { text: run.reply.message, streaming: false });
    if (run.reply.plan && s.multiAgent) {
      patchMsg(placeholder.id, {
        agent: { goal: run.reply.plan.goal, prompt, status: 'pending', tasks: run.reply.plan.tasks.map((t) => ({ id: t.id, title: t.title, instruction: t.instruction, depends: t.depends ?? [], status: 'queued', text: '', steps: [], actions: 0 })) },
      });
    } else if (run.reply.actions.length) await handleActions(placeholder.id, run.reply.actions, prompt, run.raw, history, 0);
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      if (visible) patchMsg(placeholder.id, { text: visible, streaming: false });
      else st().set({ msgs: st().msgs.filter((m) => m.id !== placeholder.id) });
      pushMsg({ role: 'sys', text: tr('chat.cancelled') });
    } else {
      st().set({ msgs: st().msgs.filter((m) => m.id !== placeholder.id) });
      pushMsg({ role: 'sys', text: friendlyError(e), error: true });
    }
  } finally {
    st().set({ busy: false });
    controller = null;
  }
}

export function clearChat() {
  cancelPrompt();
  st().set({ msgs: [], proposal: null });
}

export function friendlyError(e: unknown): string {
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

/**
 * Screens a plan against permissions, dry-runs it, self-checks for new formula errors (asking the model to fix them once),
 * then either applies it (auto mode) or presents it for approval.
 */
export async function handleActions(msgId: number, actions: Action[], prompt: string, lastRaw: string, history: ChatMessage[], repairs: number) {
  const s = st();
  const ctx = execContext();
  const { ok, denied } = screen(actions, s.permissions, ctx, wb);
  if (denied.length) pushMsg({ role: 'sys', text: tr('perm.denied.summary', { n: denied.length }) + ' ' + [...new Set(denied.map(denialText))].join('; ') });
  if (!ok.length) return;
  const okActions = ok.map((o) => o.action);
  let preview = dryRun(wb, okActions, ctx);

  // ---- self-check: formulas that would end up as errors ----
  if (preview.newErrors.length && repairs < 1 && !controller?.signal.aborted) {
    const list = preview.newErrors.slice(0, 8).map((e) => `${e.sheet}!${e.ref} → ${e.code}   ${e.formula}`).join('\n');
    pushMsg({ role: 'sys', text: tr('chat.selfcheck', { n: preview.newErrors.length }) });
    try {
      const cfg = await providerConfig();
      const fixRun = await runModel({
        system: SYSTEM_PROMPT(s.aiLang, { multi: false }),
        messages: [...history, { role: 'assistant', content: lastRaw }, { role: 'user', content: `[app] I dry-ran your actions. These formulas would produce errors:\n${list}\n\nFix the plan: re-send the COMPLETE corrected actions block (all actions, not only the fixes) and one short sentence on what you corrected. Check sheet names, ranges and that referenced cells actually exist after earlier actions run.` }],
        wb,
        activeSheetId: ctx.activeSheetId,
        cfg,
        signal: controller?.signal,
        maxRounds: 2,
      });
      if (fixRun.reply.actions.length) {
        const note = fixRun.reply.message ? `\n\n_${fixRun.reply.message.replace(/\n+/g, ' ')}_` : '';
        const msg = st().msgs.find((m) => m.id === msgId);
        patchMsg(msgId, { text: (msg?.text ?? '') + note, steps: [...(msg?.steps ?? []), tr('chat.selfchecked')] });
        return handleActions(msgId, fixRun.reply.actions, prompt, fixRun.raw, history, repairs + 1);
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      /* fall through with the original plan */
    }
  }

  const needsConfirm = s.permissions.mode === 'ask' || (s.permissions.confirmDestructive && ok.some((o) => categoryOf(o.action) === 'delete'));
  if (!needsConfirm) {
    runActions(msgId, okActions, prompt, denied.length);
    return;
  }
  preview = preview.newErrors.length || repairs ? preview : preview;
  const proposal: Proposal = { id: propSeq++, actions, ok, denied, preview, ctx, selected: new Set(ok.map((o) => o.index)), prompt, status: 'pending' };
  patchMsg(msgId, { proposalId: proposal.id });
  st().set({ proposal });
}

export function runActions(msgId: number, actions: Action[], prompt: string, deniedCount: number) {
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
