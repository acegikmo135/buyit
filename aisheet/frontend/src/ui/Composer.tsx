import { useEffect, useRef } from 'react';
import { ArrowUp, Mic, Square, Lock, ShieldCheck, Zap, ChevronDown, Check, BoxSelect } from 'lucide-react';
import { Button, Dropdown, Tooltip, TextArea, Kbd } from '@heroui/react';
import { useStore, selectionRange } from '../store';
import { addr } from '../core/address';
import { sendPrompt, cancelPrompt } from '../ai/agent';
import { useVoice, startDictation, stopDictation, type DictationTarget } from '../voice/dictation';
import { WaveBars } from './WaveBars';
import { useT } from '../i18n';
import { focusGrid } from '../grid/GridCanvas';

export const composerTarget: DictationTarget = {
  read: () => useStore.getState().draft,
  write: (t) => useStore.getState().set({ draft: t }),
};

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function Composer() {
  const t = useT();
  const draft = useStore((s) => s.draft);
  const busy = useStore((s) => s.busy);
  const perms = useStore((s) => s.permissions);
  const anchor = useStore((s) => s.anchor);
  const active = useStore((s) => s.active);
  const voiceLang = useStore((s) => s.voice.lang);
  const set = useStore((s) => s.set);
  const { phase, seconds } = useVoice();
  const ta = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const listening = phase === 'listening';

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(Math.round(window.innerHeight * 0.4), el.scrollHeight) + 'px';
    if (phase !== 'idle') el.scrollTop = el.scrollHeight;
  }, [draft, phase]);

  const send = () => {
    const v = draft.trim();
    if (!v || busy || phase !== 'idle') return;
    set({ draft: '' });
    void sendPrompt(v);
  };

  const modeIcon = perms.mode === 'readonly' ? <Lock size={14} /> : perms.mode === 'ask' ? <ShieldCheck size={14} /> : <Zap size={14} />;

  const R = selectionRange();
  const selLabel = R.r1 === R.r2 && R.c1 === R.c2 ? addr(R.r1, R.c1) : `${addr(R.r1, R.c1)}:${addr(R.r2, R.c2)}`;
  void anchor; void active;
  const selOnly = perms.selectionOnly;

  return (
    <div className="px-3 pt-1.5 pb-2">
      <div
        className={
          'bg-surface relative rounded-3xl border shadow-sm transition-all ' +
          (listening ? 'border-accent ring-accent/20 ring-4' : 'border-border focus-within:border-accent/60 focus-within:ring-accent/10 focus-within:ring-4')
        }
      >
        <div className="flex items-center gap-1.5 px-3 pt-2">
          <Tooltip delay={300}>
            <button
              type="button"
              aria-pressed={selOnly}
              onClick={() => set({ permissions: { ...useStore.getState().permissions, selectionOnly: !selOnly } })}
              className={'flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors ' + (selOnly ? 'border-accent/50 bg-accent/10 text-accent font-medium' : 'text-muted hover:bg-surface-secondary')}
            >
              <BoxSelect size={13} />
              {selOnly ? t('ai.selOnlyOn', { range: selLabel }) : t('ai.selOnly')}
            </button>
            <Tooltip.Content>{t('ai.selOnlyHint')}</Tooltip.Content>
          </Tooltip>
        </div>
        <TextArea
          ref={ta}
          rows={1}
          aria-label={t('ai.placeholder')}
          value={draft}
          placeholder={listening ? t('voice.speakNow') : t('ai.placeholder')}
          onChange={(e) => set({ draft: e.target.value })}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={() => (composing.current = false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !composing.current && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            } else if (e.key === 'Escape') focusGrid();
          }}
          className="composer-ta max-h-[40vh] min-h-[64px] w-full resize-none rounded-3xl px-4 pt-2 pb-1 text-[14px] leading-6"
        />
        <div className="flex items-center gap-1.5 px-2.5 pb-2.5">
          {/* mic + language */}
          <Tooltip delay={300}>
            <Button
              isIconOnly
              size="sm"
              variant={listening ? 'danger' : 'ghost'}
              className={'rounded-full ' + (listening ? 'animate-pulse' : '')}
              isDisabled={phase === 'connecting' || phase === 'finishing'}
              aria-label={t('voice.start')}
              onPress={() => (phase === 'idle' ? void startDictation(composerTarget) : void stopDictation(composerTarget))}
            >
              {listening ? <Square size={13} fill="currentColor" /> : <Mic size={17} />}
            </Button>
            <Tooltip.Content>
              <div className="flex items-center gap-2">{listening ? t('voice.stop') : t('voice.start')}<Kbd>Ctrl+Shift+Space</Kbd></div>
            </Tooltip.Content>
          </Tooltip>

          {phase === 'idle' ? (
            <Dropdown>
              <Button size="sm" variant="ghost" className="text-muted h-8 gap-1 rounded-full px-2.5 text-xs">
                {voiceLang === 'gu' ? 'ગુજરાતી' : 'English'}
                <ChevronDown size={12} />
              </Button>
              <Dropdown.Popover className="min-w-36">
                <Dropdown.Menu onAction={(k) => set({ voice: { ...useStore.getState().voice, lang: k as 'en' | 'gu' } })}>
                  <Dropdown.Item id="en" textValue="English">English {voiceLang === 'en' && <Check size={14} className="ml-auto" />}</Dropdown.Item>
                  <Dropdown.Item id="gu" textValue="ગુજરાતી">ગુજરાતી {voiceLang === 'gu' && <Check size={14} className="ml-auto" />}</Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          ) : (
            <div className="text-muted flex items-center gap-2 pl-1 text-xs">
              <WaveBars active={listening} />
              <span className="font-mono tabular-nums">{phase === 'connecting' ? t('voice.connecting') : phase === 'finishing' ? t('voice.polishing') : fmt(seconds)}</span>
            </div>
          )}

          <div className="flex-1" />

          <Dropdown>
            <Button size="sm" variant="ghost" className="text-muted h-8 gap-1.5 rounded-full px-2.5 text-xs" aria-label={t('perm.title')}>
              {modeIcon}
              <span className="hidden sm:inline">{t('perm.' + perms.mode)}</span>
            </Button>
            <Dropdown.Popover className="min-w-52">
              <Dropdown.Menu onAction={(k) => set({ permissions: { ...useStore.getState().permissions, mode: k as typeof perms.mode } })}>
                {(['ask', 'auto', 'readonly'] as const).map((m) => (
                  <Dropdown.Item key={m} id={m} textValue={t('perm.' + m)}>
                    <div className="flex flex-col">
                      <span className="flex items-center gap-2">{t('perm.' + m)} {perms.mode === m && <Check size={14} />}</span>
                      <span className="text-muted text-xs">{t('perm.short.' + m)}</span>
                    </div>
                  </Dropdown.Item>
                ))}
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>

          {busy ? (
            <Button isIconOnly size="sm" variant="primary" className="rounded-full" onPress={cancelPrompt} aria-label={t('ai.stop')}>
              <Square size={12} fill="currentColor" />
            </Button>
          ) : (
            <Button isIconOnly size="sm" variant="primary" className="rounded-full" isDisabled={!draft.trim() || phase !== 'idle'} onPress={send} aria-label={t('ai.send')}>
              <ArrowUp size={17} />
            </Button>
          )}
        </div>
      </div>
      <p className="text-muted mt-2 text-center text-[11px]">{t('ai.disclaimer')}</p>
    </div>
  );
}
