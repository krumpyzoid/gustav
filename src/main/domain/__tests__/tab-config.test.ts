import { describe, it, expect } from 'vitest';
import {
  tabConfigToWindowSpec,
  filterTabsByScope,
  type TabConfig,
} from '../tab-config';

const claudeTab: TabConfig = { id: '1', name: 'Claude Code', kind: 'claude', appliesTo: 'both' };
const gitTab: TabConfig = { id: '2', name: 'Git', kind: 'command', command: 'lazygit', appliesTo: 'repository' };
const shellTab: TabConfig = { id: '3', name: 'Shell', kind: 'command', appliesTo: 'both' };
const standaloneTab: TabConfig = { id: '4', name: 'Notes', kind: 'command', appliesTo: 'standalone' };

describe('filterTabsByScope', () => {
  it('returns tabs with appliesTo "both" or matching scope', () => {
    const list = [claudeTab, gitTab, shellTab, standaloneTab];
    expect(filterTabsByScope(list, 'standalone').map((t) => t.name)).toEqual([
      'Claude Code',
      'Shell',
      'Notes',
    ]);
    expect(filterTabsByScope(list, 'repository').map((t) => t.name)).toEqual([
      'Claude Code',
      'Git',
      'Shell',
    ]);
  });

  it('returns empty when nothing matches', () => {
    expect(filterTabsByScope([gitTab], 'standalone')).toEqual([]);
  });
});

describe('tabConfigToWindowSpec', () => {
  const map = (tabs: TabConfig[], claudeSessionId?: string) =>
    tabs.map(tabConfigToWindowSpec(claudeSessionId));

  it('returns empty array for empty input', () => {
    expect(map([])).toEqual([]);
  });

  it('maps a claude tab without id to kind:claude with no claudeSessionId', () => {
    expect(map([claudeTab])).toEqual([{ name: 'Claude Code', kind: 'claude' }]);
  });

  it('attaches claudeSessionId only to the first claude tab', () => {
    const tabs: TabConfig[] = [
      claudeTab,
      { id: 'extra', name: 'Claude 2', kind: 'claude', appliesTo: 'both' },
    ];
    const result = map(tabs, 'abc');
    expect(result).toEqual([
      { name: 'Claude Code', kind: 'claude', claudeSessionId: 'abc' },
      { name: 'Claude 2', kind: 'claude' },
    ]);
  });

  it('preserves args on a claude tab', () => {
    const withArgs: TabConfig = {
      ...claudeTab,
      args: '--dangerously-skip-permissions',
    };
    expect(map([withArgs], 'abc')).toEqual([
      {
        name: 'Claude Code',
        kind: 'claude',
        args: '--dangerously-skip-permissions',
        claudeSessionId: 'abc',
      },
    ]);
  });

  it('maps a command tab with command', () => {
    expect(map([gitTab])).toEqual([{ name: 'Git', kind: 'command', command: 'lazygit' }]);
  });

  it('maps a command tab without command (shell at cwd)', () => {
    expect(map([shellTab])).toEqual([{ name: 'Shell', kind: 'command' }]);
  });

  it('does not attach claudeSessionId to command tabs', () => {
    const result = map([gitTab, claudeTab], 'abc');
    expect(result[0].claudeSessionId).toBeUndefined();
    expect(result[1]).toEqual({ name: 'Claude Code', kind: 'claude', claudeSessionId: 'abc' });
  });
});
