import { Mail, CheckCircle2, RefreshCw, Unplug } from 'lucide-react';
import { useEmailAccounts, useConnectEmailAccount, useDisconnectEmailAccount, useSyncEmail } from '../../api/hooks';
import { LoadingSpinner } from '../shared/LoadingSpinner';
import { toast } from '../../stores/notification.store';
import type { SettingsData } from '../../api/hooks';

interface EmailSettingsProps {
  onSave: (data: Partial<SettingsData>) => void;
  loading?: boolean;
}

export function EmailSettings({ onSave: _onSave, loading: _loading }: EmailSettingsProps) {
  const { data: accounts, isLoading } = useEmailAccounts();
  const connectAccount = useConnectEmailAccount();
  const disconnectAccount = useDisconnectEmailAccount();
  const syncEmail = useSyncEmail();

  const handleConnect = () => {
    connectAccount.mutate(undefined, {
      onSuccess: (resp) => {
        const authUrl = resp?.data?.authUrl;
        if (authUrl) {
          window.open(authUrl, '_blank', 'noopener,noreferrer');
          toast.info('OAuth started', 'Complete Gmail authorization in the new window.');
        } else {
          toast.success('Connection initiated');
        }
      },
      onError: (err) => toast.error('Connection failed', err.message),
    });
  };

  const handleSync = () => {
    syncEmail.mutate(undefined, {
      onSuccess: () => toast.success('Sync started', 'Email sync is running.'),
      onError: (err) => toast.error('Sync failed', err.message),
    });
  };

  const handleDisconnect = (accountId: string) => {
    disconnectAccount.mutate(accountId, {
      onSuccess: () => toast.success('Account disconnected'),
      onError: (err) => toast.error('Disconnect failed', err.message),
    });
  };

  const connectedAccounts = accounts ?? [];

  return (
    <div className="space-y-6">
      {/* Connect new account */}
      <div className="card p-6">
        <h3 className="text-base font-medium text-zinc-200">Connect Email Account</h3>
        <p className="text-xs text-zinc-500">
          Connect a Gmail account to send/receive confirmation emails
        </p>

        <button
          onClick={handleConnect}
          disabled={connectAccount.isPending}
          className="btn-primary mt-4"
        >
          <Mail className="h-4 w-4" />
          {connectAccount.isPending ? 'Connecting...' : 'Connect Gmail via OAuth'}
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

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <LoadingSpinner message="Loading email accounts..." />
          </div>
        ) : connectedAccounts.length === 0 ? (
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
                    <p className="text-sm font-medium text-zinc-200">{account.emailAddress}</p>
                    {account.isActive ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    ) : null}
                  </div>
                  <p className="text-xs text-zinc-500">
                    {account.provider}
                    {account.lastSyncAt && (
                      <span className="ml-2">
                        Last synced: {new Date(account.lastSyncAt).toLocaleString()}
                      </span>
                    )}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSync}
                    disabled={syncEmail.isPending}
                    className="btn-ghost p-2 text-xs"
                    title="Sync now"
                  >
                    <RefreshCw className={`h-4 w-4 ${syncEmail.isPending ? 'animate-spin' : ''}`} />
                  </button>
                  <button
                    onClick={() => handleDisconnect(account.id)}
                    disabled={disconnectAccount.isPending}
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
