import { Tooltip } from '@heroui/react';
import type { ReactNode } from 'react';

export function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip delay={350} closeDelay={0}>
      {children}
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  );
}
