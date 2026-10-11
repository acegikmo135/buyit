import { useEffect, useRef } from 'react';
import { Check, CircleAlert, Copy, Download, FolderOpen, HardDrive, Pause, Play, Trash2, Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useStore } from '../store';
import { useModels } from '../voice/models';
import { nativeAvailable } from '../voice/native';
import { useT } from '../i18n';

const mb = (b: number) => (b / 1048576).toFixed(b > 1e8 ? 0 : 1);

export function ModelManager() {
  const t = useT();
  const { models, progress, logs, dir, init, download, cancel, remove, clearLogs } = useModels();
  const active = useStore((s) => s.voice.model);
  const voice = useStore((s) => s.voice);
  const set = useStore((s) => s.set);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void init();
  }, [init]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [logs.length]);

  if (!nativeAvailable())
    return (
      <div className="text-muted-foreground flex items-start gap-3 rounded-lg border border-dashed p-4 text-sm">
        <CircleAlert className="mt-0.5 size-4 shrink-0" />
        <span>{t('voice.desktopOnly')}</span>
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {models.map((m) => {
          const p = progress[m.id];
          const downloading = p?.status === 'downloading';
          const total = p?.total || m.size_mb * 1048576;
          const pct = downloading ? Math.min(100, ((p?.downloaded ?? 0) / total) * 100) : m.partial_bytes ? Math.min(100, (m.partial_bytes / (m.size_mb * 1048576)) * 100) : 0;
          const left = downloading && p!.bps > 0 ? Math.max(0, (total - p!.downloaded) / p!.bps) : 0;
          const selected = active === m.id;
          return (
            <div key={m.id} className={cn('rounded-xl border p-3 transition-colors', selected && m.installed && 'border-primary bg-primary/5')}>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={!m.installed}
                  onClick={() => set({ voice: { ...voice, model: m.id } })}
                  className={cn('flex size-5 shrink-0 items-center justify-center rounded-full border', selected && m.installed ? 'border-primary bg-primary text-primary-foreground' : 'border-input', !m.installed && 'opacity-40')}
                  aria-label={t('voice.useModel', { name: m.label })}
                >
                  {selected && m.installed && <Check className="size-3" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{m.label}</span>
                    <span className="text-muted-foreground text-xs">{m.size_mb} MB</span>
                    {m.installed && <Badge variant="success"><HardDrive className="size-3" />{t('voice.installed')}</Badge>}
                    {m.loaded && <Badge variant="secondary"><Cpu className="size-3" />{t('voice.inRam')}</Badge>}
                    {m.id === 'small' && <Badge variant="outline">{t('voice.recommended')}</Badge>}
                  </div>
                  <div className="text-muted-foreground text-xs">{m.note}</div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {downloading ? (
                    <Button size="sm" variant="outline" onClick={() => void cancel(m.id)}><Pause />{t('voice.pause')}</Button>
                  ) : m.installed ? (
                    <Button size="sm" variant="ghost" onClick={() => void remove(m.id)} aria-label={t('voice.delete')}><Trash2 /></Button>
                  ) : (
                    <Button size="sm" onClick={() => void download(m.id)}>{m.partial_bytes ? <Play /> : <Download />}{m.partial_bytes ? t('voice.resume') : t('voice.download')}</Button>
                  )}
                </div>
              </div>
              {(downloading || (!m.installed && m.partial_bytes > 0)) && (
                <div className="mt-3 flex flex-col gap-1.5">
                  <Progress value={pct} />
                  <div className="text-muted-foreground flex justify-between font-mono text-[11px] tabular-nums">
                    <span>{mb(downloading ? p!.downloaded : m.partial_bytes)} / {mb(total)} MB · {pct.toFixed(0)}%</span>
                    <span>{downloading ? `${mb(p!.bps)} MB/s${left ? ` · ${Math.ceil(left)}s` : ''}` : t('voice.paused')}</span>
                  </div>
                </div>
              )}
              {p?.status === 'error' && !downloading && <div className="text-destructive mt-2 text-xs">{t('voice.downloadFailed')}</div>}
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{t('voice.log')}</span>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard?.writeText(logs.map((l) => `${new Date(l.t).toLocaleTimeString()} ${l.text}`).join('\n'))}><Copy />{t('voice.copyLog')}</Button>
            <Button size="sm" variant="ghost" onClick={clearLogs}>{t('voice.clear')}</Button>
          </div>
        </div>
        <ScrollArea className="bg-muted/50 h-40 rounded-lg border">
          <div className="p-2.5 font-mono text-[11px] leading-5 select-text">
            {logs.length === 0 && <span className="text-muted-foreground">{t('voice.logEmpty')}</span>}
            {logs.map((l, i) => (
              <div key={i} className={cn('break-all', l.level === 'error' && 'text-destructive', l.level === 'ok' && 'text-emerald-600 dark:text-emerald-400')}>
                <span className="text-muted-foreground">{new Date(l.t).toLocaleTimeString([], { hour12: false })} </span>
                {l.text}
              </div>
            ))}
            <div ref={endRef} />
          </div>
        </ScrollArea>
        {dir && (
          <div className="text-muted-foreground flex items-center gap-1.5 text-[11px] select-text">
            <FolderOpen className="size-3.5 shrink-0" /> <span className="break-all">{dir}</span>
          </div>
        )}
      </div>
      <p className="text-muted-foreground text-xs">{t('voice.ramNote')}</p>
    </div>
  );
}
