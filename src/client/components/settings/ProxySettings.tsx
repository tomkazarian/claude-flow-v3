import { useState, type FormEvent } from 'react';
import { clsx } from 'clsx';
import { Plus, Trash2, Upload, Wifi, HeartPulse } from 'lucide-react';
import { StatusBadge } from '../shared/StatusBadge';
import { LoadingSpinner } from '../shared/LoadingSpinner';
import { useProxies, useCreateProxy, useDeleteProxy, useProxyHealthCheck } from '../../api/hooks';
import { toast } from '../../stores/notification.store';
import type { SettingsData } from '../../api/hooks';

interface ProxySettingsProps {
  onSave: (data: Partial<SettingsData>) => void;
  loading?: boolean;
}

export function ProxySettings({ onSave: _onSave, loading: _loading }: ProxySettingsProps) {
  const { data: proxies, isLoading } = useProxies();
  const createProxy = useCreateProxy();
  const deleteProxy = useDeleteProxy();
  const healthCheck = useProxyHealthCheck();

  const [newProxy, setNewProxy] = useState({ host: '', port: '', protocol: 'http' });
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkText, setBulkText] = useState('');

  const handleAddProxy = (e: FormEvent) => {
    e.preventDefault();
    if (!newProxy.host || !newProxy.port) return;

    createProxy.mutate(
      { host: newProxy.host, port: Number(newProxy.port), protocol: newProxy.protocol },
      {
        onSuccess: () => {
          toast.success('Proxy added');
          setNewProxy({ host: '', port: '', protocol: 'http' });
        },
        onError: (err) => toast.error('Failed to add proxy', err.message),
      },
    );
  };

  const handleRemoveProxy = (id: string) => {
    deleteProxy.mutate(id, {
      onSuccess: () => toast.success('Proxy removed'),
      onError: (err) => toast.error('Failed to remove proxy', err.message),
    });
  };

  const handleBulkImport = () => {
    const lines = bulkText.split('\n').filter((l) => l.trim());
    let imported = 0;
    for (const line of lines) {
      const parts = line.trim().split(':');
      const host = parts[0] ?? '';
      const port = Number(parts[1] ?? 8080);
      if (host && port > 0) {
        createProxy.mutate({ host, port, protocol: 'http' });
        imported++;
      }
    }
    toast.info('Bulk import started', `Importing ${imported} proxies`);
    setBulkText('');
    setShowBulkImport(false);
  };

  const handleHealthCheck = () => {
    healthCheck.mutate(undefined, {
      onSuccess: () => toast.success('Health check started', 'Proxy health checks are running.'),
      onError: (err) => toast.error('Health check failed', err.message),
    });
  };

  const proxyList = proxies ?? [];

  return (
    <div className="space-y-6">
      {/* Add proxy form */}
      <div className="card p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-medium text-zinc-200">Add Proxy</h3>
            <p className="text-xs text-zinc-500">Add a new proxy to the pool</p>
          </div>
          <button
            onClick={handleHealthCheck}
            disabled={healthCheck.isPending}
            className="btn-secondary text-xs"
          >
            <HeartPulse className="h-4 w-4" />
            {healthCheck.isPending ? 'Checking...' : 'Health Check'}
          </button>
        </div>

        <form onSubmit={handleAddProxy} className="mt-4 flex items-end gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-zinc-400">Host</label>
            <input
              type="text"
              value={newProxy.host}
              onChange={(e) => setNewProxy((p) => ({ ...p, host: e.target.value }))}
              className="input-field"
              placeholder="192.168.1.100"
            />
          </div>
          <div className="w-24">
            <label className="mb-1 block text-xs font-medium text-zinc-400">Port</label>
            <input
              type="number"
              value={newProxy.port}
              onChange={(e) => setNewProxy((p) => ({ ...p, port: e.target.value }))}
              className="input-field"
              placeholder="8080"
            />
          </div>
          <div className="w-32">
            <label className="mb-1 block text-xs font-medium text-zinc-400">Protocol</label>
            <select
              value={newProxy.protocol}
              onChange={(e) => setNewProxy((p) => ({ ...p, protocol: e.target.value }))}
              className="select-field"
            >
              <option value="http">HTTP</option>
              <option value="https">HTTPS</option>
              <option value="socks5">SOCKS5</option>
            </select>
          </div>
          <button type="submit" className="btn-primary" disabled={createProxy.isPending}>
            <Plus className="h-4 w-4" />
            Add
          </button>
          <button
            type="button"
            onClick={() => setShowBulkImport(!showBulkImport)}
            className="btn-secondary"
          >
            <Upload className="h-4 w-4" />
            Bulk
          </button>
        </form>

        {showBulkImport && (
          <div className="mt-4 space-y-2">
            <label className="block text-xs font-medium text-zinc-400">
              Paste proxies (one per line, host:port format)
            </label>
            <textarea
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              className="input-field h-32 resize-none font-mono text-xs"
              placeholder="192.168.1.100:8080&#10;10.0.0.50:1080&#10;proxy.example.com:3128"
            />
            <button onClick={handleBulkImport} className="btn-primary text-xs">
              Import {bulkText.split('\n').filter((l) => l.trim()).length} proxies
            </button>
          </div>
        )}
      </div>

      {/* Proxy list */}
      <div className="card overflow-hidden">
        <div className="border-b border-zinc-700/50 px-5 py-3">
          <h3 className="text-sm font-medium text-zinc-300">Proxy Pool</h3>
          <p className="text-xs text-zinc-500">{proxyList.length} proxies configured</p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <LoadingSpinner message="Loading proxies..." />
          </div>
        ) : proxyList.length === 0 ? (
          <div className="py-12 text-center text-sm text-zinc-500">
            No proxies configured. Add one above.
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/30">
            {proxyList.map((proxy) => (
              <div key={proxy.id} className="flex items-center gap-4 px-5 py-3">
                <Wifi className={clsx('h-4 w-4', proxy.isActive ? 'text-emerald-400' : 'text-zinc-600')} />
                <div className="min-w-0 flex-1">
                  <span className="font-mono text-sm text-zinc-200">
                    {proxy.protocol}://{proxy.host}:{proxy.port}
                  </span>
                </div>
                <StatusBadge status={proxy.healthStatus} />
                <button
                  onClick={() => handleRemoveProxy(proxy.id)}
                  className="rounded p-1.5 text-zinc-600 transition-colors hover:bg-zinc-700/50 hover:text-rose-400"
                  disabled={deleteProxy.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
