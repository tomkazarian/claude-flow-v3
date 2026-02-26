import { useState, type FormEvent } from 'react';
import { clsx } from 'clsx';
import { Plus, Trash2, Upload, Wifi } from 'lucide-react';
import { StatusBadge } from '../shared/StatusBadge';
import type { SettingsData } from '../../api/hooks';

interface ProxyEntry {
  id: string;
  host: string;
  port: number;
  protocol: string;
  healthStatus: string;
  isActive: boolean;
}

interface ProxySettingsProps {
  onSave: (data: Partial<SettingsData>) => void;
  loading?: boolean;
}

export function ProxySettings({ onSave: _onSave, loading: _loading }: ProxySettingsProps) {
  const [proxies, setProxies] = useState<ProxyEntry[]>([
    { id: '1', host: '192.168.1.100', port: 8080, protocol: 'http', healthStatus: 'healthy', isActive: true },
    { id: '2', host: '10.0.0.50', port: 1080, protocol: 'socks5', healthStatus: 'degraded', isActive: true },
  ]);

  const [newProxy, setNewProxy] = useState({ host: '', port: '', protocol: 'http' });
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkText, setBulkText] = useState('');

  const handleAddProxy = (e: FormEvent) => {
    e.preventDefault();
    if (!newProxy.host || !newProxy.port) return;

    setProxies((prev) => [
      ...prev,
      {
        id: `proxy-${Date.now()}`,
        host: newProxy.host,
        port: Number(newProxy.port),
        protocol: newProxy.protocol,
        healthStatus: 'unknown',
        isActive: true,
      },
    ]);
    setNewProxy({ host: '', port: '', protocol: 'http' });
  };

  const handleRemoveProxy = (id: string) => {
    setProxies((prev) => prev.filter((p) => p.id !== id));
  };

  const handleBulkImport = () => {
    const lines = bulkText.split('\n').filter((l) => l.trim());
    const newProxies: ProxyEntry[] = lines.map((line, i) => {
      const parts = line.trim().split(':');
      return {
        id: `proxy-bulk-${Date.now()}-${i}`,
        host: parts[0] ?? '',
        port: Number(parts[1] ?? 8080),
        protocol: 'http',
        healthStatus: 'unknown',
        isActive: true,
      };
    });
    setProxies((prev) => [...prev, ...newProxies]);
    setBulkText('');
    setShowBulkImport(false);
  };

  return (
    <div className="space-y-6">
      {/* Add proxy form */}
      <div className="card p-6">
        <h3 className="text-base font-medium text-zinc-200">Add Proxy</h3>
        <p className="text-xs text-zinc-500">Add a new proxy to the pool</p>

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
          <button type="submit" className="btn-primary">
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
          <p className="text-xs text-zinc-500">{proxies.length} proxies configured</p>
        </div>

        {proxies.length === 0 ? (
          <div className="py-12 text-center text-sm text-zinc-500">
            No proxies configured. Add one above.
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/30">
            {proxies.map((proxy) => (
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
