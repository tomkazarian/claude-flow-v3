import { create } from 'zustand';

export type SystemStatus = 'healthy' | 'degraded' | 'error';

export interface AppNotification {
  id: string;
  type: 'win' | 'error' | 'info' | 'warning';
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  link?: string;
}

interface AppState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  theme: 'dark';

  systemStatus: SystemStatus;
  setSystemStatus: (status: SystemStatus) => void;

  notifications: AppNotification[];
  unreadCount: number;
  addNotification: (notification: Omit<AppNotification, 'id' | 'read' | 'createdAt'>) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  dismissNotification: (id: string) => void;
  clearNotifications: () => void;

  queuePaused: boolean;
  setQueuePaused: (paused: boolean) => void;
  toggleQueuePaused: () => void;
}

let notificationIdCounter = 0;

export const useAppStore = create<AppState>((set) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

  theme: 'dark',

  systemStatus: 'healthy',
  setSystemStatus: (systemStatus) => set({ systemStatus }),

  notifications: [],
  unreadCount: 0,
  addNotification: (notification) =>
    set((s) => {
      const newNotification: AppNotification = {
        ...notification,
        id: `notif-${++notificationIdCounter}`,
        read: false,
        createdAt: new Date().toISOString(),
      };
      const notifications = [newNotification, ...s.notifications].slice(0, 50);
      return {
        notifications,
        unreadCount: notifications.filter((n) => !n.read).length,
      };
    }),
  markNotificationRead: (id) =>
    set((s) => {
      const notifications = s.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n,
      );
      return {
        notifications,
        unreadCount: notifications.filter((n) => !n.read).length,
      };
    }),
  markAllNotificationsRead: () =>
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    })),
  dismissNotification: (id) =>
    set((s) => {
      const notifications = s.notifications.filter((n) => n.id !== id);
      return {
        notifications,
        unreadCount: notifications.filter((n) => !n.read).length,
      };
    }),
  clearNotifications: () => set({ notifications: [], unreadCount: 0 }),

  queuePaused: false,
  setQueuePaused: (queuePaused) => set({ queuePaused }),
  toggleQueuePaused: () => set((s) => ({ queuePaused: !s.queuePaused })),
}));
