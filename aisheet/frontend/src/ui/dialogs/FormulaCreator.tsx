import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Loader2, Mic, Square, WandSparkles } from 'lucide-react';
import { Button, Chip, Tabs, TextArea } from '@heroui/react';
import { useStore, wb, activeSheet, selectionRange } from '../../store';
import { addr, keyOf } from '../../core/address';
import { currentRegion } from '../../core/tools';
import { displayValue } from '../../core/format';
import { FormulaError } from '../../core/types';
import { shiftFormula } from '../../core/tokens';
import { streamChat } from '../../ai/providers';
import { extractJson } from '../../ai/protocol';
import { providerConfig } from '../../ai/agent';
import { startDictation, stopDictation, cancelDictation, useVoice, type DictationTarget } from '../../voice/dictation';
import { WaveBars } from '../WaveBars';
import { Markdown } from '../Markdown';
import { ModalShell } from '../forms';
import { useT } from '../../i18n';

interface Suggestion {
  formula: string;
  explanation: string;
  fill?: string | null;
  notes?: string | null;
  alternatives?: { formula: string; why: string }[];
}
interface Fix {
  ref: string;
  formula: string;
  why: string;
}

const FN_LIST = 'SUM PRODUCT AVERAGE MIN MAX MEDIAN STDEV VAR COUNT COUNTA COUNTBLANK LARGE SMALL RANK PERCENTILE IF IFS SWITCH CHOOSE IFERROR IFNA AND OR NOT ABS SQRT INT TRUNC POWER MOD ROUND ROUNDUP ROUNDDOWN CEILING FLOOR SUMPRODUCT LEN UPPER LOWER TRIM PROPER LEFT RIGHT MID CONCAT CONCATENATE TEXTJOIN SUBSTITUTE REPLACE FIND SEARCH TEXT VALUE ISBLANK ISNUMBER ISTEXT ISERROR TODAY NOW DATE YEAR MONTH DAY EDATE EOMONTH WEEKDAY DATEDIF DAYS NETWORKDAYS SUMIF COUNTIF AVERAGEIF SUMIFS COUNTIFS AVERAGEIFS MAXIFS MINIFS VLOOKUP HLOOKUP XLOOKUP LOOKUP MATCH INDEX ROWS COLUMNS ROW COLUMN PMT FV PV NPV IRR';

function sheetContext(): string {
  const sh = activeSheet();
  const { active } = useStore.getState();
  const R = currentRegion(wb, sh, active.r, active.c);
  const lines: string[] = [`Active sheet: "${sh.name}". Target cell: ${addr(active.r, active.c)}.`, `Sheets: ${wb.sheets.map((s) => `"${s.name}" (A1:${addr(Math.max(0, wb.usedBounds(s).r), Math.max(0, wb.usedBounds(s).c))})`).join(', ')}`];
  if (wb.names.size) lines.push('Named ranges: ' + [...wb.names].map(([n, r]) => `${n}=${r}`).join(', '));
  lines.push(`Table around the target (${addr(R.r1, R.c1)}:${addr(R.r2, R.c2)}), first rows:`);
  for (let r = R.r1; r <= Math.min(R.r2, R.r1 + 11); r++) {
    const parts: string[] = [];
    for (let c = R.c1; c <= Math.min(R.c2, R.c1 + 24); c++) {
      const cell = sh.cells.get(keyOf(r, c));
      if (!cell || cell.raw === '') continue;
      const v = wb.value(sh, r, c);
      parts.push(`${addr(r, c)}=${typeof cell.raw === 'string' && cell.raw.startsWith('=') ? cell.raw + ' → ' + displayValue(v, undefined) : JSON.stringify(cell.raw)}`);
    }
    if (parts.length) lines.push(parts.join(' | '));
  }
  if (R.r2 > R.r1 + 11) lines.push(`… rows ${R.r1 + 13}-${R.r2 + 1} not shown (same structure).`);
  return lines.join('\n');
}

const SYS = (lang: string) => `You are the formula expert inside AiSheet (an Excel-compatible spreadsheet). Write ONE formula that does exactly what the user asks.
Rules:
- English function names, comma separators, formulas start with "=". Only use these functions: ${FN_LIST}. Named ranges are allowed. No dynamic arrays (UNIQUE/FILTER/SORT/LET/LAMBDA), no INDIRECT/OFFSET, no macros.
- Reference REAL cells/ranges from the context (check headers and columns carefully). Write the formula for the target cell (top-left of a fill). Use $ for fixed references. Wrap lookups that can miss in IFERROR.
- If the user wants the formula for many rows/columns, set "fill" to the range to fill (e.g. "D2:D20"); the formula is auto-adjusted like Excel's fill.
- Return ONLY JSON: {"formula":"=…","explanation":"1-3 short sentences ${lang}","fill":null,"notes":null,"alternatives":[{"formula":"=…","why":"…"}]} (alternatives optional, max 2).`;

export function FormulaCreator({ mode: initialMode, seed, autoVoice }: { mode: 'create' | 'explain' | 'fix'; seed?: string; autoVoice?: boolean }) {
  const t = useT();
  const close = () => {
    cancelDictation();
    useStore.getState().set({ dialog: null });
  };
  const [mode, setMode] = useState<'create' | 'explain' | 'fix'>(initialMode);
  const [text, setText] = useState(seed ?? '');
  const [busy, setBusy] = useState(false);
  const [sugg, setSugg] = useState<Suggestion | null>(null);
  const [explain, setExplain] = useState('');
  const [fixes, setFixes] = useState<Fix[] | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const ctl = useRef<AbortController | null>(null);
  const phase = useVoice((s) => s.phase);
  const aiLang = useStore((s) => s.aiLang);
  const uiLang = useStore((s) => s.lang);
  const target = useRef<DictationTarget>({ read: () => textRef.current, write: (v) => setText(v) });
  const textRef = useRef(text);
  textRef.current = text;
  const wasVoice = useRef(!!autoVoice);
  const langName = aiLang === 'gu' || (aiLang === 'auto' && uiLang === 'gu') ? 'in Gujarati (ગુજરાતી)' : 'in English';
  const active = useStore.getState().active;
  const sh = activeSheet();
  const activeRaw = sh.cells.get(keyOf(active.r, active.c))?.raw;

  // "Speak to formula": start listening right away
  useEffect(() => {
    if (autoVoice) void startDictation(target.current);
    return () => cancelDictation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // …and generate as soon as the dictation finishes
  const prevPhase = useRef(phase);
  useEffect(() => {
    if (prevPhase.current !== 'idle' && phase === 'idle' && wasVoice.current && textRef.current.trim() && mode === 'create') void generate();
    prevPhase.current = phase;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const evalResult = useMemo(() => {
    if (!sugg) return null;
    const v = wb.evalExpr(sh, active.r, active.c, sugg.formula);
    return v instanceof FormulaError ? { err: v.code } : { value: displayValue(v, undefined) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sugg]);

  const callModel = async (system: string, user: string, onDelta?: (d: string) => void) => {
    ctl.current?.abort();
    ctl.current = new AbortController();
    return streamChat(await providerConfig(), system, [{ role: 'user', content: user }], onDelta, ctl.current.signal);
  };

  async function generate(retryNote?: string) {
    const req = textRef.current.trim();
    if (!req) return;
    setBusy(true);
    setError('');
    setSugg(null);
    try {
      const raw = await callModel(SYS(langName), `${sheetContext()}\n\n## Request\n${req}${retryNote ? `\n\n[app] Your previous formula ${retryNote}. Fix it and return JSON again.` : ''}`);
      const j = extractJson(raw) as Suggestion;
      if (!j?.formula) throw new Error(t('fc.noFormula'));
      if (!j.formula.startsWith('=')) j.formula = '=' + j.formula;
      // auto-repair once if the formula errors on the target cell
      const v = wb.evalExpr(sh, active.r, active.c, j.formula);
      if (v instanceof FormulaError && !retryNote) return void (await generate(`evaluates to ${v.code} at ${addr(active.r, active.c)}: ${j.formula}`));
      setSugg(j);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runExplain() {
    const f = text.trim() || (typeof activeRaw === 'string' ? activeRaw : '');
    if (!f) return;
    setBusy(true);
    setError('');
    setExplain('');
    try {
      let acc = '';
      await callModel(`You explain spreadsheet formulas clearly to non-experts. Answer ${langName}. Use short Markdown: one sentence summary, then a numbered step-by-step breakdown of each part, then (if relevant) a tip or a common pitfall. Do not output JSON.`, `${sheetContext()}\n\nExplain this formula (cell ${addr(active.r, active.c)}):\n${f}`, (d) => {
        acc += d;
        setExplain(acc);
      });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runFix() {
    setBusy(true);
    setError('');
    setFixes(null);
    try {
      const R = selectionRange();
      const multi = R.r1 !== R.r2 || R.c1 !== R.c2;
      const bad: string[] = [];
      for (const [k, cell] of sh.cells) {
        const r = Math.floor(k / 65536);
        const c = k % 65536;
        if (multi && (r < R.r1 || r > R.r2 || c < R.c1 || c > R.c2)) continue;
        if (typeof cell.raw !== 'string' || !cell.raw.startsWith('=')) continue;
        const v = wb.value(sh, r, c);
        if (v instanceof FormulaError) bad.push(`${addr(r, c)}: ${cell.raw} → ${v.code}`);
        if (bad.length >= 25) break;
      }
      if (!bad.length) {
        setError(t('fc.noErrors'));
        return;
      }
      const raw = await callModel(`You repair broken spreadsheet formulas. Only use these functions: ${FN_LIST}. Return ONLY JSON: {"fixes":[{"ref":"C5","formula":"=…","why":"short reason ${langName}"}]}. Fix the root cause (wrong range, missing IFERROR, text vs number, wrong sheet name, circular reference, divide by zero). Keep the intent of the original formula.`, `${sheetContext()}\n\nBroken cells:\n${bad.join('\n')}`);
      const j = extractJson(raw) as { fixes?: Fix[] };
      setFixes((j.fixes ?? []).filter((f) => f.ref && f.formula));
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const insert = (fill: boolean) => {
    if (!sugg) return;
    const label = `AI formula ${addr(active.r, active.c)}`;
    wb.run(label, 'ai', () => {
      wb.setInput(sh, active.r, active.c, sugg.formula, label, 'ai');
      if (fill && sugg.fill) {
        const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i.exec(sugg.fill.replace(/\$/g, ''));
        if (m) {
          const toCol = (n: string) => n.toUpperCase().split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
          const [c1, r1, c2, r2] = [toCol(m[1]), +m[2] - 1, toCol(m[3]), +m[4] - 1];
          for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== active.r || c !== active.c) wb.setInput(sh, r, c, shiftFormula(sugg.formula, r - active.r, c - active.c), label, 'ai');
        }
      }
    });
    useStore.getState().showToast(t('fc.inserted'));
    close();
  };

  const applyFixes = () => {
    if (!fixes) return;
    wb.run('AI fix formulas', 'ai', () => {
      for (const f of fixes) {
        const m = /^([A-Z]+)(\d+)$/i.exec(f.ref);
        if (!m) continue;
        const c = m[1].toUpperCase().split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
        wb.setInput(sh, +m[2] - 1, c, f.formula.startsWith('=') ? f.formula : '=' + f.formula, 'AI fix formulas', 'ai');
      }
    });
    useStore.getState().showToast(t('fc.fixed', { n: fixes.length }));
    close();
  };

  const listening = phase === 'listening';
  const dictating = phase !== 'idle';

  return (
    <ModalShell title={t('fc.title')} onClose={close} width="sm:max-w-[680px]">
      <Tabs selectedKey={mode} onSelectionChange={(k) => { setMode(k as typeof mode); setError(''); }}>
        <Tabs.ListContainer>
          <Tabs.List aria-label="Formula assistant">
            {(['create', 'explain', 'fix'] as const).map((k) => <Tabs.Tab key={k} id={k}>{t('fc.mode.' + k)}<Tabs.Indicator /></Tabs.Tab>)}
          </Tabs.List>
        </Tabs.ListContainer>
      </Tabs>

      {mode === 'create' && (
        <>
          <div className="relative">
            <TextArea
              aria-label={t('fc.describe')}
              rows={3}
              autoFocus={!autoVoice}
              value={text}
              placeholder={listening ? t('voice.speakNow') : t('fc.placeholder')}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void generate(); } }}
              className="w-full pr-12 select-text"
            />
            <Button isIconOnly size="sm" variant={listening ? 'danger' : 'ghost'} className={'absolute top-2 right-2 rounded-full ' + (listening ? 'animate-pulse' : '')} aria-label={t('voice.start')} isDisabled={phase === 'connecting' || phase === 'finishing'} onPress={() => { wasVoice.current = true; if (phase === 'idle') void startDictation(target.current); else void stopDictation(target.current); }}>
              {listening ? <Square size={13} fill="currentColor" /> : <Mic size={16} />}
            </Button>
          </div>
          {dictating && <div className="text-muted flex items-center gap-3 text-xs"><WaveBars active={listening} width={150} height={24} /> {phase === 'connecting' ? t('voice.connecting') : phase === 'finishing' ? t('voice.polishing') : t('fc.listening')}</div>}
          <div className="text-muted flex flex-wrap items-center gap-2 text-xs">
            <Chip size="sm" variant="soft">{t('fc.target')}: {addr(active.r, active.c)}</Chip>
            <span>{t('fc.hint')}</span>
          </div>
          {error && <div className="text-danger text-sm">{error}</div>}
          {busy && <div className="text-muted flex items-center gap-2 text-sm"><Loader2 size={15} className="animate-spin" /><span className="shimmer-text">{t('fc.thinking')}</span></div>}
          {sugg && (
            <div className="bg-surface-secondary flex flex-col gap-3 rounded-xl border p-4">
              <div className="flex items-start gap-2">
                <code className="bg-surface min-w-0 flex-1 rounded-lg border px-3 py-2 font-mono text-[13px] break-all select-text">{sugg.formula}</code>
                <Button isIconOnly size="sm" variant="ghost" aria-label="Copy" onPress={() => { void navigator.clipboard?.writeText(sugg.formula); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>{copied ? <Check size={15} /> : <Copy size={15} />}</Button>
              </div>
              {evalResult && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted">{t('fc.result')}</span>
                  {'err' in evalResult ? <Chip color="danger" variant="soft" size="sm">{evalResult.err}</Chip> : <Chip color="success" variant="soft" size="sm"><b>{evalResult.value === '' ? t('fc.empty') : evalResult.value}</b></Chip>}
                </div>
              )}
              <Markdown text={sugg.explanation} />
              {sugg.notes && <p className="text-muted text-xs">{sugg.notes}</p>}
              {sugg.alternatives?.slice(0, 2).map((a, i) => (
                <button key={i} type="button" className="hover:bg-surface rounded-lg border border-dashed px-3 py-2 text-left" onClick={() => setSugg({ ...sugg, formula: a.formula, explanation: a.why, alternatives: [] })}>
                  <code className="font-mono text-xs break-all">{a.formula}</code>
                  <div className="text-muted mt-0.5 text-xs">{a.why}</div>
                </button>
              ))}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onPress={() => void generate()}><WandSparkles size={14} />{t('fc.again')}</Button>
                {sugg.fill && <Button variant="tertiary" onPress={() => insert(true)}>{t('fc.insertFill', { range: sugg.fill })}</Button>}
                <Button variant="primary" onPress={() => insert(false)}><Check size={14} />{t('fc.insert')}</Button>
              </div>
            </div>
          )}
          {!sugg && <div className="flex justify-end"><Button variant="primary" isDisabled={!text.trim() || busy || dictating} onPress={() => void generate()}><WandSparkles size={15} />{t('fc.generate')}<span className="text-accent-foreground/70 ml-1 text-[11px]">Ctrl+Enter</span></Button></div>}
        </>
      )}

      {mode === 'explain' && (
        <>
          <TextArea aria-label={t('fc.formula')} rows={3} value={text || (typeof activeRaw === 'string' && activeRaw.startsWith('=') ? activeRaw : '')} onChange={(e) => setText(e.target.value)} placeholder={t('fc.explainPh')} className="w-full font-mono text-[13px] select-text" />
          {error && <div className="text-danger text-sm">{error}</div>}
          {explain && <div className="bg-surface-secondary rounded-xl border p-4"><Markdown text={explain} streaming={busy} /></div>}
          <div className="flex justify-end"><Button variant="primary" isDisabled={busy} onPress={() => void runExplain()}>{busy ? <Loader2 size={15} className="animate-spin" /> : <WandSparkles size={15} />}{t('fc.explainBtn')}</Button></div>
        </>
      )}

      {mode === 'fix' && (
        <>
          <p className="text-muted text-sm">{t('fc.fixHint')}</p>
          {error && <div className="text-danger text-sm">{error}</div>}
          {fixes && (
            <div className="flex flex-col gap-2">
              {!fixes.length && <div className="text-muted text-sm">{t('fc.noFixes')}</div>}
              {fixes.map((f) => (
                <div key={f.ref} className="bg-surface-secondary rounded-lg border p-3">
                  <div className="flex items-center gap-2"><Chip size="sm" variant="soft">{f.ref}</Chip><code className="font-mono text-xs break-all select-text">{f.formula}</code></div>
                  <div className="text-muted mt-1 text-xs">{f.why}</div>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2">
            {fixes && fixes.length > 0 && <Button variant="primary" onPress={applyFixes}><Check size={14} />{t('fc.applyFixes', { n: fixes.length })}</Button>}
            <Button variant={fixes?.length ? 'tertiary' : 'primary'} isDisabled={busy} onPress={() => void runFix()}>{busy ? <Loader2 size={15} className="animate-spin" /> : <WandSparkles size={15} />}{t('fc.scan')}</Button>
          </div>
        </>
      )}
    </ModalShell>
  );
}
