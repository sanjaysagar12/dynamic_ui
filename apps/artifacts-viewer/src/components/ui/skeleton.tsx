import { cn } from '../../lib/utils/cn';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('rounded-md bg-surface-raised animate-pulse', className)} />;
}
