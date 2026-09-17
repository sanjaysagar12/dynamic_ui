'use client';

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { cn } from '../../lib/utils/cn';

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  align = 'end',
  ...props
}: DropdownMenuPrimitive.DropdownMenuContentProps) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(
          'z-50 min-w-[180px] rounded-lg border border-subtle bg-surface-raised p-1 shadow-floating',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  destructive,
  ...props
}: DropdownMenuPrimitive.DropdownMenuItemProps & { destructive?: boolean }) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        'flex items-center gap-2 rounded-md px-3 h-9 text-[13px] font-medium text-secondary outline-none cursor-pointer select-none',
        'hover:bg-surface-hover hover:text-primary data-[highlighted]:bg-surface-hover data-[highlighted]:text-primary',
        destructive && 'text-negative hover:text-negative data-[highlighted]:text-negative',
        className,
      )}
      {...props}
    />
  );
}

export const DropdownMenuSeparator = ({ className, ...props }: DropdownMenuPrimitive.DropdownMenuSeparatorProps) => (
  <DropdownMenuPrimitive.Separator className={cn('my-1 h-px bg-[var(--border-subtle)]', className)} {...props} />
);
