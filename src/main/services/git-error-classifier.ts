/**
 * Classifies errors thrown from git network operations (fetch, ls-remote, push, …).
 *
 * The motivating case is `git fetch origin` failing inside the Electron main
 * process when ssh has no working agent socket: ssh falls through to
 * publickey, then password, then ssh-askpass — which on a typical Arch desktop
 * is not installed. The user-visible error in the UI is unhelpful raw stderr;
 * a structured error lets the renderer say "ssh agent isn't reachable" instead.
 *
 * Pure helper — no I/O. Reuse from any service that calls into a git network op.
 */

export const GitFetchErrorCode = {
  SshAgentUnavailable: 'SSH_AGENT_UNAVAILABLE',
} as const;

export type GitFetchErrorCodeValue = (typeof GitFetchErrorCode)[keyof typeof GitFetchErrorCode];

export interface ClassifiedGitError extends Error {
  code: GitFetchErrorCodeValue;
  cause?: unknown;
}

/**
 * Returns a `ClassifiedGitError` (with `code` set) when the underlying error
 * matches a known signature; otherwise returns the original error so callers
 * can `throw classify(e)` unconditionally without losing context.
 *
 * Inputs that aren't `Error` instances are wrapped before pattern-matching so
 * callers don't have to pre-validate.
 */
export function classifyGitFetchError(err: unknown): Error {
  const original = toError(err);
  const text = original.message ?? '';

  if (looksLikeSshAuthFailure(text)) {
    const wrapped = new Error(
      'git fetch failed: ssh agent is not reachable from Gustav. ' +
        'Ensure SSH_AUTH_SOCK is set in the process that launched the app, ' +
        'or run `ssh-add` in the same shell session that launched Gustav.',
    ) as ClassifiedGitError;
    wrapped.code = GitFetchErrorCode.SshAgentUnavailable;
    wrapped.cause = original;
    return wrapped;
  }

  return original;
}

function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === 'string') return new Error(err);
  return new Error(String(err ?? 'unknown error'));
}

function looksLikeSshAuthFailure(text: string): boolean {
  // Two strong signals seen in the wild:
  //  1. ssh-askpass invocation (SSH had to fall back from agent → password)
  //  2. "Permission denied (publickey…)" from the remote
  // Either alone is sufficient — we don't require both because some ssh
  // configs suppress askpass entirely (SSH_ASKPASS_REQUIRE=never).
  return /ssh_askpass:/i.test(text) || /Permission denied \(publickey/i.test(text);
}
