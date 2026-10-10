// Browser smoke test: node tests/ui.smoke.mjs  (needs playwright + chromium; see README)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.txt': 'text/plain' };
const server = createServer(async (req, res) => {
  let p = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  if (p === '/') p = '/index.html';
  try { const b = await readFile(join(root, p)); res.writeHead(200, { 'content-type': types[extname(p)] || 'text/plain' }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const url = `http://localhost:${server.address().port}/`;

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const check = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('ok:', msg); };

await page.goto(url);
await page.click('#sample1');
await page.waitForSelector('.finding.high');
check((await page.locator('.finding.high').count()) >= 5, 'risky sample shows >=5 high-severity findings');
check((await page.textContent('#report')).includes('Overall concern'), 'overall concern rendered');

await page.fill('#q', 'Can I have a dog?');
await page.click('#ask');
check((await page.textContent('#answer')).toLowerCase().includes('pets'), 'offline Q&A quotes the pets clause');

await page.click('#sample2');
await page.waitForFunction(() => /· 0 flagged/.test(document.querySelector('#report').textContent));
check((await page.locator('.finding.high').count()) === 0, 'fair sample has no high-severity findings');

// hostile lease text must not be interpreted as HTML
await page.fill('#lease', '1. Entry. Landlord may enter at any time <img src=x onerror="window.__xss=1"> without notice.\n2. B. x.\n3. C. y.');
await page.click('#analyze');
await page.waitForSelector('.finding');
check(!(await page.evaluate(() => window.__xss)), 'lease text is never injected as HTML');

// AI path with a stubbed Gemini endpoint: only the question + retrieved clauses leave the page
await page.click('#sample1');
await page.waitForSelector('.finding.high');
let sentBody = null;
await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
  sentBody = route.request().postData();
  await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'No pets without written consent [C13].' }] } }] }) });
});
await page.selectOption('#provider', 'gemini');
await page.fill('#key', 'test-key');
await page.fill('#q', 'Can I have a dog?');
await page.click('#ask');
await page.waitForFunction(() => document.querySelector('#answer .ans'));
check(sentBody && sentBody.includes('Pets') && !sentBody.includes('arbitration'), 'Gemini request contains the pet clause but not unrelated clauses');
check(!(await page.textContent('#answer')).includes('unverified'), 'valid citation is accepted');

// mobile layout has no horizontal scroll
await page.setViewportSize({ width: 375, height: 800 });
check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal scroll at 375px');
check(errors.length === 0, 'no console/page errors ' + errors.join('; '));
if (process.env.SHOT) { await page.setViewportSize({ width: 1200, height: 1100 }); await page.screenshot({ path: process.env.SHOT, fullPage: true }); }
await browser.close(); server.close();
