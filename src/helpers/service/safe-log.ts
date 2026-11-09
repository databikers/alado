import { AladoServerLogger } from '@dto';

function reportToConsole(loggerError: unknown, subject: unknown): void {
  try {
    console.error('alado: the configured logger failed while logging', loggerError, subject);
  } catch {
    // stderr itself is gone: nothing left to report to
  }
}

/**
 * Calls the configured logger without letting it end the process. Logger methods may be sync or
 * async: one that throws, or returns a promise that rejects (a transport that is down, ...), has its
 * own error and the subject it was logging reported on the console, so neither gets lost. `error`
 * falls back to `log` for loggers without one (only `log` is required).
 */
export function safeLog(logger: AladoServerLogger | undefined, level: 'error' | 'log', subject: unknown): void {
  let result: unknown;
  try {
    const method = level === 'error' && typeof logger?.error === 'function' ? logger.error : logger?.log;
    result = method?.call(logger, subject);
  } catch (loggerError) {
    reportToConsole(loggerError, subject);
    return;
  }
  if (result !== null && typeof result === 'object' && typeof (result as PromiseLike<unknown>).then === 'function') {
    (result as PromiseLike<unknown>).then(undefined, (loggerError: unknown) => reportToConsole(loggerError, subject));
  }
}
