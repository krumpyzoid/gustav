import type { Preferences, SessionType, WindowSpec, Workspace } from '../domain/types';
import type { RepoConfig } from '../domain/repo-config';
import { filterTabsByScope, tabConfigToWindowSpec } from '../domain/tab-config';

export type BuildWindowSpecsArgs = {
  type: SessionType;
  workspace: Workspace | null;
  preferences: Preferences;
  repoConfig: RepoConfig | null;
  claudeSessionId?: string;
};

/**
 * Build the list of window specs that bootstrap a new session.
 *
 * - Workspace-type sessions: workspace.defaultTabs ?? preferences.defaultTabs,
 *   filtered by appliesTo ∈ {standalone, both}.
 * - Repo-type sessions (directory/worktree): repoConfig.tabs ?? preferences.defaultTabs,
 *   filtered by appliesTo ∈ {repository, both}.
 *
 * An empty (or omitted) override tab list falls through to globals — the
 * service treats `set(_, [])` as a clear, but the resolver also handles a
 * stray empty list in memory.
 */
export function buildWindowSpecs(args: BuildWindowSpecsArgs): WindowSpec[] {
  const isRepoSession = args.type === 'directory' || args.type === 'worktree';
  const scope = isRepoSession ? 'repository' : 'standalone';

  const override = isRepoSession
    ? args.repoConfig?.tabs
    : args.workspace?.defaultTabs;

  // override === undefined → fall back to globals
  // override === [] → explicit zero-tabs override (no fallback)
  const list = override !== undefined ? override : args.preferences.defaultTabs ?? [];

  return filterTabsByScope(list, scope).map(tabConfigToWindowSpec(args.claudeSessionId));
}
