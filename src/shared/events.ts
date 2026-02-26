import EventEmitter from 'eventemitter3';

/**
 * All typed events emitted across the sweepstakes platform.
 * Keys are event names; values are the payload shape passed to listeners.
 */
export interface AppEvents {
  'contest:discovered': {
    contestId: string;
    url: string;
    source: string;
  };
  'contest:expired': {
    contestId: string;
  };
  'entry:queued': {
    contestId: string;
    profileId: string;
    jobId: string;
  };
  'entry:started': {
    contestId: string;
    profileId: string;
    entryId: string;
  };
  'entry:submitted': {
    entryId: string;
    contestId: string;
    profileId: string;
  };
  'entry:confirmed': {
    entryId: string;
  };
  'entry:failed': {
    entryId: string;
    error: string;
  };
  'win:detected': {
    entryId: string;
    prizeValue: number;
    prizeDescription: string;
  };
  'captcha:solving': {
    type: string;
    provider: string;
  };
  'captcha:solved': {
    type: string;
    provider: string;
    durationMs: number;
    cost: number;
  };
  'captcha:failed': {
    type: string;
    provider: string;
    error: string;
  };
  'proxy:rotated': {
    oldProxy: string;
    newProxy: string;
  };
  'proxy:failed': {
    proxy: string;
    error: string;
  };
  'email:confirmed': {
    entryId: string;
    emailId: string;
  };
  'sms:received': {
    phoneNumber: string;
    code: string;
  };
  'discovery:started': {
    source: string;
  };
  'discovery:completed': {
    source: string;
    contestsFound: number;
  };
  'queue:job:completed': {
    queue: string;
    jobId: string;
  };
  'queue:job:failed': {
    queue: string;
    jobId: string;
    error: string;
  };
}

/**
 * Strongly-typed event emitter. All code should use this singleton
 * rather than creating ad-hoc emitters so that cross-module
 * communication stays in one place and is fully typed.
 */
export class TypedEventEmitter extends EventEmitter<AppEvents> {}

export const eventBus = new TypedEventEmitter();
