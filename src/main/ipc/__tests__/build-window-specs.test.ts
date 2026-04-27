import { describe, it, expect } from 'vitest';
import { buildWindowSpecs } from '../build-window-specs';
import type { Preferences, Workspace } from '../../domain/types';
import type { TabConfig } from '../../domain/tab-config';
import type { RepoConfig } from '../../domain/repo-config';

const seededDefaults: TabConfig[] = [
  { id: '1', name: 'Claude Code', kind: 'claude', appliesTo: 'both' },
  { id: '2', name: 'Git', kind: 'command', command: 'lazygit', appliesTo: 'repository' },
  { id: '3', name: 'Shell', kind: 'command', appliesTo: 'both' },
];

const prefs = (defaultTabs?: TabConfig[]): Preferences => ({ defaultTabs });
const ws = (defaultTabs?: TabConfig[]): Workspace => ({
  id: 'w',
  name: 'W',
  directory: '/tmp',
  defaultTabs,
});

describe('buildWindowSpecs — workspace sessions', () => {
  it('uses global defaults when no workspace override', () => {
    const result = buildWindowSpecs({
      type: 'workspace',
      workspace: ws(),
      preferences: prefs(seededDefaults),
      repoConfig: null,
    });
    // Git is filtered out (appliesTo: 'repository')
    expect(result.map((w) => w.name)).toEqual(['Claude Code', 'Shell']);
  });

  it('uses workspace override when set, replacing globals', () => {
    const override: TabConfig[] = [
      { id: 'a', name: 'Notes', kind: 'command', appliesTo: 'standalone' },
    ];
    const result = buildWindowSpecs({
      type: 'workspace',
      workspace: ws(override),
      preferences: prefs(seededDefaults),
      repoConfig: null,
    });
    expect(result).toEqual([{ name: 'Notes', kind: 'command' }]);
  });

  it('attaches claudeSessionId to the first claude tab', () => {
    const result = buildWindowSpecs({
      type: 'workspace',
      workspace: ws(),
      preferences: prefs(seededDefaults),
      repoConfig: null,
      claudeSessionId: 'abc',
    });
    expect(result[0]).toEqual({
      name: 'Claude Code',
      kind: 'claude',
      claudeSessionId: 'abc',
    });
  });

  it('handles no claude tab in defaults gracefully', () => {
    const tabsNoClaude: TabConfig[] = [
      { id: 'x', name: 'Shell', kind: 'command', appliesTo: 'both' },
    ];
    const result = buildWindowSpecs({
      type: 'workspace',
      workspace: ws(),
      preferences: prefs(tabsNoClaude),
      repoConfig: null,
      claudeSessionId: 'abc',
    });
    expect(result).toEqual([{ name: 'Shell', kind: 'command' }]);
  });

  it('returns empty list when no defaults at all', () => {
    const result = buildWindowSpecs({
      type: 'workspace',
      workspace: null,
      preferences: prefs(),
      repoConfig: null,
    });
    expect(result).toEqual([]);
  });
});

describe('buildWindowSpecs — repo sessions (slice C)', () => {
  it('uses RepoConfig.tabs when set, replacing globals', () => {
    const repoConfig: RepoConfig = {
      tabs: [{ id: 'r1', name: 'Tests', kind: 'command', command: 'npm test', appliesTo: 'repository' }],
    };
    const result = buildWindowSpecs({
      type: 'directory',
      workspace: null,
      preferences: prefs(seededDefaults),
      repoConfig,
    });
    expect(result).toEqual([{ name: 'Tests', kind: 'command', command: 'npm test' }]);
  });

  it('falls back to global defaults filtered by repository scope when no override', () => {
    const result = buildWindowSpecs({
      type: 'directory',
      workspace: null,
      preferences: prefs(seededDefaults),
      repoConfig: null,
    });
    // Standalone-only tabs (none here), repository-only, and both — Claude(both) + Git(repo) + Shell(both)
    expect(result.map((w) => w.name)).toEqual(['Claude Code', 'Git', 'Shell']);
  });

  it('worktree sessions use the same resolution as directory sessions', () => {
    const result = buildWindowSpecs({
      type: 'worktree',
      workspace: null,
      preferences: prefs(seededDefaults),
      repoConfig: null,
    });
    expect(result.map((w) => w.name)).toEqual(['Claude Code', 'Git', 'Shell']);
  });

  it('attaches claudeSessionId to the Claude tab on repo sessions', () => {
    const result = buildWindowSpecs({
      type: 'directory',
      workspace: null,
      preferences: prefs(seededDefaults),
      repoConfig: null,
      claudeSessionId: 'xyz',
    });
    const claude = result.find((w) => w.name === 'Claude Code');
    expect(claude).toEqual({ name: 'Claude Code', kind: 'claude', claudeSessionId: 'xyz' });
  });

  it('honors an empty repo override tabs list as zero tabs (no fallback)', () => {
    const result = buildWindowSpecs({
      type: 'directory',
      workspace: null,
      preferences: prefs(seededDefaults),
      repoConfig: { tabs: [] },
    });
    expect(result).toEqual([]);
  });

  it('honors an empty workspace override as zero tabs', () => {
    const result = buildWindowSpecs({
      type: 'workspace',
      workspace: ws([]),
      preferences: prefs(seededDefaults),
      repoConfig: null,
    });
    expect(result).toEqual([]);
  });

  it('falls back to globals when repo override exists but tabs field is undefined', () => {
    const result = buildWindowSpecs({
      type: 'directory',
      workspace: null,
      preferences: prefs(seededDefaults),
      // RepoConfig with env but no tabs field — tabs: undefined
      repoConfig: { env: { FOO: 'bar' } },
    });
    expect(result.map((w) => w.name)).toEqual(['Claude Code', 'Git', 'Shell']);
  });
});
