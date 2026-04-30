import { describe, it, expect } from 'vitest';
import { classifyGitFetchError, GitFetchErrorCode } from '../git-error-classifier';

describe('classifyGitFetchError', () => {
  it('classifies ssh-askpass + permission denied as SSH_AGENT_UNAVAILABLE', () => {
    const raw = new Error(
      [
        'Command failed: git -C /repo fetch origin --quiet',
        'ssh_askpass: exec(/usr/lib/ssh/ssh-askpass): No such file or directory',
        'Permission denied, please try again.',
        'git@host: Permission denied (publickey,password).',
        'fatal: Could not read from remote repository.',
      ].join('\n'),
    );

    const classified = classifyGitFetchError(raw);

    expect(classified).not.toBe(raw);
    expect(classified).toBeInstanceOf(Error);
    expect((classified as Error & { code?: string }).code).toBe(GitFetchErrorCode.SshAgentUnavailable);
    expect(classified.message).toMatch(/ssh.?agent/i);
    expect((classified as Error & { cause?: unknown }).cause).toBe(raw);
  });

  it('classifies bare "Permission denied (publickey)" as SSH_AGENT_UNAVAILABLE', () => {
    const raw = new Error('git@github.com: Permission denied (publickey).');
    const classified = classifyGitFetchError(raw);
    expect((classified as Error & { code?: string }).code).toBe(GitFetchErrorCode.SshAgentUnavailable);
  });

  it('passes through unrelated git failures unchanged', () => {
    const raw = new Error('fatal: unable to access https://example/repo.git/: Could not resolve host');
    const classified = classifyGitFetchError(raw);
    expect(classified).toBe(raw);
  });

  it('passes through generic execFile failures unchanged', () => {
    const raw = new Error('Command failed: git -C /repo fetch origin --quiet\nfatal: not a git repository');
    expect(classifyGitFetchError(raw)).toBe(raw);
  });

  it('handles string and unknown inputs without throwing', () => {
    expect(classifyGitFetchError('boom')).toBeInstanceOf(Error);
    expect(classifyGitFetchError(null)).toBeInstanceOf(Error);
    expect(classifyGitFetchError(undefined)).toBeInstanceOf(Error);
  });
});
