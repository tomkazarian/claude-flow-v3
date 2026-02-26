import { NavLink } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  LayoutDashboard,
  Trophy,
  Send,
  Users,
  ListOrdered,
  BarChart3,
  Activity,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { useAppStore } from '../../stores/app.store';
import { useDashboardStats } from '../../api/hooks';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/contests', label: 'Contests', icon: Trophy },
  { to: '/entries', label: 'Entries', icon: Send },
  { to: '/profiles', label: 'Profiles', icon: Users },
  { to: '/queue', label: 'Queue', icon: ListOrdered },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/status', label: 'Status', icon: Activity },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const;

export function Sidebar() {
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const { data: stats } = useDashboardStats();

  return (
    <aside
      className={clsx(
        'fixed inset-y-0 left-0 z-30 flex flex-col border-r border-zinc-800 bg-zinc-950 transition-all duration-300',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      {/* Logo */}
      <div
        className={clsx(
          'flex h-16 items-center border-b border-zinc-800 px-4',
          collapsed ? 'justify-center' : 'gap-3',
        )}
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600/20">
          <Trophy className="h-4 w-4 text-emerald-400" />
        </div>
        {!collapsed && (
          <span className="text-lg font-semibold tracking-tight text-zinc-100">
            SweepFlow
          </span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-4">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              clsx(
                'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                collapsed && 'justify-center px-2',
                isActive
                  ? 'border-l-2 border-emerald-500 bg-emerald-500/10 text-emerald-400'
                  : 'border-l-2 border-transparent text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200',
              )
            }
            title={collapsed ? label : undefined}
          >
            <Icon className="h-5 w-5 shrink-0" />
            {!collapsed && <span>{label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Mini stats */}
      {!collapsed && stats && (
        <div className="border-t border-zinc-800 px-4 py-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-500">Today</span>
            <span className="font-medium text-zinc-300">{stats.entriesToday} entries</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-xs">
            <span className="text-zinc-500">Wins</span>
            <span className="font-medium text-amber-400">{stats.totalWins}</span>
          </div>
        </div>
      )}

      {/* Collapse toggle */}
      <div className="border-t border-zinc-800 p-2">
        <button
          onClick={toggleSidebar}
          className={clsx(
            'flex w-full items-center justify-center rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300',
            !collapsed && 'justify-end',
          )}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>
    </aside>
  );
}
