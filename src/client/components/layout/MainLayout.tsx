import { type ReactNode } from 'react';
import { clsx } from 'clsx';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useAppStore } from '../../stores/app.store';
import { useToastStore } from '../../stores/notification.store';
import { X, CheckCircle2, AlertCircle, AlertTriangle, Info } from 'lucide-react';

interface MainLayoutProps {
  children: ReactNode;
}

const toastIcons = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const toastColors = {
  success: 'border-emerald-500/30 bg-emerald-500/10',
  error: 'border-rose-500/30 bg-rose-500/10',
  warning: 'border-yellow-500/30 bg-yellow-500/10',
  info: 'border-blue-500/30 bg-blue-500/10',
};

const toastTextColors = {
  success: 'text-emerald-400',
  error: 'text-rose-400',
  warning: 'text-yellow-400',
  info: 'text-blue-400',
};

export function MainLayout({ children }: MainLayoutProps) {
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  return (
    <div className="flex min-h-screen bg-zinc-950">
      <Sidebar />

      <div
        className={clsx(
          'flex flex-1 flex-col transition-all duration-300',
          collapsed ? 'ml-16' : 'ml-60',
        )}
      >
        <Header />

        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>

      {/* Toast container */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
          {toasts.map((t) => {
            const Icon = toastIcons[t.type];
            return (
              <div
                key={t.id}
                className={clsx(
                  'animate-slide-in flex items-start gap-3 rounded-lg border p-4 shadow-xl backdrop-blur-sm',
                  toastColors[t.type],
                )}
              >
                <Icon className={clsx('mt-0.5 h-5 w-5 shrink-0', toastTextColors[t.type])} />
                <div className="flex-1">
                  <p className="text-sm font-medium text-zinc-100">{t.title}</p>
                  {t.message && (
                    <p className="mt-0.5 text-xs text-zinc-400">{t.message}</p>
                  )}
                </div>
                <button
                  onClick={() => removeToast(t.id)}
                  className="shrink-0 text-zinc-500 hover:text-zinc-300"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
