/**
 * Profile CRUD manager with PII encryption.
 *
 * Handles creation, retrieval, update, and deletion of user profiles.
 * Sensitive fields (address, SSN if collected) are encrypted at rest
 * using AES-256-GCM via the shared crypto module.
 */

import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { getLogger } from '../shared/logger.js';
import { ValidationError } from '../shared/errors.js';
import { encrypt, decrypt, generateId } from '../shared/crypto.js';
import { profiles } from '../db/schema.js';

const logger = getLogger('profile', { component: 'profile-manager' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Profile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  emailAliases: string[];
  phone: string | null;
  phoneProvider: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string;
  dateOfBirth: string | null;
  gender: string | null;
  socialAccounts: Record<string, string>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileCreateInput {
  firstName: string;
  lastName: string;
  email: string;
  emailAliases?: string[];
  phone?: string;
  phoneProvider?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  dateOfBirth?: string;
  gender?: string;
  socialAccounts?: Record<string, string>;
}

export interface ProfileUpdateInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  emailAliases?: string[];
  phone?: string;
  phoneProvider?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  dateOfBirth?: string;
  gender?: string;
  socialAccounts?: Record<string, string>;
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Encrypted fields configuration
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ProfileManager
// ---------------------------------------------------------------------------

export class ProfileManager {
  private readonly db: BetterSQLite3Database;

  constructor(db: BetterSQLite3Database) {
    this.db = db;
  }

  /**
   * Creates a new profile with validated input and encrypted PII fields.
   * Generates a ULID as the primary key.
   */
  async create(input: ProfileCreateInput): Promise<Profile> {
    this.validateCreateInput(input);

    const id = generateId();
    const now = new Date().toISOString();

    const row = {
      id,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      email: input.email.trim().toLowerCase(),
      emailAliases: JSON.stringify(input.emailAliases ?? []),
      phone: input.phone?.trim() ?? null,
      phoneProvider: input.phoneProvider ?? null,
      addressLine1: input.addressLine1
        ? encrypt(input.addressLine1.trim())
        : null,
      addressLine2: input.addressLine2
        ? encrypt(input.addressLine2.trim())
        : null,
      city: input.city?.trim() ?? null,
      state: input.state?.toUpperCase().trim() ?? null,
      zip: input.zip?.trim() ?? null,
      country: input.country?.toUpperCase().trim() ?? 'US',
      dateOfBirth: input.dateOfBirth ?? null,
      gender: input.gender ?? null,
      socialAccounts: JSON.stringify(input.socialAccounts ?? {}),
      isActive: 1,
      createdAt: now,
      updatedAt: now,
    };

    this.db.insert(profiles).values(row).run();

    logger.info({ profileId: id, email: row.email }, 'Profile created');

    return this.rowToProfile({ ...row, isActive: 1 });
  }

  /**
   * Retrieves a profile by ID, decrypting PII fields on the way out.
   * Returns null if the profile does not exist.
   */
  async getById(id: string): Promise<Profile | null> {
    const rows = this.db
      .select()
      .from(profiles)
      .where(eq(profiles.id, id))
      .limit(1)
      .all();

    if (rows.length === 0) {
      return null;
    }

    return this.rowToProfile(rows[0]!);
  }

  /**
   * Retrieves all profiles, decrypting PII fields for each.
   */
  async getAll(): Promise<Profile[]> {
    const rows = this.db.select().from(profiles).all();
    return rows.map((row) => this.rowToProfile(row));
  }

  /**
   * Updates a profile with the provided fields. Only non-undefined
   * fields are updated. PII fields are re-encrypted.
   */
  async update(id: string, input: ProfileUpdateInput): Promise<Profile> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new ValidationError(`Profile ${id} not found`, 'id', id);
    }

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { updatedAt: now };

    if (input.firstName !== undefined) {
      updates.firstName = input.firstName.trim();
    }
    if (input.lastName !== undefined) {
      updates.lastName = input.lastName.trim();
    }
    if (input.email !== undefined) {
      updates.email = input.email.trim().toLowerCase();
    }
    if (input.emailAliases !== undefined) {
      updates.emailAliases = JSON.stringify(input.emailAliases);
    }
    if (input.phone !== undefined) {
      updates.phone = input.phone?.trim() ?? null;
    }
    if (input.phoneProvider !== undefined) {
      updates.phoneProvider = input.phoneProvider;
    }
    if (input.addressLine1 !== undefined) {
      updates.addressLine1 = input.addressLine1
        ? encrypt(input.addressLine1.trim())
        : null;
    }
    if (input.addressLine2 !== undefined) {
      updates.addressLine2 = input.addressLine2
        ? encrypt(input.addressLine2.trim())
        : null;
    }
    if (input.city !== undefined) {
      updates.city = input.city?.trim() ?? null;
    }
    if (input.state !== undefined) {
      updates.state = input.state?.toUpperCase().trim() ?? null;
    }
    if (input.zip !== undefined) {
      updates.zip = input.zip?.trim() ?? null;
    }
    if (input.country !== undefined) {
      updates.country = input.country?.toUpperCase().trim() ?? 'US';
    }
    if (input.dateOfBirth !== undefined) {
      updates.dateOfBirth = input.dateOfBirth;
    }
    if (input.gender !== undefined) {
      updates.gender = input.gender;
    }
    if (input.socialAccounts !== undefined) {
      updates.socialAccounts = JSON.stringify(input.socialAccounts);
    }
    if (input.isActive !== undefined) {
      updates.isActive = input.isActive ? 1 : 0;
    }

    this.db
      .update(profiles)
      .set(updates)
      .where(eq(profiles.id, id))
      .run();

    logger.info({ profileId: id }, 'Profile updated');

    const updated = await this.getById(id);
    if (!updated) {
      throw new ValidationError(`Profile ${id} not found after update`, 'id', id);
    }
    return updated;
  }

  /**
   * Deletes a profile by ID.
   */
  async delete(id: string): Promise<void> {
    this.db.delete(profiles).where(eq(profiles.id, id)).run();
    logger.info({ profileId: id }, 'Profile deleted');
  }

  /**
   * Returns all profiles where is_active = 1.
   */
  async getActive(): Promise<Profile[]> {
    const rows = this.db
      .select()
      .from(profiles)
      .where(eq(profiles.isActive, 1))
      .all();

    return rows.map((row) => this.rowToProfile(row));
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private validateCreateInput(input: ProfileCreateInput): void {
    if (!input.firstName || input.firstName.trim().length === 0) {
      throw new ValidationError('First name is required', 'firstName');
    }
    if (!input.lastName || input.lastName.trim().length === 0) {
      throw new ValidationError('Last name is required', 'lastName');
    }
    if (!input.email || input.email.trim().length === 0) {
      throw new ValidationError('Email is required', 'email');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(input.email.trim())) {
      throw new ValidationError(
        'Invalid email format',
        'email',
        input.email,
      );
    }

    if (input.state && !/^[A-Z]{2}$/i.test(input.state.trim())) {
      throw new ValidationError(
        'State must be a 2-letter code',
        'state',
        input.state,
      );
    }

    if (input.zip && !/^\d{5}(-\d{4})?$/.test(input.zip.trim())) {
      throw new ValidationError(
        'ZIP must be 5 digits or 5+4 format',
        'zip',
        input.zip,
      );
    }
  }

  /**
   * Converts a raw database row to a Profile, decrypting encrypted fields.
   */
  private rowToProfile(row: Record<string, unknown>): Profile {
    let addressLine1: string | null = null;
    let addressLine2: string | null = null;

    if (row.addressLine1 && typeof row.addressLine1 === 'string') {
      try {
        addressLine1 = decrypt(row.addressLine1);
      } catch {
        // If decryption fails, it may be stored unencrypted (legacy data)
        addressLine1 = row.addressLine1;
      }
    }

    if (row.addressLine2 && typeof row.addressLine2 === 'string') {
      try {
        addressLine2 = decrypt(row.addressLine2);
      } catch {
        addressLine2 = row.addressLine2;
      }
    }

    let emailAliases: string[] = [];
    if (typeof row.emailAliases === 'string') {
      try {
        emailAliases = JSON.parse(row.emailAliases) as string[];
      } catch {
        emailAliases = [];
      }
    }

    let socialAccounts: Record<string, string> = {};
    if (typeof row.socialAccounts === 'string') {
      try {
        socialAccounts = JSON.parse(row.socialAccounts) as Record<
          string,
          string
        >;
      } catch {
        socialAccounts = {};
      }
    }

    return {
      id: row.id as string,
      firstName: row.firstName as string,
      lastName: row.lastName as string,
      email: row.email as string,
      emailAliases,
      phone: (row.phone as string | null) ?? null,
      phoneProvider: (row.phoneProvider as string | null) ?? null,
      addressLine1,
      addressLine2,
      city: (row.city as string | null) ?? null,
      state: (row.state as string | null) ?? null,
      zip: (row.zip as string | null) ?? null,
      country: (row.country as string) ?? 'US',
      dateOfBirth: (row.dateOfBirth as string | null) ?? null,
      gender: (row.gender as string | null) ?? null,
      socialAccounts,
      isActive: row.isActive === 1,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
  }
}
