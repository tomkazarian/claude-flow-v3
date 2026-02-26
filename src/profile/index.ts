/**
 * Profile module public API.
 *
 * Provides CRUD management for user profiles, rotation strategies
 * for distributing entries, Gmail alias generation, and address validation.
 */

export {
  ProfileManager,
  type Profile,
  type ProfileCreateInput,
  type ProfileUpdateInput,
} from './profile-manager.js';

export {
  ProfileRotator,
  type RotationStrategy,
  type RotatorOptions,
} from './profile-rotator.js';

export { generateAliases } from './email-alias-generator.js';

export {
  validateAddress,
  type Address,
  type AddressValidation,
} from './address-validator.js';
