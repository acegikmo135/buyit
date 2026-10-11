import { Button, Dropdown, Separator } from '@heroui/react';

export type MenuItem =
  | { sep: true }
  | { label: string; hint?: string; run: () => void | Promise<void>; hidden?: boolean; accent?: boolean; disabled?: boolean };

/** Right-click menu: a HeroUI Dropdown anchored to an invisible button placed at the pointer. */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const visible = items.filter((i) => !('hidden' in i && i.hidden));
  const actions = new Map<string, MenuItem>();
  visible.forEach((it, i) => 'run' in it && actions.set(String(i), it));
  return (
    <Dropdown isOpen onOpenChange={(o) => !o && onClose()}>
      <Button aria-hidden className="pointer-events-none absolute size-px min-w-0 opacity-0" style={{ left: x, top: y }} />
      <Dropdown.Popover placement="bottom start" className="min-w-56">
        <Dropdown.Menu
          onAction={(k) => {
            const it = actions.get(String(k));
            if (it && 'run' in it) void it.run();
          }}
        >
          {visible.map((it, i) =>
            'sep' in it ? (
              <Separator key={i} />
            ) : (
              <Dropdown.Item key={i} id={String(i)} textValue={it.label} isDisabled={it.disabled} className={it.accent ? 'text-ai' : undefined}>
                <span className="flex w-full items-center justify-between gap-6">
                  <span>{it.label}</span>
                  {it.hint && <span className="text-muted text-xs">{it.hint}</span>}
                </span>
              </Dropdown.Item>
            ),
          )}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
