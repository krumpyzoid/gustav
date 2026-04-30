import type { SessionTab } from '../../../main/domain/types';

/**
 * The renderer needs to dispatch to one of three "create a fresh session"
 * APIs (workspace / worktree / directory) depending on what kind of tab the
 * user clicked AND on what props the parent component happened to hand the
 * `SessionTab` instance. The decision is identical for local and remote
 * paths; the call sites just dispatch through their own transport — that's
 * why the selector is a pure helper rather than a method on each transport.
 *
 * Returning `{ kind: 'unsupported', reason }` instead of throwing lets the
 * caller surface the missing prop in a structured error (today the
 * conditional ladder silently no-op'd — see #18).
 */

export type CreateCallProps = {
  workspaceName?: string;
  workspaceDir?: string;
  repoRoot?: string;
};

export type CreateCallDescriptor =
  | {
      kind: 'workspace';
      workspaceName: string;
      workspaceDir: string;
      label: string | undefined;
    }
  | {
      kind: 'worktree';
      workspaceName: string;
      repoRoot: string;
      branch: string;
      worktreePath: string;
    }
  | {
      kind: 'directory';
      workspaceName: string;
      repoRoot: string;
    }
  | { kind: 'unsupported'; reason: string };

export function chooseCreateCall(
  tab: SessionTab,
  props: CreateCallProps,
): CreateCallDescriptor {
  if (tab.type === 'workspace') {
    if (!props.workspaceName) return unsupported('workspaceName missing for workspace tab');
    if (!props.workspaceDir) return unsupported('workspaceDir missing for workspace tab');
    // Workspace tabs whose tmuxSession is `<ws>/_ws` are the "default"
    // session for the workspace — no label. Any other suffix is a
    // user-named workspace session.
    const parts = tab.tmuxSession.split('/');
    const last = parts[parts.length - 1];
    const label = last === '_ws' ? undefined : last;
    return {
      kind: 'workspace',
      workspaceName: props.workspaceName,
      workspaceDir: props.workspaceDir,
      label,
    };
  }

  if (tab.type === 'worktree') {
    if (!props.workspaceName) return unsupported('workspaceName missing for worktree tab');
    if (!props.repoRoot) return unsupported('repoRoot missing for worktree tab');
    if (!tab.branch) return unsupported('branch missing for worktree tab');
    if (!tab.worktreePath) return unsupported('worktreePath missing for worktree tab');
    return {
      kind: 'worktree',
      workspaceName: props.workspaceName,
      repoRoot: props.repoRoot,
      branch: tab.branch,
      worktreePath: tab.worktreePath,
    };
  }

  if (tab.type === 'directory') {
    if (!props.workspaceName) return unsupported('workspaceName missing for directory tab');
    if (!props.repoRoot) return unsupported('repoRoot missing for directory tab');
    return {
      kind: 'directory',
      workspaceName: props.workspaceName,
      repoRoot: props.repoRoot,
    };
  }

  return unsupported(`unknown tab type: ${(tab as { type: string }).type}`);
}

function unsupported(reason: string): CreateCallDescriptor {
  return { kind: 'unsupported', reason };
}
