import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap',
  {
    variants: {
      variant: {
        neutral: 'bg-surface-raised text-secondary border border-subtle',
        accent: 'bg-accent-soft text-accent-400',
        positive: 'bg-positive-soft text-positive',
        negative: 'bg-negative-soft text-negative',
        warning: 'bg-warning-soft text-warning',
        solid: 'bg-accent-500 text-on-accent',
      },
      size: {
        default: 'h-5 px-2 text-[11px]',
        sm: 'h-[18px] px-1.5 text-[10px] uppercase tracking-wide',
      },
    },
    defaultVariants: { variant: 'neutral', size: 'default' },
  },
);

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}
