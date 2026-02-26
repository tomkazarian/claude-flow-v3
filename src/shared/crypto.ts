import {
  createCipheriv,
  createDecipheriv,
  createHash,
  pbkdf2Sync,
  randomBytes,
} from 'node:crypto';
import { ulid } from 'ulid';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recommended for GCM
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_SALT = 'sweepstakes-platform-salt-v1'; // static salt; real entropy comes from the key

/**
 * Derives a 256-bit key from the raw secret using PBKDF2.
 * The result is cached per raw key to avoid repeated CPU work.
 */
const derivedKeyCache = new Map<string, Buffer>();

function deriveKey(rawKey: string): Buffer {
  const cached = derivedKeyCache.get(rawKey);
  if (cached) {
    return cached;
  }

  const derived = pbkdf2Sync(
    rawKey,
    PBKDF2_SALT,
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    'sha512',
  );
  derivedKeyCache.set(rawKey, derived);
  return derived;
}

function getKey(overrideKey?: string): Buffer {
  const raw = overrideKey ?? process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'Encryption key not available. Set ENCRYPTION_KEY env var or pass a key argument.',
    );
  }
  return deriveKey(raw);
}

/**
 * Encrypts plaintext using AES-256-GCM.
 * Returns a base64-encoded string in the format `iv:authTag:ciphertext`.
 */
export function encrypt(plaintext: string, key?: string): string {
  const derivedKey = getKey(key);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, derivedKey, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const ivB64 = iv.toString('base64');
  const tagB64 = authTag.toString('base64');
  const cipherB64 = encrypted.toString('base64');

  return `${ivB64}:${tagB64}:${cipherB64}`;
}

/**
 * Decrypts a string previously encrypted with `encrypt()`.
 * Expects the base64-encoded `iv:authTag:ciphertext` format.
 */
export function decrypt(encryptedStr: string, key?: string): string {
  const derivedKey = getKey(key);
  const parts = encryptedStr.split(':');

  if (parts.length !== 3) {
    throw new Error(
      'Invalid encrypted string format. Expected base64 iv:authTag:ciphertext.',
    );
  }

  const [ivB64, tagB64, cipherB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(cipherB64, 'base64');

  const decipher = createDecipheriv(ALGORITHM, derivedKey, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

/**
 * Produces a hex-encoded SHA-256 hash.
 * Useful for deduplication checks where reversibility is unnecessary.
 */
export function hashForDedup(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Generates a Universally Unique Lexicographically Sortable Identifier.
 * ULIDs are time-ordered, which makes them ideal for database primary keys.
 */
export function generateId(): string {
  return ulid();
}
