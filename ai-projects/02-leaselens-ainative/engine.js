/* LeaseLens engine: clause segmentation, risk rules, missing-protection checks,
 * BM25 retrieval. Pure JS, no dependencies; runs in the browser and in Node.
 * Rules are common tenant-protection rules of thumb, NOT legal advice: limits
 * vary by jurisdiction. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LeaseEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SEV = { high: 3, medium: 2, low: 1, info: 0 };

  // ---------- segmentation ----------
  const NUMBERED = /^\s*(?:(?:article|section|clause)\s+)?(\d{1,2}(?:\.\d{1,2}){0,2})[.)]?\s+\S/i;

  function segment(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    let clauses = [];
    let cur = null;
    for (const line of lines) {
      const m = line.match(NUMBERED);
      if (m) {
        cur = { label: m[1], text: line.trim() };
        clauses.push(cur);
      } else if (cur && line.trim()) {
        cur.text += ' ' + line.trim();
      } else if (!cur && line.trim()) {
        cur = { label: '', text: line.trim() };
        clauses.push(cur);
      } else if (!line.trim()) {
        // blank line ends a lease paragraph only for unnumbered text
        if (cur && !cur.label) cur = null;
      }
    }
    if (clauses.filter((c) => c.label).length < 3) {
      // unnumbered lease: paragraphs, then sentence chunks for very long ones
      clauses = [];
      for (const para of String(text || '').replace(/\r/g, '').split(/\n\s*\n/)) {
        const p = para.replace(/\s+/g, ' ').trim();
        if (!p) continue;
        const sents = p.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [p];
        for (let i = 0; i < sents.length; i += 3) clauses.push({ label: '', text: sents.slice(i, i + 3).join('').trim() });
      }
    }
    return clauses.map((c, i) => ({ id: 'C' + (i + 1), label: c.label ? '§' + c.label : '¶' + (i + 1), text: c.text.replace(/\s+/g, ' ').trim() }));
  }

  // ---------- facts ----------
  const MONEY = '\\$\\s?([\\d,]+(?:\\.\\d{1,2})?)';
  const num = (s) => parseFloat(String(s).replace(/,/g, ''));

  function extractFacts(clauses) {
    const facts = {};
    const all = clauses.map((c) => ({ id: c.id, t: c.text }));
    const find = (re, fn) => {
      for (const { id, t } of all) {
        const m = t.match(re);
        if (m) return fn(m, id);
      }
    };
    facts.rent = find(new RegExp('(?:monthly\\s+rent|rent)\\b[^.$]{0,40}?' + MONEY, 'i'), (m, id) => ({ value: num(m[1]), clause: id }));
    facts.deposit = find(new RegExp('security\\s+deposit\\b[^.$]{0,40}?' + MONEY, 'i'), (m, id) => ({ value: num(m[1]), clause: id }));
    facts.term = find(/(?:term|period)\b[^.]{0,40}?(\d{1,2})\s*(?:\(\d+\)\s*)?months?/i, (m, id) => ({ months: parseInt(m[1], 10), clause: id }));
    facts.lateFee = find(new RegExp('late\\s+(?:fee|charge)s?\\b[^.$%]{0,60}?' + MONEY, 'i'), (m, id) => ({ amount: num(m[1]), clause: id }))
      || find(/late\s+(?:fee|charge)s?\b[^.%]{0,60}?(\d+(?:\.\d+)?)\s*%/i, (m, id) => ({ percent: parseFloat(m[1]), clause: id }));
    return facts;
  }

  // ---------- risk rules ----------
  // Each rule: test(text, facts) -> null | {severity, why, match?}
  const sentenceWith = (text, re) => {
    const sents = text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [text];
    const body = sents.filter((s) => s.trim().split(/\s+/).length > 4); // skip "4. Late Fees." headings
    return ((body.find((s) => re.test(s)) || sents.find((s) => re.test(s)) || sents[0])).trim();
  };
  const hit = (text, re) => (re.test(text) ? sentenceWith(text, re) : null);

  const RULES = [
    {
      id: 'entry', title: 'Landlord entry',
      ask: 'Ask for at least 24 hours written notice, except for emergencies.',
      test(t) {
        if (!/\b(enter|entry|access|inspect)\w*\b[^.]{0,80}\b(premises|unit|apartment|dwelling|property|home)\b|\b(premises|unit|apartment)\b[^.]{0,60}\b(enter|entry|inspect)/i.test(t)) return null;
        const any = /at\s+any\s+time|without\s+(?:prior\s+)?(?:notice|consent|permission)|sole\s+discretion/i;
        if (any.test(t)) return { severity: 'high', why: 'Landlord can enter without real notice. Many places require advance notice (often 24-48 hours) except in emergencies.', match: sentenceWith(t, any) };
        const n = t.match(/(\d+)\s*(hours?|hrs?|days?)['’]?\s*(?:prior\s+|advance\s+)?(?:written\s+)?notice/i);
        if (n) {
          const hrs = parseInt(n[1], 10) * (/day/i.test(n[2]) ? 24 : 1);
          if (hrs < 24) return { severity: 'medium', why: `Only ${n[1]} ${n[2]} notice before entry. 24+ hours is a common standard.`, match: sentenceWith(t, /notice/i) };
          return null;
        }
        return { severity: 'medium', why: 'Entry is allowed but no notice period is stated.', match: sentenceWith(t, /enter|entry|access|inspect/i) };
      },
    },
    {
      id: 'autorenew', title: 'Automatic renewal',
      ask: 'Ask to convert renewal to month-to-month and cap the non-renewal notice at 30 days.',
      test(t) {
        const re = /automatic(?:ally)?\s+(?:renew|extend)|auto-?renew|evergreen|renew(?:s|ed)?\s+(?:automatically|for\s+(?:successive|additional|another))/i;
        if (!re.test(t)) return null;
        const days = t.match(/(\d{2,3})\s*(?:\(\d+\)\s*)?days?/i);
        const year = /(?:one|1)\s*(?:\(1\)\s*)?year|twelve\s*\(?12?\)?\s*months?|12\s*months?|successive\s+(?:one|1)/i.test(t);
        if (days && parseInt(days[1], 10) >= 60 && year) return { severity: 'high', why: `Renews for a full year unless you give ${days[1]}+ days notice. Missing the window locks you in again.`, match: sentenceWith(t, re) };
        return { severity: 'medium', why: 'Lease renews automatically; put the cancellation deadline in your calendar.', match: sentenceWith(t, re) };
      },
    },
    {
      id: 'earlyterm', title: 'Early termination cost',
      ask: 'Ask for a fixed, capped fee (for example 1-2 months rent) and a duty on the landlord to re-rent.',
      test(t) {
        if (!/early\s+terminat|terminate\s+(?:this\s+)?(?:lease\s+)?early|break(?:ing)?\s+(?:this|the)\s+lease|vacat\w+\s+(?:before|prior)|abandon/i.test(t) && !/remaining\s+(?:rent|balance)|balance\s+of\s+(?:the\s+)?(?:term|rent)/i.test(t)) return null;
        const bad = /(all|entire|remaining|balance\s+of)[^.]{0,40}(rent|term|lease)[^.]{0,40}(due|owed|payable|accelerat)|accelerat\w+\s+(?:of\s+)?rent|forfeit/i;
        const mitigates = /re-?let|re-?rent|mitigat/i.test(t);
        if (bad.test(t) && !mitigates) return { severity: 'high', why: 'Leaving early could make all remaining rent due, with no duty on the landlord to find a new tenant.', match: sentenceWith(t, bad) };
        if (bad.test(t) || /(\d+)\s*months?['’]?\s*(?:rent|notice)\s*(?:fee|penalty|charge)/i.test(t)) return { severity: 'medium', why: 'There is a cost to leaving early; check the amount and whether it is capped.', match: sentenceWith(t, /early|terminat|remaining|vacat/i) };
        return null;
      },
    },
    {
      id: 'liability', title: 'Landlord liability waiver',
      ask: 'Ask to remove language that excuses the landlord from its own negligence.',
      test(t) {
        const re = /(landlord|owner|lessor|management)[^.]{0,80}(not\s+be\s+(?:held\s+)?(?:liable|responsible)|shall\s+not\s+be\s+(?:liable|responsible)|is\s+not\s+(?:liable|responsible)|waive[sd]?|released?|exempt)|(tenant|resident|lessee)[^.]{0,60}(indemnif|hold\s+harmless|assumes?\s+all\s+risk)/i;
        if (!re.test(t)) return null;
        if (/negligen|gross|willful|misconduct/i.test(t)) return { severity: 'high', why: 'Tries to excuse the landlord even for its own negligence. Many places make such clauses unenforceable.', match: sentenceWith(t, re) };
        return { severity: 'medium', why: 'Shifts risk of injury or loss onto you; check that it does not cover landlord negligence.', match: sentenceWith(t, re) };
      },
    },
    {
      id: 'unilateral', title: 'Landlord can change terms',
      ask: 'Ask that any change to rent or terms needs your written agreement or legal notice.',
      test(t) {
        const re = /(landlord|owner|lessor|management)[^.]{0,80}(may|can|reserves?\s+the\s+right\s+to|has\s+the\s+right\s+to)[^.]{0,40}(change|modify|amend|revise|alter|update)[^.]{0,80}(terms|rules|regulations|lease|agreement|policies|rent)/i;
        if (!re.test(t)) return null;
        const big = /(lease|agreement|rent|terms)[^.]{0,30}(at\s+any\s+time|sole\s+discretion|without\s+(?:notice|consent))|(at\s+any\s+time|sole\s+discretion|without\s+(?:notice|consent))/i.test(t);
        return { severity: big ? 'high' : 'medium', why: 'Landlord can rewrite the deal after you sign.', match: sentenceWith(t, re) };
      },
    },
    {
      id: 'rentincrease', title: 'Rent increase during the term',
      ask: 'Ask that rent is fixed for the lease term and any increase needs 60-90 days notice.',
      test(t) {
        const re = /(increase|raise|adjust|change)[^.]{0,50}\brent\b[^.]{0,100}(any\s*time|sole\s*discretion|at\s+landlord'?s\s+discretion|upon\s+\d+\s*days?)|\brent\b[^.]{0,60}(may|can|will)\s+(?:be\s+)?(increase|raise|adjust)/i;
        if (!re.test(t)) return null;
        if (/any\s*time|sole\s*discretion|discretion/i.test(t)) return { severity: 'high', why: 'Rent can go up at the landlord\'s discretion, even mid-lease.', match: sentenceWith(t, re) };
        const n = t.match(/(\d+)\s*days?/i);
        if (n && parseInt(n[1], 10) < 30) return { severity: 'medium', why: `Only ${n[1]} days notice of a rent increase.`, match: sentenceWith(t, re) };
        return { severity: 'low', why: 'Rent can change; check when and with how much notice.', match: sentenceWith(t, re) };
      },
    },
    {
      id: 'latefee', title: 'Late fees',
      ask: 'Ask for a flat, reasonable late fee (often 5% of rent or less) after a grace period of 3-5 days.',
      test(t, facts) {
        if (!/late\s+(?:fee|charge|payment)/i.test(t)) return null;
        const rent = facts.rent && facts.rent.value;
        const pct = t.match(/(\d+(?:\.\d+)?)\s*%/);
        const amt = t.match(new RegExp(MONEY));
        const daily = /(per|each|every)\s+day|daily|compound/i.test(t);
        if (pct && parseFloat(pct[1]) > 5) return { severity: 'medium', why: `Late fee of ${pct[1]}% is above the ~5% commonly seen as reasonable.`, match: sentenceWith(t, /late/i) };
        if (rent && amt && num(amt[1]) > 0.1 * rent && !daily) return { severity: 'medium', why: `Late fee $${num(amt[1])} is over 10% of the $${rent} rent.`, match: sentenceWith(t, /late/i) };
        if (daily) return { severity: 'medium', why: 'Late fee keeps accruing daily, which can snowball.', match: sentenceWith(t, /late/i) };
        if (!/grace|\bafter\s+the\s+\w+\s+(?:\(\w+\)\s*)?day|within\s+\d+|(?:more\s+than|after|beyond)\s+(?:the\s+)?\w+\s*(?:\(\d+\)\s*)?days?|\d+\s*days?\s+(?:after|past|late)/i.test(t)) return { severity: 'low', why: 'No grace period mentioned.', match: sentenceWith(t, /late/i) };
        return null;
      },
    },
    {
      id: 'arbitration', title: 'Waiver of court / jury / class action',
      ask: 'Ask to strike mandatory arbitration and jury or class-action waivers.',
      test(t) {
        const re = /binding\s+arbitration|mandatory\s+arbitration|waive[sd]?[^.]{0,50}(?:jury|class\s+action|right\s+to\s+(?:sue|a\s+trial))|class\s+action\s+waiver|jury\s+trial\s+waiver/i;
        return re.test(t) ? { severity: 'high', why: 'Limits your ability to go to court or join others in a claim.', match: sentenceWith(t, re) } : null;
      },
    },
    {
      id: 'nonrefundable', title: 'Non-refundable money',
      ask: 'Ask what each non-refundable fee actually pays for, and whether any deposit is truly refundable.',
      test(t) {
        const re = /non-?\s?refundable/i;
        if (!re.test(t)) return null;
        if (/deposit/i.test(t) && /deposit[^.]{0,40}non-?\s?refundable|non-?\s?refundable[^.]{0,40}deposit/i.test(t)) return { severity: 'high', why: 'A "non-refundable deposit" is often not allowed; deposits are normally refundable minus lawful deductions.', match: sentenceWith(t, re) };
        return { severity: 'medium', why: 'Fee you will not get back; make sure the amount is justified and allowed locally.', match: sentenceWith(t, re) };
      },
    },
    {
      id: 'repairs', title: 'Repairs and habitability',
      ask: 'Ask that the landlord remains responsible for structural, plumbing, heating and safety repairs.',
      test(t) {
        const waive = /waive[sd]?[^.]{0,60}(habitab|warranty|repair)|as[- ]is\b/i;
        if (waive.test(t)) return { severity: 'high', why: 'Giving up habitability protections is usually not enforceable, but signing it can discourage you from asserting your rights.', match: sentenceWith(t, waive) };
        const re = /(tenant|resident|lessee)[^.]{0,50}(responsible|shall\s+pay|shall\s+bear|at\s+(?:his|her|their|tenant'?s)\s+own\s+(?:cost|expense))[^.]{0,70}(all|any|every)\b[^.]{0,30}(repair|maintenance|damage)/i;
        return re.test(t) ? { severity: 'medium', why: 'You are made responsible for all repairs, possibly including ones that are the landlord\'s job (heating, plumbing, structure).', match: sentenceWith(t, re) } : null;
      },
    },
    {
      id: 'fees', title: 'One-sided legal fees',
      ask: 'Ask for a "prevailing party" clause so fees go both ways.',
      test(t) {
        const re = /(tenant|resident|lessee)[^.]{0,60}(pay|reimburse|bear|liable\s+for)[^.]{0,60}(attorney|legal|court)[^.]{0,20}(fees?|costs?)/i;
        return re.test(t) && !/prevailing\s+party|either\s+party|both\s+parties/i.test(t) ? { severity: 'medium', why: 'You pay the landlord\'s legal fees but the reverse is not promised.', match: sentenceWith(t, re) } : null;
      },
    },
    {
      id: 'deposit', title: 'Security deposit size',
      ask: 'Ask for the deposit to be at most one month of rent (many places cap it at 1-2 months).',
      test(t, facts) {
        if (!facts.deposit || !facts.rent || !/security\s+deposit/i.test(t)) return null;
        const ratio = facts.deposit.value / facts.rent.value;
        if (ratio > 2) return { severity: 'medium', why: `Deposit is ${ratio.toFixed(1)}x monthly rent. Many places cap deposits at 1-2 months.`, match: sentenceWith(t, /security\s+deposit/i) };
        return null;
      },
      once: true,
    },
  ];

  // ---------- missing protections ----------
  const MISSING = [
    { id: 'deposit-return', title: 'No deposit return deadline', severity: 'medium',
      applies: (txt) => /security\s+deposit/i.test(txt),
      present: (txt) => /(return|refund)[^.]{0,80}within\s+(?:\w+\s*(?:\(\d+\)\s*)?)?(?:\d+\s*)?days?|within\s+(?:\w+\s*(?:\(\d+\)\s*)?)?days?[^.]{0,80}(return|refund)/i.test(txt),
      why: 'The lease takes a deposit but never says when it must be returned. Most places set a legal deadline; ask for it in writing.' },
    { id: 'repair-process', title: 'No repair-request process', severity: 'low',
      applies: () => true,
      present: (txt) => /repair[^.]{0,80}(request|notif|notice|report)|(request|notif|report)[^.]{0,60}repair|maintenance\s+request/i.test(txt),
      why: 'There is no stated way to ask for repairs or a response time. Ask for a written process.' },
    { id: 'move-out', title: 'No move-out / return-of-premises terms', severity: 'low',
      applies: (txt) => /security\s+deposit/i.test(txt),
      present: (txt) => /move-?out|walk-?through|inspection\s+(?:upon|at|before)|normal\s+wear|wear\s+and\s+tear/i.test(txt),
      why: 'Nothing about "normal wear and tear" or a move-out inspection, the usual source of deposit disputes.' },
  ];

  // ---------- analysis ----------
  function analyze(text) {
    const clauses = segment(text);
    const facts = extractFacts(clauses);
    const findings = [];
    for (const c of clauses) {
      for (const r of RULES) {
        const res = r.test(c.text, facts);
        if (res) findings.push({ rule: r.id, title: r.title, clause: c.id, label: c.label, severity: res.severity, why: res.why, excerpt: res.match || c.text.slice(0, 200), ask: r.ask });
      }
    }
    const whole = clauses.map((c) => c.text).join(' ');
    const missing = MISSING.filter((m) => m.applies(whole) && !m.present(whole)).map((m) => ({ rule: m.id, title: m.title, severity: m.severity, why: m.why }));
    findings.sort((a, b) => SEV[b.severity] - SEV[a.severity]);
    const pts = findings.reduce((s, f) => s + SEV[f.severity], 0) + missing.reduce((s, f) => s + SEV[f.severity], 0);
    const level = clauses.length === 0 ? 'none' : pts >= 10 ? 'high' : pts >= 4 ? 'moderate' : 'low';
    return { clauses, facts, findings, missing, level, points: pts };
  }

  // ---------- retrieval (BM25) ----------
  const STOP = new Set('a an the and or of to in on for is are be am was were it this that these those with as at by from my me i we you your our can could would should may might will shall do does did if then than so not no any all about what when how who which there their they them his her its'.split(' '));
  const SYN = {
    deposit: ['security', 'refund', 'refundable', 'return'], pet: ['animal', 'dog', 'cat'], leave: ['terminate', 'termination', 'early', 'break', 'vacate'],
    move: ['vacate', 'terminate'], repair: ['maintenance', 'fix', 'maintain'], guest: ['visitor', 'occupant'], rent: ['payment', 'pay', 'due'],
    evict: ['eviction', 'default', 'terminate'], noise: ['disturb', 'quiet', 'nuisance'], sublet: ['sublease', 'assign'], roommate: ['occupant', 'sublet'],
    late: ['fee', 'penalty', 'grace'], renew: ['renewal', 'extend', 'month-to-month'], enter: ['entry', 'access', 'inspect'], smoke: ['smoking'],
    utility: ['utilities', 'electric', 'water', 'gas', 'internet'], park: ['parking', 'vehicle'], come: ['enter', 'entry', 'access'], visit: ['enter', 'entry', 'access'],
  };
  // make synonyms symmetric: dog -> pet as well as pet -> dog
  Object.keys(SYN).forEach((k) => SYN[k].forEach((v) => { (SYN[v] = SYN[v] || []).includes(k) || SYN[v].push(k); }));
  const stem = (w) => w.replace(/(ing|edly|ed|es|s)$/i, (m, _s, off) => (w.length - m.length >= 3 ? '' : m));
  const tokenize = (s) => (String(s).toLowerCase().match(/[a-z0-9$%][a-z0-9'-]*/g) || []).filter((w) => !STOP.has(w)).map(stem);

  function expand(tokens) {
    const out = new Set(tokens);
    for (const t of tokens) for (const s of SYN[t] || []) out.add(stem(s));
    return [...out];
  }

  function buildIndex(clauses) {
    const docs = clauses.map((c) => tokenize(c.text));
    const df = new Map();
    docs.forEach((d) => new Set(d).forEach((t) => df.set(t, (df.get(t) || 0) + 1)));
    const avg = docs.reduce((s, d) => s + d.length, 0) / (docs.length || 1);
    return { clauses, docs, df, avg, n: docs.length };
  }

  function search(query, index, k = 3) {
    const q = expand(tokenize(query));
    const k1 = 1.5, b = 0.75;
    const scored = index.docs.map((d, i) => {
      const tf = new Map();
      d.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
      let score = 0;
      for (const t of q) {
        const f = tf.get(t);
        if (!f) continue;
        const n = index.df.get(t) || 0;
        const idf = Math.log(1 + (index.n - n + 0.5) / (n + 0.5));
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / (index.avg || 1))));
      }
      return { clause: index.clauses[i], score };
    });
    const ranked = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
    // drop weak tails: keep hits scoring at least half of the best one
    return ranked.filter((s) => s.score >= ranked[0].score * 0.5).slice(0, k);
  }

  function bestSentence(question, text) {
    const q = new Set(expand(tokenize(question)));
    const sents = text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [text];
    // ignore the clause heading ("4. Security Deposit.") when there is a body
    const body = sents.filter((s) => s.trim().split(/\s+/).length > 4);
    const pool = body.length ? body : sents;
    let best = pool[0], bs = -1;
    for (const s of pool) {
      const sc = tokenize(s).filter((t) => q.has(t)).length;
      if (sc > bs) { bs = sc; best = s; }
    }
    return best.trim();
  }

  /* Offline answer: the most relevant clauses, quoted. No generation. */
  function answerOffline(question, index, k = 3) {
    const hits = search(question, index, k);
    if (!hits.length) return { found: false, text: "I couldn't find a clause about that in this lease. If it matters to you, ask the landlord to add it in writing.", hits: [] };
    return { found: true, text: hits.map((h) => `[${h.clause.id}] ${bestSentence(question, h.clause.text)}`).join('\n'), hits };
  }

  const toMarkdown = (a) => {
    const L = ['# LeaseLens report', '', `Overall concern: **${a.level}** (${a.findings.length} flagged clauses, ${a.missing.length} missing protections). Heuristic review, not legal advice.`, ''];
    for (const f of a.findings) L.push(`## [${f.severity.toUpperCase()}] ${f.title} (${f.label})`, `> ${f.excerpt}`, '', f.why, '', `**Ask:** ${f.ask}`, '');
    if (a.missing.length) { L.push('## Missing protections'); a.missing.forEach((m) => L.push(`- **${m.title}**: ${m.why}`)); }
    return L.join('\n');
  };

  return { segment, extractFacts, analyze, buildIndex, search, answerOffline, tokenize, toMarkdown, RULES, SEV };
});
