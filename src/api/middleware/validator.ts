import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { ZodSchema, ZodError } from 'zod';

/**
 * Formats Zod validation errors into a structured array of field errors.
 */
function formatZodErrors(error: ZodError): Array<{ field: string; message: string }> {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

/**
 * Creates a Fastify preHandler hook that validates the request body
 * against a Zod schema. On failure, returns a 400 response with
 * detailed validation errors.
 */
export function validateBody<T>(schema: ZodSchema<T>): preHandlerHookHandler {
  return (request: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void) => {
    const result = schema.safeParse(request.body);

    if (!result.success) {
      void reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request body validation failed',
          details: formatZodErrors(result.error),
        },
      });
      return;
    }

    // Replace body with parsed + coerced data
    (request as { body: T }).body = result.data;
    done();
  };
}

/**
 * Creates a Fastify preHandler hook that validates the query string
 * parameters against a Zod schema. On failure, returns a 400 response
 * with detailed validation errors.
 */
export function validateQuery<T>(schema: ZodSchema<T>): preHandlerHookHandler {
  return (request: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void) => {
    const result = schema.safeParse(request.query);

    if (!result.success) {
      void reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Query parameter validation failed',
          details: formatZodErrors(result.error),
        },
      });
      return;
    }

    // Replace query with parsed + coerced data
    (request as { query: T }).query = result.data;
    done();
  };
}

/**
 * Creates a Fastify preHandler hook that validates route parameters
 * against a Zod schema. On failure, returns a 400 response with
 * detailed validation errors.
 */
export function validateParams<T>(schema: ZodSchema<T>): preHandlerHookHandler {
  return (request: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void) => {
    const result = schema.safeParse(request.params);

    if (!result.success) {
      void reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Route parameter validation failed',
          details: formatZodErrors(result.error),
        },
      });
      return;
    }

    // Replace params with parsed + coerced data
    (request as { params: T }).params = result.data;
    done();
  };
}
