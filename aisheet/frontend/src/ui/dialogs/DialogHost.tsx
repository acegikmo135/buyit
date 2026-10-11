import { useStore } from '../../store';
import { ChartDialog } from './ChartDialog';
import { CFDialog, DVDialog } from './RulesDialogs';
import { PivotDialog } from './PivotDialog';
import { CommentDialog, DedupeDialog, NamesDialog, PageDialog, TextColsDialog } from './MiscDialogs';
import { FormulaCreator } from './FormulaCreator';

export function DialogHost() {
  const d = useStore((s) => s.dialog);
  if (!d) return null;
  switch (d.kind) {
    case 'chart': return <ChartDialog key={d.id ?? 'new'} id={d.id} />;
    case 'cf': return <CFDialog />;
    case 'dv': return <DVDialog />;
    case 'pivot': return <PivotDialog />;
    case 'comment': return <CommentDialog r={d.r} c={d.c} />;
    case 'names': return <NamesDialog />;
    case 'textcols': return <TextColsDialog />;
    case 'dedupe': return <DedupeDialog />;
    case 'page': return <PageDialog />;
    case 'formula': return <FormulaCreator mode={d.mode ?? 'create'} seed={d.seed} autoVoice={d.autoVoice} />;
    default: return null;
  }
}
