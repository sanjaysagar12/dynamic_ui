'use client';

import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '../../lib/utils/cn';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export function PopoverContent({
  className,
  sideOffset = 8,
  align = 'end',
  ...props
}: PopoverPrimitive.PopoverContentProps) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(
          'z-50 rounded-lg border border-subtle bg-surface-raised p-2 shadow-floating',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
