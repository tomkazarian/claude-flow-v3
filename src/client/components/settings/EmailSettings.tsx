import { Mail, CheckCircle2, RefreshCw, Unplug } from 'lucide-react';
import type { SettingsData } from '../../api/hooks';

interface ConnectedAccount {
  id: string;
  email: string;
  provider: string;
  connected: boolean;
  lastSync: string | null;
}

interface EmailSettingsProps {
  onSave: (data: Partial<SettingsData>) => void;
  loading?: boolean;
}

export function EmailSettings({ onSave: _onSave, loading: _loading }: EmailSettingsProps) {
  const connectedAccounts: ConnectedAccount[] = [
    {
      id: '1',
      email: 'sweepflow@gmail.com',
      provider: 'Gmail',
      connected: true,
      lastSync: '2026-02-26T10:30:00Z',
    },
  ];

  const handleConnect = () => {
    // OAuth flow would go here
  };

  const handleSync = (_accountId: string) => {
    // Trigger sync
  };

  const handleDisconnect = (_accountId: string) => {
    // Disconnect account
  };

  return (
    <div className="space-y-6">
      {/* Connect new account */}
      <div className="card p-6">
        <h3 className="text-base font-medium text-zinc-200">Connect Email Account</h3>
        <p className="text-xs text-zinc-500">
          Connect a Gmail account to send/receive confirmation emails
        </p>

        <button onClick={handleConnect} className="btn-primary mt-4">
          <Mail className="h-4 w-4" />
          Connect Gmail via OAuth
        </button>

        <p className="mt-2 text-[10px] text-zinc-600">
          We only request read access to detect confirmation and win notification emails.
        </p>
      </div>

      {/* Connected accounts */}
      <div className="card overflow-hidden">
        <div className="border-b border-zinc-700/50 px-5 py-3">
          <h3 className="text-sm font-medium text-zinc-300">Connected Accounts</h3>
        </div>

        {connectedAccounts.length === 0 ? (
          <div className="py-12 text-center text-sm text-zinc-500">
            No email accounts connected.
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/30">
            {connectedAccounts.map((account) => (
              <div key={account.id} className="flex items-center gap-4 px-5 py-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/10">
                  <Mail className="h-5 w-5 text-blue-400" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-zinc-200">{account.email}</p>
                    {account.connected && (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    )}
                  </div>
                  <p className="text-xs text-zinc-500">
                    {account.provider}
                    {account.lastSync && (
                      <span className="ml-2">
                        Last synced: {new Date(account.lastSync).toLocaleString()}
                      </span>
                    )}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleSync(account.id)}
                    className="btn-ghost p-2 text-xs"
                    title="Sync now"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDisconnect(account.id)}
                    className="btn-ghost p-2 text-xs text-rose-400"
                    title="Disconnect"
                  >
                    <Unplug className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
