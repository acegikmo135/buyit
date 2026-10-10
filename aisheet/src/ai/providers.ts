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
    return j?.error?.message ?? j?.error ?? j?.message ?? text.slice(0, 300);
  } catch {
    return text.slice(0, 300) || res.statusText;
  }
}

function join(base: string, path: string) {
  return base.replace(/\/+$/, '') + path;
}

export async function chat(cfg: ProviderConfig, system: string, messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
  const def = providerById(cfg.id);
  const base = cfg.baseUrl?.trim() || def.baseUrl;
  if (!cfg.model) throw new AiError('No model selected');
  if (!cfg.apiKey && !def.keyOptional) throw new AiError('API key missing');

  if (def.kind === 'openai') {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
    if (cfg.id === 'openrouter') {
      headers['HTTP-Referer'] = 'https://aisheet.app';
      headers['X-Title'] = 'AiSheet';
    }
    const body: Record<string, unknown> = {
      model: cfg.model,
      messages: [{ role: 'system', content: system }, ...messages],
    };
    if (cfg.id === 'openai' || cfg.id === 'openrouter' || cfg.id === 'groq' || cfg.id === 'deepseek' || cfg.id === 'mistral') body.response_format = { type: 'json_object' };
    let res = await httpFetch(join(base, '/chat/completions'), { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!res.ok && body.response_format && (res.status === 400 || res.status === 422)) {
      delete body.response_format; // model/provider rejected JSON mode — retry plain
      res = await httpFetch(join(base, '/chat/completions'), { method: 'POST', headers, body: JSON.stringify(body), signal });
    }
    if (!res.ok) throw new AiError(await readError(res), res.status);
    const j = await res.json();
    const content = j?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map((p: { text?: string }) => p.text ?? '').join('');
    throw new AiError('Empty response from model');
  }

  if (def.kind === 'anthropic') {
    const res = await httpFetch(join(base, '/messages'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model: cfg.model, max_tokens: 16000, system, messages }),
      signal,
    });
    if (!res.ok) throw new AiError(await readError(res), res.status);
    const j = await res.json();
    const text = (j?.content ?? []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('');
    if (!text) throw new AiError('Empty response from model');
    return text;
  }

  // gemini
  const res = await httpFetch(join(base, `/models/${encodeURIComponent(cfg.model.replace(/^models\//, ''))}:generateContent`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { responseMimeType: 'application/json' },
    }),
    signal,
  });
  if (!res.ok) throw new AiError(await readError(res), res.status);
  const j = await res.json();
  const text = (j?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');
  if (!text) throw new AiError(j?.promptFeedback?.blockReason ? `Blocked: ${j.promptFeedback.blockReason}` : 'Empty response from model');
  return text;
}

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
    const res = await httpFetch(join(base, '/models?limit=100'), {
      headers: { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    });
    if (!res.ok) throw new AiError(await readError(res), res.status);
    const j = await res.json();
    return (j.data ?? []).map((m: { id: string }) => m.id);
  }
  const res = await httpFetch(join(base, '/models?pageSize=200'), { headers: { 'x-goog-api-key': cfg.apiKey } });
  if (!res.ok) throw new AiError(await readError(res), res.status);
  const j = await res.json();
  return (j.models ?? [])
    .filter((m: { supportedGenerationMethods?: string[] }) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m: { name: string }) => m.name.replace(/^models\//, ''));
}
