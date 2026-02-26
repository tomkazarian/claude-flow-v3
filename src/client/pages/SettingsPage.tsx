import { useState, useCallback } from 'react';
import { clsx } from 'clsx';
import {
  Settings as SettingsIcon,
  Lock,
  Globe,
  Mail,
  Phone,
  Clock,
  Bell,
} from 'lucide-react';
import { useSettings, useUpdateSettings } from '../api/hooks';
import { GeneralSettings } from '../components/settings/GeneralSettings';
import { CaptchaSettings } from '../components/settings/CaptchaSettings';
import { ProxySettings } from '../components/settings/ProxySettings';
import { EmailSettings } from '../components/settings/EmailSettings';
import { LoadingSpinner } from '../components/shared/LoadingSpinner';
import { toast } from '../stores/notification.store';
import type { SettingsData } from '../api/hooks';

type SettingsTab = 'general' | 'captcha' | 'proxy' | 'email' | 'sms' | 'schedule' | 'notifications';

const tabs: Array<{ id: SettingsTab; label: string; icon: typeof SettingsIcon }> = [
  { id: 'general', label: 'General', icon: SettingsIcon },
  { id: 'captcha', label: 'CAPTCHA', icon: Lock },
  { id: 'proxy', label: 'Proxy', icon: Globe },
  { id: 'email', label: 'Email', icon: Mail },
  { id: 'sms', label: 'SMS', icon: Phone },
  { id: 'schedule', label: 'Schedule', icon: Clock },
  { id: 'notifications', label: 'Notifications', icon: Bell },
];

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const { data: settings, isLoading } = useSettings();
  const updateSettings = useUpdateSettings();

  const handleSave = useCallback(
    (data: Partial<SettingsData>) => {
      updateSettings.mutate(data, {
        onSuccess: () => toast.success('Settings saved'),
        onError: (err) => toast.error('Failed to save settings', err.message),
      });
    },
    [updateSettings],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <LoadingSpinner message="Loading settings..." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-zinc-100">Settings</h2>
        <p className="text-sm text-zinc-500">Configure platform behavior and integrations</p>
      </div>

      <div className="flex gap-6">
        {/* Tab navigation */}
        <nav className="w-48 shrink-0 space-y-1">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={clsx(
                'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors',
                activeTab === id
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </button>
          ))}
        </nav>

        {/* Tab content */}
        <div className="min-w-0 flex-1">
          {activeTab === 'general' && (
            <GeneralSettings
              settings={settings?.general}
              onSave={handleSave}
              loading={updateSettings.isPending}
            />
          )}

          {activeTab === 'captcha' && (
            <CaptchaSettings
              settings={settings?.captcha}
              onSave={handleSave}
              loading={updateSettings.isPending}
            />
          )}

          {activeTab === 'proxy' && (
            <ProxySettings
              onSave={handleSave}
              loading={updateSettings.isPending}
            />
          )}

          {activeTab === 'email' && (
            <EmailSettings
              onSave={handleSave}
              loading={updateSettings.isPending}
            />
          )}

          {activeTab === 'sms' && (
            <SmsSettingsContent settings={settings} onSave={handleSave} loading={updateSettings.isPending} />
          )}

          {activeTab === 'schedule' && (
            <ScheduleSettingsContent settings={settings} onSave={handleSave} loading={updateSettings.isPending} />
          )}

          {activeTab === 'notifications' && (
            <NotificationSettingsContent settings={settings} onSave={handleSave} loading={updateSettings.isPending} />
          )}
        </div>
      </div>
    </div>
  );
}

/** SMS settings content */
function SmsSettingsContent({
  settings: _settings,
  onSave,
  loading,
}: {
  settings: SettingsData | undefined;
  onSave: (data: Partial<SettingsData>) => void;
  loading: boolean;
}) {
  const [smsData, setSmsData] = useState({
    accountSid: '',
    authToken: '',
    phoneNumber: '',
  });

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h3 className="text-base font-medium text-zinc-200">SMS / Phone Verification</h3>
        <p className="text-xs text-zinc-500">Configure Twilio for SMS verification of contest entries</p>

        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Account SID</label>
            <input
              type="password"
              className="input-field"
              placeholder="ACxxxxxxxxxxxxxxxxx"
              value={smsData.accountSid}
              onChange={(e) => setSmsData((d) => ({ ...d, accountSid: e.target.value }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Auth Token</label>
            <input
              type="password"
              className="input-field"
              placeholder="Enter auth token"
              value={smsData.authToken}
              onChange={(e) => setSmsData((d) => ({ ...d, authToken: e.target.value }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Phone Number</label>
            <input
              type="text"
              className="input-field"
              placeholder="+15551234567"
              value={smsData.phoneNumber}
              onChange={(e) => setSmsData((d) => ({ ...d, phoneNumber: e.target.value }))}
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => onSave({ general: { ...smsData } as unknown as SettingsData['general'] })}
          className="btn-primary"
          disabled={loading}
        >
          {loading ? 'Saving...' : 'Save SMS Settings'}
        </button>
      </div>
    </div>
  );
}

/** Schedule settings content */
function ScheduleSettingsContent({
  settings,
  onSave,
  loading,
}: {
  settings: SettingsData | undefined;
  onSave: (data: Partial<SettingsData>) => void;
  loading: boolean;
}) {
  const [scheduleData, setScheduleData] = useState({
    discoveryEnabled: settings?.schedule?.discoveryEnabled ?? true,
    discoveryIntervalMs: settings?.schedule?.discoveryIntervalMs ?? 3600000,
    entryScheduleEnabled: settings?.schedule?.entryScheduleEnabled ?? true,
    entryCronExpression: settings?.schedule?.entryCronExpression ?? '0 */2 * * *',
  });

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h3 className="text-base font-medium text-zinc-200">Discovery Schedule</h3>
        <p className="text-xs text-zinc-500">How often to scan for new contests</p>

        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-300">Enable Discovery</p>
              <p className="text-xs text-zinc-500">Automatically find new contests</p>
            </div>
            <button
              type="button"
              onClick={() => setScheduleData((d) => ({ ...d, discoveryEnabled: !d.discoveryEnabled }))}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                scheduleData.discoveryEnabled ? 'bg-emerald-600' : 'bg-zinc-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                  scheduleData.discoveryEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Discovery Interval (hours)</label>
            <input
              type="number"
              value={scheduleData.discoveryIntervalMs / 3600000}
              onChange={(e) => setScheduleData((d) => ({ ...d, discoveryIntervalMs: Number(e.target.value) * 3600000 }))}
              className="input-field w-32"
              min={1}
              max={24}
            />
          </div>
        </div>
      </div>

      <div className="card p-6">
        <h3 className="text-base font-medium text-zinc-200">Entry Schedule</h3>
        <p className="text-xs text-zinc-500">When to process queued contest entries</p>

        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-300">Enable Entry Schedule</p>
              <p className="text-xs text-zinc-500">Automatically process entry queue</p>
            </div>
            <button
              type="button"
              onClick={() => setScheduleData((d) => ({ ...d, entryScheduleEnabled: !d.entryScheduleEnabled }))}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                scheduleData.entryScheduleEnabled ? 'bg-emerald-600' : 'bg-zinc-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                  scheduleData.entryScheduleEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Cron Expression</label>
            <input
              type="text"
              value={scheduleData.entryCronExpression}
              onChange={(e) => setScheduleData((d) => ({ ...d, entryCronExpression: e.target.value }))}
              className="input-field font-mono"
              placeholder="0 */2 * * *"
            />
            <p className="mt-1 text-[10px] text-zinc-600">
              Default: every 2 hours. Use cron format.
            </p>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => onSave({ schedule: scheduleData as SettingsData['schedule'] })}
          className="btn-primary"
          disabled={loading}
        >
          {loading ? 'Saving...' : 'Save Schedule'}
        </button>
      </div>
    </div>
  );
}

/** Notification settings content */
function NotificationSettingsContent({
  settings,
  onSave,
  loading,
}: {
  settings: SettingsData | undefined;
  onSave: (data: Partial<SettingsData>) => void;
  loading: boolean;
}) {
  const [notifData, setNotifData] = useState({
    emailOnWin: settings?.notifications?.emailOnWin ?? true,
    emailOnError: settings?.notifications?.emailOnError ?? false,
    emailRecipient: settings?.notifications?.emailRecipient ?? '',
  });

  const [webhooks, setWebhooks] = useState({
    discord: '',
    slack: '',
  });

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h3 className="text-base font-medium text-zinc-200">Email Notifications</h3>
        <p className="text-xs text-zinc-500">Get notified about important events</p>

        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Recipient Email</label>
            <input
              type="email"
              value={notifData.emailRecipient}
              onChange={(e) => setNotifData((d) => ({ ...d, emailRecipient: e.target.value }))}
              className="input-field"
              placeholder="you@example.com"
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-300">Email on Win</p>
              <p className="text-xs text-zinc-500">Receive email when you win a contest</p>
            </div>
            <button
              type="button"
              onClick={() => setNotifData((d) => ({ ...d, emailOnWin: !d.emailOnWin }))}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                notifData.emailOnWin ? 'bg-emerald-600' : 'bg-zinc-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                  notifData.emailOnWin ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-300">Email on Error</p>
              <p className="text-xs text-zinc-500">Receive email for critical system errors</p>
            </div>
            <button
              type="button"
              onClick={() => setNotifData((d) => ({ ...d, emailOnError: !d.emailOnError }))}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                notifData.emailOnError ? 'bg-emerald-600' : 'bg-zinc-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                  notifData.emailOnError ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      <div className="card p-6">
        <h3 className="text-base font-medium text-zinc-200">Webhook Integrations</h3>
        <p className="text-xs text-zinc-500">Send notifications to external services</p>

        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Discord Webhook URL</label>
            <input
              type="url"
              value={webhooks.discord}
              onChange={(e) => setWebhooks((w) => ({ ...w, discord: e.target.value }))}
              className="input-field"
              placeholder="https://discord.com/api/webhooks/..."
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Slack Webhook URL</label>
            <input
              type="url"
              value={webhooks.slack}
              onChange={(e) => setWebhooks((w) => ({ ...w, slack: e.target.value }))}
              className="input-field"
              placeholder="https://hooks.slack.com/services/..."
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => onSave({ notifications: notifData })}
          className="btn-primary"
          disabled={loading}
        >
          {loading ? 'Saving...' : 'Save Notifications'}
        </button>
      </div>
    </div>
  );
}
