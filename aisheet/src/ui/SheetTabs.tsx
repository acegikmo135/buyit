import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useStore, useWbVersion, wb } from '../store';
import * as A from '../actions';
import { useT } from '../i18n';
import { focusGrid } from '../grid/GridCanvas';
import { confirmDialog } from '../platform';

export function SheetTabs() {
  const t = useT();
  useWbVersion();
  const activeId = useStore((s) => s.activeSheetId);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  return (
    <div className="sheet-tabs">
      <div className="tabs-scroll">
        {wb.sheets.map((s) => (
          <div key={s.id} className={'tab' + (s.id === activeId ? ' on' : '')} onClick={() => { A.switchSheet(s.id); focusGrid(); }} onDoubleClick={() => { setRenaming(s.id); setDraft(s.name); }}>
            {renaming === s.id ? (
              <input
                autoFocus
                className="tab-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => {
                  if (draft.trim() && draft !== s.name && !wb.renameSheet(s, draft)) useStore.getState().showToast(t('tabs.nameTaken'));
                  setRenaming(null);
                  focusGrid();
                }}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') {
                    setDraft(s.name);
                    setRenaming(null);
                  }
                }}
              />
            ) : (
              <span>{s.name}</span>
            )}
            {s.id === activeId && wb.sheets.length > 1 && renaming !== s.id && (
              <button
                className="tab-x"
                title={t('tabs.delete')}
                onClick={async (e) => {
                  e.stopPropagation();
                  if (await confirmDialog(t('tabs.deleteConfirm', { name: s.name }))) {
                    wb.deleteSheet(s);
                    A.ensureActiveSheet();
                  }
                }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}
      </div>
      <button className="tab-add" title={t('tabs.add')} onClick={() => { A.addSheet(); focusGrid(); }}>
        <Plus size={16} />
      </button>
    </div>
  );
}
