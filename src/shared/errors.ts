/**
 * Base application error. All domain-specific errors extend this class.
 *
 * - `code`          short machine-readable identifier (e.g. "CAPTCHA_TIMEOUT")
 * - `statusCode`    HTTP-compatible status code for API responses
 * - `isOperational` true = expected/recoverable, false = programmer error
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly timestamp: string;

  constructor(
    message: string,
    code: string,
    statusCode = 500,
    isOperational = true,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.timestamp = new Date().toISOString();

    // Maintains proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      isOperational: this.isOperational,
      timestamp: this.timestamp,
      ...(process.env['NODE_ENV'] !== 'production' ? { stack: this.stack } : {}),
    };
  }
}

export class EntryError extends AppError {
  public readonly contestId: string;
  public readonly entryId?: string;

  constructor(
    message: string,
    code: string,
    contestId: string,
    entryId?: string,
    statusCode = 400,
  ) {
    super(message, code, statusCode);
    this.contestId = contestId;
    this.entryId = entryId;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      contestId: this.contestId,
      entryId: this.entryId,
    };
  }
}

export class CaptchaError extends AppError {
  public readonly captchaType: string;
  public readonly provider: string;

  constructor(
    message: string,
    code: string,
    captchaType: string,
    provider: string,
    statusCode = 502,
  ) {
    super(message, code, statusCode);
    this.captchaType = captchaType;
    this.provider = provider;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      captchaType: this.captchaType,
      provider: this.provider,
    };
  }
}

export class ProxyError extends AppError {
  public readonly proxyHost: string;

  constructor(
    message: string,
    code: string,
    proxyHost: string,
    statusCode = 502,
  ) {
    super(message, code, statusCode);
    this.proxyHost = proxyHost;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      proxyHost: this.proxyHost,
    };
  }
}

export class ComplianceError extends AppError {
  public readonly rule: string;
  public readonly contestId?: string;

  constructor(
    message: string,
    code: string,
    rule: string,
    contestId?: string,
    statusCode = 403,
  ) {
    super(message, code, statusCode);
    this.rule = rule;
    this.contestId = contestId;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      rule: this.rule,
      contestId: this.contestId,
    };
  }
}

export class DiscoveryError extends AppError {
  public readonly source: string;

  constructor(
    message: string,
    code: string,
    source: string,
    statusCode = 502,
  ) {
    super(message, code, statusCode);
    this.source = source;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      source: this.source,
    };
  }
}

export class EmailError extends AppError {
  public readonly emailAddress: string;

  constructor(
    message: string,
    code: string,
    emailAddress: string,
    statusCode = 502,
  ) {
    super(message, code, statusCode);
    this.emailAddress = emailAddress;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      emailAddress: this.emailAddress,
    };
  }
}

export class SmsError extends AppError {
  public readonly phoneNumber: string;

  constructor(
    message: string,
    code: string,
    phoneNumber: string,
    statusCode = 502,
  ) {
    super(message, code, statusCode);
    this.phoneNumber = phoneNumber;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      phoneNumber: this.phoneNumber,
    };
  }
}

export class BrowserError extends AppError {
  public readonly url: string;
  public readonly screenshotPath?: string;

  constructor(
    message: string,
    code: string,
    url: string,
    screenshotPath?: string,
    statusCode = 500,
  ) {
    super(message, code, statusCode);
    this.url = url;
    this.screenshotPath = screenshotPath;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      url: this.url,
      screenshotPath: this.screenshotPath,
    };
  }
}

export class ValidationError extends AppError {
  public readonly field: string;
  public readonly value: unknown;

  constructor(
    message: string,
    field: string,
    value?: unknown,
    statusCode = 422,
  ) {
    super(message, 'VALIDATION_ERROR', statusCode);
    this.field = field;
    this.value = value;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      field: this.field,
      value: this.value,
    };
  }
}

/**
 * Type guard to distinguish operational errors (expected) from
 * programmer errors (bugs). Used by top-level error handlers to
 * decide whether to restart the process.
 */
export function isOperationalError(error: unknown): boolean {
  if (error instanceof AppError) {
    return error.isOperational;
  }
  return false;
}
