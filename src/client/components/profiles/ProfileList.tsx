import { ProfileCard } from './ProfileCard';
import { EmptyState } from '../shared/EmptyState';
import { LoadingSpinner } from '../shared/LoadingSpinner';
import { Users } from 'lucide-react';
import type { Profile } from '@/types/profile.types';

interface ProfileListProps {
  profiles: Profile[];
  loading?: boolean;
  onEdit: (profile: Profile) => void;
  onToggleActive: (profileId: string, active: boolean) => void;
}

export function ProfileList({ profiles, loading, onEdit, onToggleActive }: ProfileListProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <LoadingSpinner message="Loading profiles..." />
      </div>
    );
  }

  if (profiles.length === 0) {
    return (
      <EmptyState
        icon={<Users className="h-8 w-8" />}
        title="No profiles yet"
        message="Create a profile to start entering contests."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {profiles.map((profile) => (
        <ProfileCard
          key={profile.id}
          profile={profile}
          onEdit={onEdit}
          onToggleActive={onToggleActive}
        />
      ))}
    </div>
  );
}
