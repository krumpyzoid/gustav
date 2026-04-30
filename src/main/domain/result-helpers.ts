import type { Result } from './types';

/** Wrap a value in a successful `Result`. */
export function ok<T>(data: T): Result<T> {
  return { success: true, data };
}

/** Wrap an error message in a failed `Result`. */
export function err(message: string): Result<never> {
  return { success: false, error: message };
}
