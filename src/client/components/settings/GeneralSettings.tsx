import { useState, type FormEvent } from 'react';
import { Save } from 'lucide-react';
import type { SettingsData } from '../../api/hooks';

interface GeneralSettingsProps {
  settings: SettingsData['general'] | undefined;
  onSave: (data: Partial<SettingsData>) => void;
  loading?: boolean;
}

export function GeneralSettings({ settings, onSave, loading }: GeneralSettingsProps) {
  const [formData, setFormData] = useState({
    maxEntriesPerHour: settings?.maxEntriesPerHour ?? 50,
    maxEntriesPerDay: settings?.maxEntriesPerDay ?? 500,
    browserHeadless: settings?.browserHeadless ?? true,
    maxBrowserInstances: settings?.maxBrowserInstances ?? 3,
    screenshotOnSuccess: settings?.screenshotOnSuccess ?? true,
    screenshotOnFailure: settings?.screenshotOnFailure ?? true,
  });

  const update = (key: string, value: number | boolean) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSave({ general: formData });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="card p-6">
        <h3 className="text-base font-medium text-zinc-200">Rate Limits</h3>
        <p className="text-xs text-zinc-500">Control how fast entries are submitted</p>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Max Entries Per Hour</label>
            <input
              type="number"
              value={formData.maxEntriesPerHour}
              onChange={(e) => update('maxEntriesPerHour', Number(e.target.value))}
              className="input-field"
              min={1}
              max={1000}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Max Entries Per Day</label>
            <input
              type="number"
              value={formData.maxEntriesPerDay}
              onChange={(e) => update('maxEntriesPerDay', Number(e.target.value))}
              className="input-field"
              min={1}
              max={10000}
            />
          </div>
        </div>
      </div>

      <div className="card p-6">
        <h3 className="text-base font-medium text-zinc-200">Browser Settings</h3>
        <p className="text-xs text-zinc-500">Configure browser automation behavior</p>

        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-300">Headless Mode</p>
              <p className="text-xs text-zinc-500">Run browser without visible window</p>
            </div>
            <button
              type="button"
              onClick={() => update('browserHeadless', !formData.browserHeadless)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                formData.browserHeadless ? 'bg-emerald-600' : 'bg-zinc-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                  formData.browserHeadless ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Max Browser Instances</label>
            <input
              type="number"
              value={formData.maxBrowserInstances}
              onChange={(e) => update('maxBrowserInstances', Number(e.target.value))}
              className="input-field w-32"
              min={1}
              max={10}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-300">Screenshot on Success</p>
              <p className="text-xs text-zinc-500">Capture screenshot after successful entry</p>
            </div>
            <button
              type="button"
              onClick={() => update('screenshotOnSuccess', !formData.screenshotOnSuccess)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                formData.screenshotOnSuccess ? 'bg-emerald-600' : 'bg-zinc-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                  formData.screenshotOnSuccess ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-300">Screenshot on Failure</p>
              <p className="text-xs text-zinc-500">Capture screenshot on entry failure</p>
            </div>
            <button
              type="button"
              onClick={() => update('screenshotOnFailure', !formData.screenshotOnFailure)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                formData.screenshotOnFailure ? 'bg-emerald-600' : 'bg-zinc-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                  formData.screenshotOnFailure ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button type="submit" className="btn-primary" disabled={loading}>
          <Save className="h-4 w-4" />
          {loading ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </form>
  );
}
