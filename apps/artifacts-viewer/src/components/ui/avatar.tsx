import { cn } from '../../lib/utils/cn';

export function Avatar({ label, className, size = 36 }: { label: string; className?: string; size?: number }) {
  const initial = label.trim().charAt(0).toUpperCase() || '?';
  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-full bg-accent-soft text-accent-400 font-semibold shrink-0',
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {initial}
    </div>
  );
}
