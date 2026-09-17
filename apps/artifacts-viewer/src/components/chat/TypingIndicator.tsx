import { cn } from '../../lib/utils/cn';

export interface TypingIndicatorProps {
  surface?: 'light' | 'dark';
}

export function TypingIndicator({ surface = 'light' }: TypingIndicatorProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-4 py-2.5',
        surface === 'dark' ? 'bg-panel-dark-surface' : 'bg-surface-raised',
      )}
      aria-label="Assistant is responding"
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full animate-pulse"
          style={{ animationDelay: `${i * 150}ms`, backgroundColor: 'var(--text-tertiary)' }}
        />
      ))}
    </div>
  );
}
