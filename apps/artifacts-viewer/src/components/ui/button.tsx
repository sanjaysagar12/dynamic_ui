'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold text-sm disabled:pointer-events-none disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed',
  {
    variants: {
      variant: {
        primary: 'bg-accent-500 text-on-accent hover:bg-accent-600',
        secondary: 'bg-surface-raised text-primary border border-subtle hover:bg-surface-hover',
        outlined: 'bg-transparent text-secondary border border-subtle hover:text-primary hover:bg-surface-raised',
        ghost: 'bg-transparent text-secondary hover:text-primary hover:bg-surface-raised',
        icon: 'bg-surface-raised text-secondary border border-subtle hover:text-primary hover:bg-surface-hover',
        danger: 'bg-transparent text-negative border border-subtle hover:bg-negative-soft',
      },
      size: {
        default: 'h-11 rounded-full px-5',
        compact: 'h-9 rounded-full px-4 text-[13px]',
        icon: 'h-10 w-10 rounded-full p-0',
        'icon-sm': 'h-8 w-8 rounded-md p-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, loading, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : children}
      </Comp>
    );
  },
);
Button.displayName = 'Button';
