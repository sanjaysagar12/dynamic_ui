'use client';

import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/utils/cn';

const fieldClasses =
  'w-full bg-surface-raised border border-subtle rounded-md px-4 text-[14px] text-primary placeholder:text-tertiary outline-none focus-visible:border-transparent transition-colors';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, invalid, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(fieldClasses, 'h-11', invalid && 'border-negative', className)}
    {...props}
  />
));
Input.displayName = 'Input';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(fieldClasses, 'py-3 resize-none', invalid && 'border-negative', className)}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select ref={ref} className={cn(fieldClasses, 'h-11', className)} {...props} />
  ),
);
Select.displayName = 'Select';
