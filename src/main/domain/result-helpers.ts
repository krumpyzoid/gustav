import type { Result } from './types';

/**
 * Shared result constructors. `handlers.ts` and `command-dispatcher.ts`
 * both import these directly so the two paths cannot drift on the
 * Result envelope shape (e.g. one adding a `code` field while the other
 * forgets). If you change the Result type, this file is the single
 * place to mirror the change at construction sites.
 */

/** Wrap a value in a successful `Result`. */
export function ok<T>(data: T): Result<T> {
  return { success: true, data };
}

/** Wrap an error message in a failed `Result`. */
export function err(message: string): Result<never> {
  return { success: false, error: message };
}
