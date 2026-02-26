import { clsx } from 'clsx';
import { Edit, ToggleLeft, ToggleRight } from 'lucide-react';
import type { Profile } from '@/types/profile.types';

interface ProfileCardProps {
  profile: Profile;
  stats?: { entries: number; wins: number; successRate: number };
  onEdit: (profile: Profile) => void;
  onToggleActive: (profileId: string, active: boolean) => void;
}

function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

const avatarColors = [
  'bg-emerald-600',
  'bg-blue-600',
  'bg-violet-600',
  'bg-amber-600',
  'bg-rose-600',
  'bg-cyan-600',
  'bg-pink-600',
  'bg-teal-600',
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return avatarColors[Math.abs(hash) % avatarColors.length] ?? avatarColors[0]!;
}

export function ProfileCard({ profile, stats, onEdit, onToggleActive }: ProfileCardProps) {
  const initials = getInitials(profile.firstName, profile.lastName);
  const fullName = `${profile.firstName} ${profile.lastName}`;
  const location = profile.address
    ? `${profile.address.city}, ${profile.address.state}`
    : null;

  return (
    <div className="card-hover p-5">
      <div className="flex items-start gap-4">
        {/* Avatar */}
        <div
          className={clsx(
            'flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-semibold text-white',
            getAvatarColor(fullName),
          )}
        >
          {initials}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <h3 className="truncate text-sm font-medium text-zinc-200">{fullName}</h3>
            <div className="flex items-center gap-1">
              <button
                onClick={() => onEdit(profile)}
                className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-700/50 hover:text-zinc-300"
                title="Edit profile"
              >
                <Edit className="h-4 w-4" />
              </button>
              <button
                onClick={() => onToggleActive(profile.id, !profile.isActive)}
                className={clsx(
                  'rounded p-1 transition-colors hover:bg-zinc-700/50',
                  profile.isActive ? 'text-emerald-400' : 'text-zinc-600',
                )}
                title={profile.isActive ? 'Deactivate' : 'Activate'}
              >
                {profile.isActive ? (
                  <ToggleRight className="h-5 w-5" />
                ) : (
                  <ToggleLeft className="h-5 w-5" />
                )}
              </button>
            </div>
          </div>

          <p className="truncate text-xs text-zinc-500">{profile.email}</p>
          {location && (
            <p className="text-xs text-zinc-600">{location}</p>
          )}
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-zinc-800/50 pt-3">
          <div className="text-center">
            <p className="text-lg font-semibold text-zinc-200">{stats.entries}</p>
            <p className="text-[10px] uppercase tracking-wider text-zinc-600">Entries</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-semibold text-amber-400">{stats.wins}</p>
            <p className="text-[10px] uppercase tracking-wider text-zinc-600">Wins</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-semibold text-emerald-400">
              {(stats.successRate * 100).toFixed(0)}%
            </p>
            <p className="text-[10px] uppercase tracking-wider text-zinc-600">Success</p>
          </div>
        </div>
      )}

      {/* Active indicator */}
      {!profile.isActive && (
        <div className="mt-3 rounded bg-zinc-800/50 px-2 py-1 text-center text-xs text-zinc-500">
          Inactive
        </div>
      )}
    </div>
  );
}
