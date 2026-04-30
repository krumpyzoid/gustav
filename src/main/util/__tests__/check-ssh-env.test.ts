import { describe, it, expect } from 'vitest';
import { checkSshEnv, formatSshEnvWarning } from '../check-ssh-env';

describe('checkSshEnv', () => {
  it('returns { ok: true } when SSH_AUTH_SOCK is set', () => {
    expect(checkSshEnv({ env: { SSH_AUTH_SOCK: '/run/user/1000/ssh-agent.sock' } })).toEqual({
      ok: true,
    });
  });

  it('returns { ok: false, missing: ["SSH_AUTH_SOCK"] } when unset', () => {
    expect(checkSshEnv({ env: {} })).toEqual({ ok: false, missing: ['SSH_AUTH_SOCK'] });
  });

  it('treats an empty SSH_AUTH_SOCK as unset', () => {
    expect(checkSshEnv({ env: { SSH_AUTH_SOCK: '' } })).toEqual({
      ok: false,
      missing: ['SSH_AUTH_SOCK'],
    });
  });
});

describe('formatSshEnvWarning', () => {
  it('returns null when the env is ok', () => {
    expect(formatSshEnvWarning({ ok: true })).toBeNull();
  });

  it('produces a one-line, actionable warning when SSH_AUTH_SOCK is missing', () => {
    const out = formatSshEnvWarning({ ok: false, missing: ['SSH_AUTH_SOCK'] });
    expect(out).not.toBeNull();
    expect(out).toMatch(/SSH_AUTH_SOCK/);
    expect(out).toMatch(/git.*ssh|ssh.*git/i);
    expect(out!.includes('\n')).toBe(false);
  });
});
