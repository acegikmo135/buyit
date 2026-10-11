import { httpFetch } from '../platform';

export type ProviderId = 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'groq' | 'deepseek' | 'mistral' | 'xai' | 'ollama' | 'custom';

export interface ProviderDef {
  id: ProviderId;
  label: string;
  kind: 'openai' | 'anthropic' | 'gemini';
  baseUrl: string;
  defaultModel: string;
  models: string[];
  keyOptional?: boolean;
  editableUrl?: boolean;
  keyHint: string;
}

export const PROVIDERS: ProviderDef[] = [
  { id: 'openai', label: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4.1', models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini'], keyHint: 'sk-…' },
  { id: 'anthropic', label: 'Claude (Anthropic)', kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-sonnet-5-5', models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'], keyHint: 'sk-ant-…' },
  { id: 'gemini', label: 'Gemini (Google)', kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-2.5-flash', models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'], keyHint: 'AIza…' },
  { id: 'openrouter', label: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'anthropic/claude-sonnet-4.5', models: ['anthropic/claude-sonnet-4.5', 'openai/gpt-4.1', 'google/gemini-2.5-flash', 'deepseek/deepseek-chat'], keyHint: 'sk-or-…' },
  { id: 'groq', label: 'Groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile', models: ['llama-3.3-70b-versatile'], keyHint: 'gsk_…' },
  { id: 'deepseek', label: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', models: ['deepseek-chat', 'deepseek-reasoner'], keyHint: 'sk-…' },
  { id: 'mistral', label: 'Mistral', kind: 'openai', baseUrl: 'https://api.mistral.ai/v1', defaultModel: 'mistral-large-latest', models: ['mistral-large-latest', 'mistral-small-latest'], keyHint: '' },
  { id: 'xai', label: 'xAI (Grok)', kind: 'openai', baseUrl: 'https://api.x.ai/v1', defaultModel: 'grok-4', models: ['grok-4'], keyHint: 'xai-…' },
  { id: 'ollama', label: 'Ollama (local)', kind: 'openai', baseUrl: 'http://localhost:11434/v1', defaultModel: 'llama3.1', models: [], keyOptional: true, editableUrl: true, keyHint: '(not needed)' },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', kind: 'openai', baseUrl: 'http://localhost:1234/v1', defaultModel: '', models: [], keyOptional: true, editableUrl: true, keyHint: '' },
];

export const providerById = (id: ProviderId) => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ProviderConfig {
  id: ProviderId;
  model: string;
  baseUrl?: string;
  apiKey: string;
  /** OpenRouter only: route exclusively to endpoints that do not retain or train on prompts. */
  strictPrivacy?: boolean;
}

export class AiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const j = JSON.parse(text);
    const m = j?.error?.message ?? j?.error ?? j?.message;
    return typeof m === 'string' ? m : JSON.stringify(m ?? text).slice(0, 300);
  } catch {
    return text.slice(0, 300) || res.statusText;
  }
}

const join = (base: string, path: string) => base.replace(/\/+$/, '') + path;

/** Reads a Server-Sent-Events body and yields each `data:` payload. */
async function* sse(res: Response): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '');
      const data = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (data && data !== '[DONE]') yield data;
    }
  }
}

/** Streams a reply; `onDelta` receives text as it arrives. Resolves with the full text. */
export async function streamChat(cfg: ProviderConfig, system: string, messages: ChatMessage[], onDelta?: (t: string) => void, signal?: AbortSignal): Promise<string> {
  const def = providerById(cfg.id);
  const base = cfg.baseUrl?.trim() || def.baseUrl;
  if (!cfg.model) throw new AiError('No model selected');
  if (!cfg.apiKey && !def.keyOptional) throw new AiError('API key missing');
  let full = '';
  const push = (t: string) => {
    if (!t) return;
    full += t;
    onDelta?.(t);
  };

  if (def.kind === 'openai') {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
    if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
    const body: Record<string, unknown> = { model: cfg.model, stream: true, messages: [{ role: 'system', content: system }, ...messages] };
    if (cfg.id === 'openrouter') {
      headers['HTTP-Referer'] = 'https://aisheet.app';
      headers['X-Title'] = 'AiSheet';
      // Privacy: only providers that don't collect/train on data (data_collection) and keep no logs (zdr).
      if (cfg.strictPrivacy !== false) body.provider = { data_collection: 'deny', zdr: true };
    }
    const res = await httpFetch(join(base, '/chat/completions'), { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!res.ok) {
      const msg = await readError(res);
      if (cfg.id === 'openrouter' && res.status === 404 && /endpoint|data policy|zdr|retention/i.test(msg)) throw new AiError('PRIVACY_NO_ENDPOINT', 404);
      throw new AiError(msg, res.status);
    }
    for await (const data of sse(res)) {
      try {
        const j = JSON.parse(data);
        if (j.error) throw new AiError(j.error.message ?? 'Provider error');
        push(j.choices?.[0]?.delta?.content ?? '');
      } catch (e) {
        if (e instanceof AiError) throw e;
      }
    }
  } else if (def.kind === 'anthropic') {
    const res = await httpFetch(join(base, '/messages'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: cfg.model, max_tokens: 16000, stream: true, system, messages }),
      signal,
    });
    if (!res.ok) throw new AiError(await readError(res), res.status);
    for await (const data of sse(res)) {
      try {
        const j = JSON.parse(data);
        if (j.type === 'error') throw new AiError(j.error?.message ?? 'Provider error');
        if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta') push(j.delta.text);
      } catch (e) {
        if (e instanceof AiError) throw e;
      }
    }
  } else {
    const res = await httpFetch(join(base, `/models/${encodeURIComponent(cfg.model.replace(/^models\//, ''))}:streamGenerateContent?alt=sse`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      }),
      signal,
    });
    if (!res.ok) throw new AiError(await readError(res), res.status);
    for await (const data of sse(res)) {
      try {
        const j = JSON.parse(data);
        push((j.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join(''));
      } catch {
        /* ignore keep-alives */
      }
    }
  }
  if (!full.trim()) throw new AiError('Empty response from model');
  return full;
}

export const chat = (cfg: ProviderConfig, system: string, messages: ChatMessage[], signal?: AbortSignal) => streamChat(cfg, system, messages, undefined, signal);

export async function listModels(cfg: Omit<ProviderConfig, 'model'>): Promise<string[]> {
  const def = providerById(cfg.id);
  const base = cfg.baseUrl?.trim() || def.baseUrl;
  if (def.kind === 'openai') {
    const headers: Record<string, string> = {};
    if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
    const res = await httpFetch(join(base, '/models'), { headers });
    if (!res.ok) throw new AiError(await readError(res), res.status);
    const j = await res.json();
    return (j.data ?? j.models ?? []).map((m: { id?: string; name?: string }) => m.id ?? m.name ?? '').filter(Boolean).sort();
  }
  if (def.kind === 'anthropic') {
    const res = await httpFetch(join(base, '/models?limit=100'), { headers: { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } });
    if (!res.ok) throw new AiError(await readError(res), res.status);
    return ((await res.json()).data ?? []).map((m: { id: string }) => m.id);
  }
  const res = await httpFetch(join(base, '/models?pageSize=200'), { headers: { 'x-goog-api-key': cfg.apiKey } });
  if (!res.ok) throw new AiError(await readError(res), res.status);
  const j = await res.json();
  return (j.models ?? []).filter((m: { supportedGenerationMethods?: string[] }) => m.supportedGenerationMethods?.includes('generateContent')).map((m: { name: string }) => m.name.replace(/^models\//, ''));
}
