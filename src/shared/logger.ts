import pino, { type Logger, type LoggerOptions } from 'pino';

const isDevelopment = process.env.NODE_ENV !== 'production';

const errorSerializer = (error: unknown): Record<string, unknown> => {
  if (error instanceof Error) {
    return {
      type: error.constructor.name,
      message: error.message,
      stack: error.stack,
      ...(error as unknown as Record<string, unknown>),
    };
  }
  return { value: error };
};

const baseOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? 'info',
  serializers: {
    err: errorSerializer,
    error: errorSerializer,
  },
  formatters: {
    level(label) {
      return { level: label };
    },
    bindings(bindings) {
      return {
        pid: bindings.pid,
        hostname: bindings.hostname,
      };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isDevelopment
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss.l',
            ignore: 'pid,hostname',
            singleLine: false,
          },
        },
      }
    : {}),
};

const rootLogger: Logger = pino(baseOptions);

type ModuleName =
  | 'discovery'
  | 'entry'
  | 'captcha'
  | 'proxy'
  | 'email'
  | 'sms'
  | 'queue'
  | 'browser'
  | 'server'
  | 'crypto'
  | 'compliance'
  | 'notification'
  | 'analytics'
  | 'profile';

const childLoggerCache = new Map<string, Logger>();

/**
 * Creates or retrieves a cached child logger for a specific module.
 * Child loggers automatically include the module name in all log output.
 */
export function getLogger(module: ModuleName, bindings?: Record<string, unknown>): Logger {
  const cacheKey = bindings ? `${module}:${JSON.stringify(bindings)}` : module;

  const cached = childLoggerCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const child = rootLogger.child({ module, ...bindings });
  childLoggerCache.set(cacheKey, child);
  return child;
}

/**
 * Creates a child logger with a specific request ID for tracing
 * individual operations across the system.
 */
export function getRequestLogger(module: ModuleName, requestId: string): Logger {
  return rootLogger.child({ module, requestId });
}

export { rootLogger as logger };
export type { Logger };
