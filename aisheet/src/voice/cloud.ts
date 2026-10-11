// Optional cloud transcription through the user's own key (OpenAI / Groq Whisper, or Gemini audio).
import { httpFetch } from '../platform';
import { providerById, type ProviderId } from '../ai/providers';
import { toWav } from './audio';

export const cloudSupported = (id: ProviderId) => id === 'openai' || id === 'groq' || id === 'gemini';

export async function transcribeCloud(pcm: Float32Array, cfg: { id: ProviderId; apiKey: string; baseUrl?: string }, lang: 'en' | 'gu' | 'auto'): Promise<string> {
  const def = providerById(cfg.id);
  const base = (cfg.baseUrl?.trim() || def.baseUrl).replace(/\/+$/, '');
  const wav = toWav(pcm);
  if (cfg.id === 'openai' || cfg.id === 'groq') {
    const fd = new FormData();
    fd.append('file', wav, 'audio.wav');
    fd.append('model', cfg.id === 'groq' ? 'whisper-large-v3-turbo' : 'gpt-4o-mini-transcribe');
    if (lang !== 'auto') fd.append('language', lang);
    const res = await httpFetch(base + '/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${cfg.apiKey}` }, body: fd });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    return ((await res.json()).text as string) ?? '';
  }
  if (cfg.id === 'gemini') {
    const b64 = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve((r.result as string).split(',')[1]);
      r.readAsDataURL(wav);
    });
    const hint = lang === 'gu' ? 'The speech is in Gujarati.' : lang === 'en' ? 'The speech is in English.' : 'The speech is English, Gujarati, or a mix.';
    const res = await httpFetch(`${base}/models/gemini-2.5-flash:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: `Transcribe this audio verbatim. ${hint} Gujarati in Gujarati script, English in Latin script. Output only the transcript.` }, { inline_data: { mime_type: 'audio/wav', data: b64 } }] }] }),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    return (j.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('').trim();
  }
  throw new Error('This provider has no speech-to-text API. Use OpenAI, Groq or Gemini, or the on-device model.');
}
