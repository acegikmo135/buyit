import { useEffect, useRef } from 'react';

export type MenuItem =
  | { sep: true }
  | { label: string; hint?: string; run: () => void | Promise<void>; hidden?: boolean; accent?: boolean; disabled?: boolean };

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('mousedown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [onClose]);
  const visible = items.filter((i) => !('hidden' in i && i.hidden));
  return (
    <div ref={ref} className="ctx-menu" style={{ left: x, top: y }} role="menu">
      {visible.map((it, i) =>
        'sep' in it ? (
          <div key={i} className="ctx-sep" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={'ctx-item' + (it.accent ? ' accent' : '')}
            disabled={it.disabled}
            onClick={async () => {
              onClose();
              await it.run();
            }}
          >
            <span>{it.label}</span>
            {it.hint && <kbd>{it.hint}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}
