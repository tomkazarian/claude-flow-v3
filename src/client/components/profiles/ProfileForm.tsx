import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import type { Profile, ProfileCreateInput } from '@/types/profile.types';

interface ProfileFormProps {
  profile?: Profile | null;
  onSave: (data: ProfileCreateInput) => void;
  onClose: () => void;
  loading?: boolean;
}

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC',
];

export function ProfileForm({ profile, onSave, onClose, loading }: ProfileFormProps) {
  const [formData, setFormData] = useState({
    firstName: profile?.firstName ?? '',
    lastName: profile?.lastName ?? '',
    email: profile?.email ?? '',
    phone: profile?.phone ?? '',
    addressLine1: profile?.address?.line1 ?? '',
    addressLine2: profile?.address?.line2 ?? '',
    city: profile?.address?.city ?? '',
    state: profile?.address?.state ?? '',
    zip: profile?.address?.zip ?? '',
    country: profile?.address?.country ?? 'US',
    dateOfBirth: profile?.dateOfBirth ?? '',
    gender: profile?.gender ?? '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const update = (key: string, value: string) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!formData.firstName.trim()) errs['firstName'] = 'Required';
    if (!formData.lastName.trim()) errs['lastName'] = 'Required';
    if (!formData.email.trim()) errs['email'] = 'Required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) errs['email'] = 'Invalid email';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const input: ProfileCreateInput = {
      firstName: formData.firstName.trim(),
      lastName: formData.lastName.trim(),
      email: formData.email.trim(),
    };

    if (formData.phone) input.phone = formData.phone;
    if (formData.addressLine1) input.addressLine1 = formData.addressLine1;
    if (formData.addressLine2) input.addressLine2 = formData.addressLine2;
    if (formData.city) input.city = formData.city;
    if (formData.state) input.state = formData.state;
    if (formData.zip) input.zip = formData.zip;
    if (formData.country) input.country = formData.country;
    if (formData.dateOfBirth) input.dateOfBirth = formData.dateOfBirth;
    if (formData.gender) input.gender = formData.gender;

    onSave(input);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 w-full max-w-lg rounded-xl border border-zinc-700/50 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <h3 className="text-lg font-semibold text-zinc-100">
            {profile ? 'Edit Profile' : 'New Profile'}
          </h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="max-h-[70vh] overflow-y-auto p-6">
          <div className="grid grid-cols-2 gap-4">
            {/* First Name */}
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">First Name *</label>
              <input
                type="text"
                value={formData.firstName}
                onChange={(e) => update('firstName', e.target.value)}
                className="input-field"
                placeholder="John"
              />
              {errors['firstName'] && <p className="mt-1 text-xs text-rose-400">{errors['firstName']}</p>}
            </div>

            {/* Last Name */}
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Last Name *</label>
              <input
                type="text"
                value={formData.lastName}
                onChange={(e) => update('lastName', e.target.value)}
                className="input-field"
                placeholder="Doe"
              />
              {errors['lastName'] && <p className="mt-1 text-xs text-rose-400">{errors['lastName']}</p>}
            </div>

            {/* Email */}
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-zinc-400">Email *</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => update('email', e.target.value)}
                className="input-field"
                placeholder="john@example.com"
              />
              {errors['email'] && <p className="mt-1 text-xs text-rose-400">{errors['email']}</p>}
            </div>

            {/* Phone */}
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-zinc-400">Phone</label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => update('phone', e.target.value)}
                className="input-field"
                placeholder="+15551234567"
              />
            </div>

            {/* Address Line 1 */}
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-zinc-400">Address Line 1</label>
              <input
                type="text"
                value={formData.addressLine1}
                onChange={(e) => update('addressLine1', e.target.value)}
                className="input-field"
                placeholder="123 Main St"
              />
            </div>

            {/* Address Line 2 */}
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-zinc-400">Address Line 2</label>
              <input
                type="text"
                value={formData.addressLine2}
                onChange={(e) => update('addressLine2', e.target.value)}
                className="input-field"
                placeholder="Apt 4B"
              />
            </div>

            {/* City */}
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">City</label>
              <input
                type="text"
                value={formData.city}
                onChange={(e) => update('city', e.target.value)}
                className="input-field"
                placeholder="New York"
              />
            </div>

            {/* State */}
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">State</label>
              <select
                value={formData.state}
                onChange={(e) => update('state', e.target.value)}
                className="select-field"
              >
                <option value="">Select state</option>
                {US_STATES.map((st) => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </select>
            </div>

            {/* ZIP */}
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">ZIP Code</label>
              <input
                type="text"
                value={formData.zip}
                onChange={(e) => update('zip', e.target.value)}
                className="input-field"
                placeholder="10001"
              />
            </div>

            {/* Country */}
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Country</label>
              <input
                type="text"
                value={formData.country}
                onChange={(e) => update('country', e.target.value)}
                className="input-field"
                placeholder="US"
                maxLength={2}
              />
            </div>

            {/* Date of Birth */}
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Date of Birth</label>
              <input
                type="date"
                value={formData.dateOfBirth}
                onChange={(e) => update('dateOfBirth', e.target.value)}
                className="input-field"
              />
            </div>

            {/* Gender */}
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Gender</label>
              <select
                value={formData.gender}
                onChange={(e) => update('gender', e.target.value)}
                className="select-field"
              >
                <option value="">Prefer not to say</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="non-binary">Non-binary</option>
              </select>
            </div>
          </div>

          {/* Actions */}
          <div className="mt-6 flex justify-end gap-3 border-t border-zinc-800 pt-4">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Saving...' : profile ? 'Update Profile' : 'Create Profile'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
