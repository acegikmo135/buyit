const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const E = require('../engine.js');
const L = require('../llm.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'samples', f), 'utf8');
const rules = (a) => a.findings.map((f) => f.rule);

test('predatory sample lease: every planted trap is found', () => {
  const a = E.analyze(read('sample-lease.txt'));
  for (const r of ['autorenew', 'rentincrease', 'entry', 'earlyterm', 'liability', 'unilateral', 'arbitration', 'latefee', 'deposit', 'nonrefundable', 'repairs', 'fees']) {
    assert.ok(rules(a).includes(r), 'missing rule ' + r);
  }
  assert.equal(a.level, 'high');
  assert.deepEqual(a.missing.map((m) => m.rule).sort(), ['deposit-return', 'move-out', 'repair-process']);
  assert.equal(a.facts.rent.value, 1500);
  assert.equal(a.facts.deposit.value, 4500);
  assert.equal(a.findings[0].severity, 'high'); // sorted worst-first
});

test('fair lease: no high-severity flags and nothing missing', () => {
  const a = E.analyze(read('fair-lease.txt'));
  assert.deepEqual(a.findings.filter((f) => f.severity === 'high'), []);
  assert.deepEqual(a.missing, []);
  assert.notEqual(a.level, 'high');
});

test('rules read numbers, not just keywords', () => {
  const lease = (extra) => E.analyze(`1. Rent. Monthly rent is $1,000.\n2. Deposit. Tenant shall pay a security deposit of $1,000.\n${extra}`);
  assert.ok(rules(lease('3. Entry. Landlord may enter the unit with 2 hours notice.')).includes('entry'));
  assert.ok(!rules(lease('3. Entry. Landlord may enter the unit with 48 hours notice.')).includes('entry'));
  assert.ok(rules(lease('3. Late. A late fee of 10% applies.')).includes('latefee'));
  assert.ok(!rules(lease('3. Late. A late fee of 3% applies after a 5 day grace period.')).includes('latefee'));
  const big = E.analyze('1. Rent. Monthly rent is $1,000.\n2. Deposit. Security deposit of $3,000.\n3. x. y.');
  assert.ok(rules(big).includes('deposit'));
  const ok = E.analyze('1. Rent. Monthly rent is $1,000.\n2. Deposit. Security deposit of $1,000.\n3. x. y.');
  assert.ok(!rules(ok).includes('deposit'));
});

test('re-letting duty downgrades early termination to medium', () => {
  const a = E.analyze('1. A. x.\n2. B. y.\n3. Early termination. If Tenant vacates early, remaining rent is due, but Landlord shall re-let the unit and credit rent received.');
  const f = a.findings.find((x) => x.rule === 'earlyterm');
  assert.ok(!f || f.severity === 'medium');
});

test('segmentation: numbered, unnumbered and empty input', () => {
  assert.equal(E.segment('').length, 0);
  assert.equal(E.analyze('').level, 'none');
  const un = E.segment('Tenant pays rent monthly. Landlord may enter at any time.\n\nNo pets allowed.');
  assert.ok(un.length >= 2);
  const nm = E.segment('1. One.\ncontinues here\n2. Two.\n3. Three.');
  assert.equal(nm.length, 3);
  assert.match(nm[0].text, /continues here/);
  assert.equal(nm[0].id, 'C1');
});

test('retrieval answers questions with the right clause and says so when absent', () => {
  const a = E.analyze(read('sample-lease.txt'));
  const ix = E.buildIndex(a.clauses);
  const top = (q) => E.search(q, ix, 1)[0].clause.text;
  assert.match(top('can I have a dog'), /pets/i);
  assert.match(top('what happens if I leave early'), /vacates/i);
  assert.match(top('can my landlord come in whenever'), /enter/i);
  assert.match(top('how much is the late fee'), /late fee/i);
  const none = E.answerOffline('is there a swimming pool', ix);
  assert.equal(none.found, false);
  assert.match(none.text, /couldn't find/);
});

test('markdown export lists findings', () => {
  const md = E.toMarkdown(E.analyze(read('sample-lease.txt')));
  assert.match(md, /# LeaseLens report/);
  assert.match(md, /\*\*Ask:\*\*/);
});

test('LLM prompt is grounded and sends only retrieved clauses', () => {
  const a = E.analyze(read('sample-lease.txt'));
  const ix = E.buildIndex(a.clauses);
  const hits = E.search('pets', ix, 2);
  const p = L.buildPrompt('Can I have a dog?', hits);
  assert.match(p, /ONLY the clauses/);
  assert.ok(p.includes(hits[0].clause.text));
  assert.ok(!p.includes('arbitration'), 'unrelated clauses must not leak into the prompt');
});

test('citation checker rejects invented clause ids', () => {
  const hits = [{ clause: { id: 'C3' } }];
  assert.equal(L.checkCitations('Yes [C3].', hits).grounded, true);
  assert.equal(L.checkCitations('Yes [C9].', hits).grounded, false);
  assert.equal(L.checkCitations('Probably fine.', hits).grounded, false);
  assert.equal(L.checkCitations('The lease does not say.', hits).grounded, true);
});

test('LLM clients: request shape, errors, missing key', async () => {
  const seen = [];
  const fakeFetch = (resp, ok = true, status = 200) => async (url, init) => { seen.push({ url, init }); return { ok, status, json: async () => resp }; };
  const g = await L.ask({ provider: 'gemini', key: 'k' }, 'hi', fakeFetch({ candidates: [{ content: { parts: [{ text: ' ok [C1] ' }] } }] }));
  assert.equal(g, 'ok [C1]');
  assert.match(seen[0].url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-.*:generateContent$/);
  assert.equal(seen[0].init.headers['x-goog-api-key'], 'k');
  assert.ok(!seen[0].url.includes('k=k') && !seen[0].url.includes('key='), 'key must not be in the URL');
  const o = await L.ask({ provider: 'ollama' }, 'hi', fakeFetch({ response: 'fine' }));
  assert.equal(o, 'fine');
  assert.match(seen[1].url, /localhost:11434\/api\/generate/);
  await assert.rejects(() => L.ask({ provider: 'gemini' }, 'x', fakeFetch({})), /API key/);
  await assert.rejects(() => L.ask({ provider: 'gemini', key: 'k' }, 'x', fakeFetch({}, false, 429)), /429/);
  await assert.rejects(() => L.ask({ provider: 'none' }, 'x', fakeFetch({})), /No AI provider/);
});
