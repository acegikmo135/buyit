/* Optional free LLM backends for LeaseLens (browser or Node 18+).
 *  - Gemini free tier (Google AI Studio key)   - Ollama on localhost (no key, fully local)
 * Only the question and the few retrieved clauses are ever sent, never the whole lease. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LeaseLLM = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function buildPrompt(question, hits) {
    const ctx = hits.map((h) => `[${h.clause.id}] (${h.clause.label}) ${h.clause.text}`).join('\n');
    return [
      'You explain rental lease clauses to a tenant in plain English.',
      'Rules: use ONLY the clauses below. Cite every claim like [C3]. If the clauses do not answer the question, say "The lease does not say" and stop.',
      'Do not give legal advice; mention that local law may override the lease when relevant. Be brief (max 5 sentences).',
      '', 'CLAUSES:', ctx, '', 'QUESTION: ' + question, 'ANSWER:',
    ].join('\n');
  }

  /* Check the model only cited clauses it was shown. */
  function checkCitations(answer, hits) {
    const shown = new Set(hits.map((h) => h.clause.id));
    const cited = [...new Set((answer.match(/\[(C\d+)\]/g) || []).map((s) => s.slice(1, -1)))];
    const invalid = cited.filter((c) => !shown.has(c));
    const admitsGap = /does not say|doesn't say|not (?:covered|mentioned|addressed)/i.test(answer);
    return { cited, invalid, grounded: invalid.length === 0 && (cited.length > 0 || admitsGap) };
  }

  async function ask(cfg, prompt, fetchImpl) {
    const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) throw new Error('fetch unavailable');
    if (cfg.provider === 'gemini') {
      if (!cfg.key) throw new Error('Add a Gemini API key (free at aistudio.google.com)');
      const model = cfg.model || 'gemini-2.5-flash';
      const r = await f(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.key },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1 } }),
      });
      if (!r.ok) throw new Error(`Gemini error ${r.status}`);
      const j = await r.json();
      const t = j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts && j.candidates[0].content.parts[0].text;
      if (!t) throw new Error('Gemini returned no text');
      return t.trim();
    }
    if (cfg.provider === 'ollama') {
      const host = (cfg.host || 'http://localhost:11434').replace(/\/$/, '');
      const r = await f(host + '/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: cfg.model || 'llama3.2', prompt, stream: false, options: { temperature: 0.1 } }) });
      if (!r.ok) throw new Error(`Ollama error ${r.status}`);
      const j = await r.json();
      if (!j.response) throw new Error('Ollama returned no text');
      return j.response.trim();
    }
    throw new Error('No AI provider selected');
  }

  return { buildPrompt, checkCitations, ask };
});
