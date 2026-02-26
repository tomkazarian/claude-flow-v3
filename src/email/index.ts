/**
 * Email module public API.
 *
 * Provides Gmail OAuth2 integration, email monitoring for confirmations
 * and win notifications, confirmation link clicking, unsubscribe management,
 * and win detection.
 */

export {
  GmailClient,
  type GmailCredentials,
  type OAuthTokens,
  type GmailMessage,
  type Label,
} from './gmail-client.js';

export {
  EmailMonitor,
  type ConfirmationEmail,
  type WinEmail,
} from './email-monitor.js';

export {
  ConfirmationClicker,
  type BrowserPool,
} from './confirmation-clicker.js';

export {
  WinDetector,
  type PrizeDetails,
  type Win,
} from './win-detector.js';

export { UnsubscribeManager } from './unsubscribe-manager.js';
