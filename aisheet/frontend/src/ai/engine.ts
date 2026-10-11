import type { Workbook } from '../core/workbook';
import { AiError, streamChat, type ChatMessage, type ProviderConfig } from './providers';
import { parseReply, visibleText, type AiReply } from './protocol';
import { describeTool, runTool } from './tools';

export interface ModelRun {
  raw: string;
  reply: AiReply;
  steps: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function once(cfg: ProviderConfig, system: string, messages: ChatMessage[], onDelta: (d: string) => void, signal?: AbortSignal): Promise<string> {
  try {
    return await streamChat(cfg, system, messages, onDelta, signal);
  } catch (e) {
    // one polite retry on rate limits / transient network errors
    const retriable = e instanceof AiError ? e.status === 429 || (e.status ?? 0) >= 500 : (e as Error).name !== 'AbortError' && /network|fetch|reset|timeout/i.test((e as Error).message);
    if (!retriable || signal?.aborted) throw e;
    await sleep(1800);
    return streamChat(cfg, system, messages, onDelta, signal);
  }
}

/**
 * Runs the model, executing any read tools it asks for (up to `maxRounds`) before returning the final reply.
 * `onText` receives the visible text accumulated across all rounds.
 */
export async function runModel(o: {
  system: string;
  messages: ChatMessage[];
  wb: Workbook;
  activeSheetId: string;
  cfg: ProviderConfig;
  signal?: AbortSignal;
  onText?: (visible: string) => void;
  onStep?: (step: string) => void;
  maxRounds?: number;
}): Promise<ModelRun> {
  const msgs = [...o.messages];
  const steps: string[] = [];
  let prefix = '';
  const maxRounds = o.maxRounds ?? 4;
  for (let round = 0; ; round++) {
    let raw = '';
    raw = await once(o.cfg, o.system, msgs, (d) => {
      raw += d;
      o.onText?.(prefix + visibleText(raw));
    }, o.signal);
    const reply = parseReply(raw);
    if (!reply.tools.length || round >= maxRounds) {
      return { raw, reply: { ...reply, message: (prefix + reply.message).trim() }, steps };
    }
    const results = reply.tools.map((t) => {
      const step = describeTool(t);
      steps.push(step);
      o.onStep?.(step);
      return runTool(o.wb, t, o.activeSheetId);
    });
    prefix += reply.message ? reply.message + '\n\n' : '';
    msgs.push({ role: 'assistant', content: raw }, { role: 'user', content: `[tool results]\n${results.join('\n\n')}\n\nContinue with the task. If you now have what you need, finish with your reply and the actions block.` });
  }
}
