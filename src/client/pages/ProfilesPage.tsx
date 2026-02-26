import { useState, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { useProfiles, useCreateProfile, useUpdateProfile } from '../api/hooks';
import { ProfileList } from '../components/profiles/ProfileList';
import { ProfileForm } from '../components/profiles/ProfileForm';
import { toast } from '../stores/notification.store';
import type { Profile, ProfileCreateInput } from '@/types/profile.types';

export function ProfilesPage() {
  const { data: profiles, isLoading } = useProfiles();
  const createProfile = useCreateProfile();
  const updateProfile = useUpdateProfile();
  const [showForm, setShowForm] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);

  const handleEdit = useCallback((profile: Profile) => {
    setEditingProfile(profile);
    setShowForm(true);
  }, []);

  const handleToggleActive = useCallback(
    (profileId: string, active: boolean) => {
      updateProfile.mutate(
        { id: profileId, isActive: active },
        {
          onSuccess: () => toast.success(active ? 'Profile activated' : 'Profile deactivated'),
          onError: (err) => toast.error('Failed to update profile', err.message),
        },
      );
    },
    [updateProfile],
  );

  const handleSave = useCallback(
    (data: ProfileCreateInput) => {
      if (editingProfile) {
        updateProfile.mutate(
          { id: editingProfile.id, ...data },
          {
            onSuccess: () => {
              toast.success('Profile updated');
              setShowForm(false);
              setEditingProfile(null);
            },
            onError: (err) => toast.error('Failed to update profile', err.message),
          },
        );
      } else {
        createProfile.mutate(data, {
          onSuccess: () => {
            toast.success('Profile created');
            setShowForm(false);
          },
          onError: (err) => toast.error('Failed to create profile', err.message),
        });
      }
    },
    [editingProfile, createProfile, updateProfile],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Profiles</h2>
          <p className="text-sm text-zinc-500">
            {profiles?.length ?? 0} profiles configured
          </p>
        </div>
        <button
          onClick={() => {
            setEditingProfile(null);
            setShowForm(true);
          }}
          className="btn-primary"
        >
          <Plus className="h-4 w-4" />
          Add Profile
        </button>
      </div>

      <ProfileList
        profiles={profiles ?? []}
        loading={isLoading}
        onEdit={handleEdit}
        onToggleActive={handleToggleActive}
      />

      {showForm && (
        <ProfileForm
          profile={editingProfile}
          onSave={handleSave}
          onClose={() => {
            setShowForm(false);
            setEditingProfile(null);
          }}
          loading={createProfile.isPending || updateProfile.isPending}
        />
      )}
    </div>
  );
}
