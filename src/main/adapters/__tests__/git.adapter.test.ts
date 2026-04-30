import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitAdapter } from '../git.adapter';
import type { ShellPort } from '../../ports/shell.port';

function makeShell(): ShellPort {
  return {
    exec: vi.fn().mockResolvedValue(''),
    execFile: vi.fn().mockResolvedValue(''),
    execSync: vi.fn().mockReturnValue(''),
  };
}

describe('GitAdapter — security: argv-based exec', () => {
  let shell: ShellPort;
  let git: GitAdapter;

  beforeEach(() => {
    shell = makeShell();
    git = new GitAdapter(shell);
  });

  it('getRepoRoot uses execFile (not exec) so a malicious cwd cannot inject', async () => {
    vi.mocked(shell.execFile).mockResolvedValueOnce('/some/repo/.git');
    vi.mocked(shell.execFile).mockResolvedValueOnce('/some/repo');

    await git.getRepoRoot("/tmp/repo'; rm -rf $HOME; '");

    expect(shell.execFile).toHaveBeenCalledWith('git', expect.arrayContaining(['-C', "/tmp/repo'; rm -rf $HOME; '"]));
    expect(shell.exec).not.toHaveBeenCalled();
  });

  it('getCurrentBranch routes through execFile', async () => {
    vi.mocked(shell.execFile).mockResolvedValueOnce('main');
    const out = await git.getCurrentBranch('/repo');
    expect(out).toBe('main');
    expect(shell.execFile).toHaveBeenCalledWith('git', ['-C', '/repo', 'rev-parse', '--abbrev-ref', 'HEAD']);
    expect(shell.exec).not.toHaveBeenCalled();
  });

  it('branchExists routes through execFile and never composes a shell string', async () => {
    vi.mocked(shell.execFile).mockResolvedValue('');
    await git.branchExists('/repo', "x'; rm -rf /; '");
    // First call: refs/heads
    expect(shell.execFile).toHaveBeenCalledWith('git', [
      '-C', '/repo', 'show-ref', '--verify', '--quiet', "refs/heads/x'; rm -rf /; '",
    ]);
    expect(shell.exec).not.toHaveBeenCalled();
  });

  it('worktreeAdd passes branch and base as argv (not shell-concatenated)', async () => {
    await git.worktreeAdd('/repo', '/path', "x'; rm -rf /; '", { newBranch: true, base: 'origin/main' });
    expect(shell.execFile).toHaveBeenCalledWith('git', [
      '-C', '/repo', 'worktree', 'add', '/path', '-b', "x'; rm -rf /; '", 'origin/main',
    ]);
    expect(shell.exec).not.toHaveBeenCalled();
  });

  it('worktreeRemove uses execFile', async () => {
    await git.worktreeRemove('/repo', '/path');
    expect(shell.execFile).toHaveBeenCalledWith('git', ['-C', '/repo', 'worktree', 'remove', '/path', '--force']);
    expect(shell.exec).not.toHaveBeenCalled();
  });

  it('branchDelete uses execFile', async () => {
    await git.branchDelete('/repo', "x'; danger; '");
    expect(shell.execFile).toHaveBeenCalledWith('git', ['-C', '/repo', 'branch', '-d', "x'; danger; '"]);
    expect(shell.exec).not.toHaveBeenCalled();
  });

  it('fetch uses execFile', async () => {
    await git.fetch('/repo', { prune: true });
    expect(shell.execFile).toHaveBeenCalledWith('git', ['-C', '/repo', 'fetch', 'origin', '--quiet', '--prune']);
    expect(shell.exec).not.toHaveBeenCalled();
  });

  it('listBranches uses execFile (no shell-quoted refspec)', async () => {
    vi.mocked(shell.execFile).mockResolvedValue('');
    await git.listBranches('/repo');
    expect(shell.execFile).toHaveBeenCalledWith('git', ['-C', '/repo', 'for-each-ref', '--format=%(refname:short)', 'refs/heads/']);
    expect(shell.exec).not.toHaveBeenCalled();
  });

  it('isBranchMerged uses execFile', async () => {
    vi.mocked(shell.execFile).mockResolvedValue('');
    await git.isBranchMerged('/repo', 'feat', 'main');
    expect(shell.execFile).toHaveBeenCalledWith('git', ['-C', '/repo', 'branch', '--merged', 'main']);
  });

  it('worktreeListPorcelain uses execFile', async () => {
    vi.mocked(shell.execFile).mockResolvedValue('');
    await git.worktreeListPorcelain('/repo');
    expect(shell.execFile).toHaveBeenCalledWith('git', ['-C', '/repo', 'worktree', 'list', '--porcelain']);
  });

  it('getUpstreams uses execFile', async () => {
    vi.mocked(shell.execFile).mockResolvedValue('main origin/main');
    await git.getUpstreams('/repo');
    expect(shell.execFile).toHaveBeenCalledWith('git', ['-C', '/repo', 'for-each-ref', '--format=%(refname:short) %(upstream:short)', 'refs/heads/']);
  });
});
