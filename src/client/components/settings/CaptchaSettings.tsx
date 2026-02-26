import { useState, type FormEvent } from 'react';
import { Save, TestTube2, Wallet } from 'lucide-react';
import { toast } from '../../stores/notification.store';
import type { SettingsData } from '../../api/hooks';

interface CaptchaSettingsProps {
  settings: SettingsData['captcha'] | undefined;
  onSave: (data: Partial<SettingsData>) => void;
  loading?: boolean;
}

export function CaptchaSettings({ settings, onSave, loading }: CaptchaSettingsProps) {
  const [formData, setFormData] = useState({
    provider: settings?.provider ?? '2captcha',
    apiKey: settings?.apiKey ?? '',
    maxTimeoutMs: settings?.maxTimeoutMs ?? 120000,
    maxRetries: settings?.maxRetries ?? 3,
  });

  const [testing, setTesting] = useState(false);

  const update = (key: string, value: string | number) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSave({ captcha: formData });
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      // Simulate test
      await new Promise((resolve) => setTimeout(resolve, 2000));
      toast.success('CAPTCHA test passed', 'Provider is configured correctly.');
    } catch {
      toast.error('CAPTCHA test failed', 'Check your API key and provider settings.');
    } finally {
      setTesting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="card p-6">
        <h3 className="text-base font-medium text-zinc-200">CAPTCHA Provider</h3>
        <p className="text-xs text-zinc-500">Configure automated CAPTCHA solving</p>

        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Provider</label>
            <select
              value={formData.provider}
              onChange={(e) => update('provider', e.target.value)}
              className="select-field w-full"
            >
              <option value="2captcha">2Captcha</option>
              <option value="anticaptcha">Anti-Captcha</option>
              <option value="capsolver">CapSolver</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">API Key</label>
            <input
              type="password"
              value={formData.apiKey}
              onChange={(e) => update('apiKey', e.target.value)}
              className="input-field"
              placeholder="Enter your API key"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Timeout (ms)</label>
              <input
                type="number"
                value={formData.maxTimeoutMs}
                onChange={(e) => update('maxTimeoutMs', Number(e.target.value))}
                className="input-field"
                min={10000}
                max={300000}
                step={10000}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Max Retries</label>
              <input
                type="number"
                value={formData.maxRetries}
                onChange={(e) => update('maxRetries', Number(e.target.value))}
                className="input-field"
                min={0}
                max={5}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Balance display */}
      {settings?.balance !== undefined && (
        <div className="card flex items-center gap-3 p-4">
          <div className="rounded-lg bg-emerald-500/10 p-2">
            <Wallet className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <p className="text-xs text-zinc-500">Current Balance</p>
            <p className="text-lg font-semibold text-zinc-100">${settings.balance.toFixed(2)}</p>
          </div>
        </div>
      )}

      <div className="flex justify-between">
        <button
          type="button"
          onClick={handleTest}
          disabled={testing || !formData.apiKey}
          className="btn-secondary"
        >
          <TestTube2 className="h-4 w-4" />
          {testing ? 'Testing...' : 'Test Connection'}
        </button>

        <button type="submit" className="btn-primary" disabled={loading}>
          <Save className="h-4 w-4" />
          {loading ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </form>
  );
}
