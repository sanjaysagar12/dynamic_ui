'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils/cn';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

export function DialogContent({
  className,
  children,
  title,
  ...props
}: DialogPrimitive.DialogContentProps & { title: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2',
          'bg-surface-raised border border-subtle rounded-xl p-6 shadow-floating',
          className,
        )}
        {...props}
      >
        <div className="flex items-center justify-between mb-4">
          <DialogPrimitive.Title className="text-h2 text-primary">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Close className="text-secondary hover:text-primary rounded-md p-1">
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex justify-end gap-2 mt-6', className)} {...props} />
);
export const DialogDescription = DialogPrimitive.Description;
export const DialogClose = DialogPrimitive.Close;
