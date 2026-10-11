// Sub-agents: a plan from the main assistant is split into tasks that run as parallel workers.
// Workers see a staging copy of the workbook (so dependent tasks see earlier results); nothing touches the real
// workbook until every worker is done and the user approves the merged plan.
import { execContext, useStore, wb, type AgentRun, type AgentTask } from '../store';
import { buildContext, SYSTEM_PROMPT, type Action } from './protocol';
import { execute } from './executor';
import { runModel } from './engine';
import { handleActions, patchMsg, providerConfig, pushMsg, friendlyError, onCancel } from './agent';
import { tr } from '../i18n';

const st = () => useStore.getState();
const MAX_PARALLEL = 3;

let abort: AbortController | null = null;

function patchAgent(msgId: number, fn: (a: AgentRun) => AgentRun) {
  const m = st().msgs.find((x) => x.id === msgId);
  if (!m?.agent) return;
  patchMsg(msgId, { agent: fn(m.agent) });
}
function patchTask(msgId: number, id: string, patch: Partial<AgentTask>) {
  patchAgent(msgId, (a) => ({ ...a, tasks: a.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
}

export function cancelPlan() {
  abort?.abort();
}

export async function runPlan(msgId: number) {
  const msg = st().msgs.find((m) => m.id === msgId);
  const run = msg?.agent;
  if (!run || run.status !== 'pending' || st().busy) return;
  const settings = st();
  const cfg = await providerConfig();
  abort = new AbortController();
  onCancel(() => abort?.abort());
  st().set({ busy: true });
  patchAgent(msgId, (a) => ({ ...a, status: 'running' }));

  const stage = wb.clone();
  const ctx = execContext();
  const done = new Set<string>();
  const failed = new Set<string>();
  const started = new Set<string>();
  const results = new Map<string, Action[]>();
  const order: string[] = [];
  const tasks = run.tasks;

  const runTask = async (t: AgentTask) => {
    started.add(t.id);
    patchTask(msgId, t.id, { status: 'running', startedAt: Date.now() });
    try {
      // dependants get the summary of what their dependencies produced
      const depNotes = t.depends.map((d) => tasks.find((x) => x.id === d)).filter(Boolean).map((d) => `- ${d!.title}: ${d!.text.split('\n')[0]?.slice(0, 200) ?? ''}`).join('\n');
      const context = buildContext(stage, ctx.activeSheetId, null);
      const out = await runModel({
        system: SYSTEM_PROMPT(settings.aiLang, { role: 'worker', task: t, goal: run.goal }),
        messages: [{ role: 'user', content: `${context}\n\n## Your task\n${t.instruction}${depNotes ? `\n\nAlready done by other workers (their changes are in the workbook above):\n${depNotes}` : ''}` }],
        wb: stage,
        activeSheetId: ctx.activeSheetId,
        cfg,
        signal: abort?.signal,
        maxRounds: 3,
        onText: (v) => patchTask(msgId, t.id, { text: v }),
        onStep: (s) => patchTask(msgId, t.id, { steps: [...(st().msgs.find((m) => m.id === msgId)?.agent?.tasks.find((x) => x.id === t.id)?.steps ?? []), s] }),
      });
      const actions = out.reply.actions;
      // apply to the staging workbook right away so later tasks see the result
      const exec = actions.length ? execute(stage, actions, ctx, `agent:${t.id}`) : { applied: 0, errors: [] as string[] };
      results.set(t.id, actions);
      done.add(t.id);
      order.push(t.id);
      patchTask(msgId, t.id, { status: 'done', text: out.reply.message || t.text, actions: actions.length, endedAt: Date.now(), error: exec.errors.length ? exec.errors.join('; ') : undefined });
    } catch (e) {
      failed.add(t.id);
      patchTask(msgId, t.id, { status: abort?.signal.aborted ? 'skipped' : 'error', error: friendlyError(e), endedAt: Date.now() });
    }
  };

  try {
    const running = new Set<Promise<void>>();
    for (;;) {
      if (abort.signal.aborted) break;
      const ready = tasks.filter((t) => !started.has(t.id) && t.depends.every((d) => done.has(d)) && !t.depends.some((d) => failed.has(d)));
      for (const t of ready) {
        if (running.size >= MAX_PARALLEL) break;
        const p = runTask(t).finally(() => running.delete(p));
        running.add(p);
      }
      // dependants of failed tasks are skipped
      for (const t of tasks) if (!started.has(t.id) && t.depends.some((d) => failed.has(d))) {
        started.add(t.id);
        failed.add(t.id);
        patchTask(msgId, t.id, { status: 'skipped', error: tr('agents.skippedDep') });
      }
      if (!running.size) {
        if (tasks.every((t) => started.has(t.id))) break;
        if (!ready.length) break; // deadlock guard (cyclic dependencies)
        continue;
      }
      await Promise.race(running);
    }
  } finally {
    onCancel(null);
  }

  if (abort.signal.aborted) {
    patchAgent(msgId, (a) => ({ ...a, status: 'cancelled' }));
    pushMsg({ role: 'sys', text: tr('chat.cancelled') });
    st().set({ busy: false });
    return;
  }

  // merge: all successful tasks' actions, in completion order, as ONE plan
  const merged: Action[] = order.flatMap((id) => results.get(id) ?? []);
  patchAgent(msgId, (a) => ({ ...a, status: failed.size && !merged.length ? 'error' : 'merging' }));
  try {
    if (merged.length) {
      const failedCount = failed.size;
      if (failedCount) pushMsg({ role: 'sys', text: tr('agents.partial', { n: failedCount }) });
      await handleActions(msgId, merged, run.prompt, '', [], 1);
    }
    patchAgent(msgId, (a) => ({ ...a, status: failed.size && !merged.length ? 'error' : 'done' }));
  } catch (e) {
    pushMsg({ role: 'sys', text: friendlyError(e), error: true });
  } finally {
    st().set({ busy: false });
  }
}
