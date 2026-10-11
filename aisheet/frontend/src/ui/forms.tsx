import { Select, ListBox, Modal, Button } from '@heroui/react';
import type { ReactNode } from 'react';

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-sm font-medium">{label}</div>
      {children}
      {hint && <div className="text-muted text-xs leading-5">{hint}</div>}
    </div>
  );
}

export function Pick<T extends string>({ value, onChange, options, label, width = 'w-full', disabled }: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string; width?: string; disabled?: boolean }) {
  return (
    <Select aria-label={label} selectedKey={value} onSelectionChange={(k) => onChange(k as T)} className={width} isDisabled={disabled}>
      <Select.Trigger className="h-9 text-sm"><Select.Value /><Select.Indicator /></Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map(([k, l]) => (
            <ListBox.Item key={k} id={k} textValue={l}>{l}<ListBox.ItemIndicator /></ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

export function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-2.5">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        {hint && <div className="text-muted mt-0.5 text-xs leading-5">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function ModalShell({ title, onClose, children, footer, width = 'sm:max-w-[560px]' }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: string }) {
  return (
    <Modal.Backdrop isOpen onOpenChange={(o) => !o && onClose()}>
      <Modal.Container size="lg">
        <Modal.Dialog className={`flex max-h-[88vh] flex-col ${width}`} aria-label={title}>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading className="text-lg font-semibold tracking-tight">{title}</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="flex min-h-0 flex-col gap-4 overflow-y-auto p-1">{children}</Modal.Body>
          {footer && <Modal.Footer className="flex justify-end gap-2">{footer}</Modal.Footer>}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

export function Footer({ onClose, onOk, okLabel, cancelLabel, okDisabled, extra }: { onClose: () => void; onOk: () => void; okLabel: string; cancelLabel: string; okDisabled?: boolean; extra?: ReactNode }) {
  return (
    <>
      {extra}
      <div className="flex-1" />
      <Button variant="ghost" onPress={onClose}>{cancelLabel}</Button>
      <Button variant="primary" onPress={onOk} isDisabled={okDisabled}>{okLabel}</Button>
    </>
  );
}
