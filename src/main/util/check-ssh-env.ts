/**
 * Pure check for whether the running process has the env vars needed for git
 * operations over ssh. Designed to run once at startup so the operator gets
 * a fast signal — well before any worktree-create attempt fails with raw ssh
 * stderr in a UI dialog.
 *
 * Today we only check `SSH_AUTH_SOCK`. Other vars (e.g. `GIT_SSH_COMMAND`)
 * are irrelevant unless the user has them set up explicitly — we don't want
 * to warn loudly about defaults.
 */

const REQUIRED_VARS = ['SSH_AUTH_SOCK'] as const;
type RequiredVar = (typeof REQUIRED_VARS)[number];

export type SshEnvCheckResult =
  | { ok: true }
  | { ok: false; missing: RequiredVar[] };

export function checkSshEnv({ env }: { env: NodeJS.ProcessEnv | Record<string, string | undefined> }): SshEnvCheckResult {
  const missing = REQUIRED_VARS.filter((key) => {
    const v = env[key];
    return v === undefined || v === '';
  });
  if (missing.length === 0) return { ok: true };
  return { ok: false, missing };
}

export function formatSshEnvWarning(result: SshEnvCheckResult): string | null {
  if (result.ok) return null;
  return (
    `[gustav] ${result.missing.join(', ')} is not set in this process — ` +
    'git operations over ssh (worktree create, fetch) will fail with no agent. ' +
    'Launch Gustav from a shell that exports the agent, or run `ssh-add` first.'
  );
}
