import { Mic, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useVoice, toggleDictation } from '../voice/dictation';
import { useT } from '../i18n';
import { cn } from '@/lib/utils';

export function MicButton({ onText }: { onText: (t: string) => void }) {
  const t = useT();
  const phase = useVoice((s) => s.phase);
  const rec = phase === 'recording';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant={rec ? 'destructive' : 'ghost'}
          className={cn('size-8 shrink-0', rec && 'animate-pulse')}
          disabled={phase === 'finalizing'}
          aria-label={t('voice.start')}
          onClick={() => toggleDictation(onText)}
        >
          {rec ? <Square className="size-3.5 fill-current" /> : <Mic />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{(rec ? t('voice.stop') : t('voice.start')) + ' · Ctrl+Shift+Space'}</TooltipContent>
    </Tooltip>
  );
}
