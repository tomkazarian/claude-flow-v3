import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../../shared/errors.js';
import { getLogger } from '../../shared/logger.js';

const logger = getLogger('server', { component: 'error-handler' });

interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Maps known AppError subclasses to HTTP status codes. Falls back to
 * the error's own statusCode when available, or 500 for unknown errors.
 */
function resolveStatusCode(error: unknown): number {
  if (error instanceof AppError) {
    return error.statusCode;
  }

  // Fastify validation errors come with a statusCode of 400
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const code = (error as { statusCode: unknown }).statusCode;
    if (typeof code === 'number' && code >= 400 && code < 600) {
      return code;
    }
  }

  return 500;
}

/**
 * Extracts a machine-readable error code from the error.
 */
function resolveErrorCode(error: unknown): string {
  if (error instanceof AppError) {
    return error.code;
  }

  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string') {
      return code;
    }
  }

  return 'INTERNAL_ERROR';
}

/**
 * Builds the user-facing error message. In production, internal errors
 * get a generic message to avoid leaking implementation details.
 */
function resolveMessage(error: unknown, statusCode: number): string {
  if (error instanceof AppError) {
    return error.message;
  }

  if (error instanceof Error) {
    if (statusCode >= 500 && process.env['NODE_ENV'] === 'production') {
      return 'An unexpected error occurred';
    }
    return error.message;
  }

  return 'An unexpected error occurred';
}

/**
 * Global Fastify error handler. Registered as `app.setErrorHandler()`.
 *
 * - Maps AppError subclasses to appropriate HTTP status codes
 * - Formats errors into a consistent JSON envelope
 * - Logs errors with context (request ID, URL, method)
 * - Never leaks stack traces in production
 */
export function globalErrorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const statusCode = resolveStatusCode(error);
  const code = resolveErrorCode(error);
  const message = resolveMessage(error, statusCode);

  // Log with context
  const logContext = {
    err: error,
    statusCode,
    code,
    requestId: request.id,
    method: request.method,
    url: request.url,
  };

  if (statusCode >= 500) {
    logger.error(logContext, `Server error: ${message}`);
  } else if (statusCode >= 400) {
    logger.warn(logContext, `Client error: ${message}`);
  }

  const body: ErrorResponseBody = {
    error: {
      code,
      message,
    },
  };

  // Attach validation details for 400/422 errors
  if (
    statusCode === 400 ||
    statusCode === 422
  ) {
    if ('validation' in error && error.validation) {
      body.error.details = error.validation;
    } else if (error instanceof AppError && 'field' in error) {
      body.error.details = { field: (error as AppError & { field: string }).field };
    }
  }

  // In development, include the stack trace
  if (process.env['NODE_ENV'] !== 'production' && error.stack) {
    (body.error as Record<string, unknown>)['stack'] = error.stack;
  }

  void reply.status(statusCode).send(body);
}
