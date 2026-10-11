import { useEffect, useRef } from 'react';
import { Check, Loader2, Mic, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useVoice, stopDictation, cancelDictation } from '../voice/dictation';
import { waveLevels, WAVE_BARS } from '../voice/audio';
import { useT } from '../i18n';

/** Animated bars driven by live microphone level. Draws on a canvas every frame — no React re-renders. */
function Wave({ active }: { active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const W = 168;
    const H = 40;
    c.width = W * dpr;
    c.height = H * dpr;
    let raf = 0;
    let phase = 0;
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const cs = getComputedStyle(c);
      const color = cs.getPropertyValue('--ai').trim() || '#10b981';
      const gap = W / WAVE_BARS;
      phase += 0.06;
      for (let i = 0; i < WAVE_BARS; i++) {
        const lvl = active ? waveLevels[i] : 0.05 + 0.04 * Math.sin(phase + i * 0.4);
        const h = Math.max(3, lvl * (H - 4));
        const x = i * gap + gap / 2;
        ctx.globalAlpha = 0.35 + 0.65 * (i / WAVE_BARS);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(x - 1.1, (H - h) / 2, 2.2, h, 1.2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return <canvas ref={ref} style={{ width: 168, height: 40 }} aria-hidden />;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function VoicePill() {
  const t = useT();
  const { phase, engine, live, seconds, status } = useVoice();
  const liveRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (liveRef.current) liveRef.current.scrollTop = liveRef.current.scrollHeight;
  }, [live]);
  if (phase === 'idle') return null;
  const recording = phase === 'recording';
  const words = live.split(/\s+/).filter(Boolean);
  const head = words.slice(0, -3).join(' ');
  const tail = words.slice(-3).join(' ');
  return (
    <div className="fixed bottom-14 left-1/2 z-40 w-[min(640px,calc(100vw-32px))] -translate-x-1/2 animate-in fade-in slide-in-from-bottom-2" role="status" aria-live="polite">
      <div className="bg-card text-card-foreground flex flex-col gap-2 rounded-2xl border p-3 shadow-xl">
        <div className="flex items-center gap-3">
          <div className={'flex size-9 shrink-0 items-center justify-center rounded-full ' + (recording ? 'bg-destructive/15 text-destructive' : 'bg-primary/15 text-primary')}>
            {recording ? <Mic className="size-4 animate-pulse" /> : <Loader2 className="size-4 animate-spin" />}
          </div>
          <Wave active={recording} />
          <div className="ml-auto flex items-center gap-2">
            <span className="text-muted-foreground font-mono text-xs tabular-nums">{fmt(seconds)}</span>
            <Badge variant="secondary">{engine === 'native' ? t('voice.badge.native') : engine === 'cloud' ? t('voice.badge.cloud') : t('voice.badge.browser')}</Badge>
            <Button size="sm" variant="ghost" onClick={cancelDictation} aria-label={t('voice.cancel')}>
              <X /> {t('voice.cancel')}
            </Button>
            {recording && (
              <Button size="sm" onClick={() => void stopDictation()}>
                <Check /> {t('voice.done')}
              </Button>
            )}
          </div>
        </div>
        <div ref={liveRef} className="bg-muted/60 max-h-24 min-h-10 overflow-y-auto rounded-lg px-3 py-2 text-sm leading-relaxed select-text">
          {!recording ? (
            <span className="text-muted-foreground">{status}</span>
          ) : words.length === 0 ? (
            <span className="text-muted-foreground">{engine === 'cloud' ? t('voice.cloudHint') : t('voice.speakNow')}</span>
          ) : (
            <>
              <span>{head} </span>
              <span className="text-primary font-medium">{tail}</span>
              <span className="bg-primary ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 animate-pulse" />
            </>
          )}
        </div>
        <div className="text-muted-foreground flex justify-between px-1 text-[11px]">
          <span>{t('voice.keys')}</span>
        </div>
      </div>
    </div>
  );
}
