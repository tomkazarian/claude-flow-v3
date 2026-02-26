import { type ReactNode } from 'react';
import { clsx } from 'clsx';
import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  message?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({ icon, title, message, action, className }: EmptyStateProps) {
  return (
    <div className={clsx('flex flex-col items-center justify-center py-16 text-center', className)}>
      <div className="mb-4 rounded-full bg-zinc-800/80 p-4 text-zinc-500">
        {icon ?? <Inbox className="h-8 w-8" />}
      </div>
      <h3 className="text-lg font-medium text-zinc-300">{title}</h3>
      {message && (
        <p className="mt-1 max-w-sm text-sm text-zinc-500">{message}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="btn-primary mt-4"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
