import type { WindowSpec } from './types';

export type TabConfig = {
  id: string;
  name: string;
  kind: 'claude' | 'command';
  command?: string;
  args?: string;
  appliesTo: 'standalone' | 'repository' | 'both';
};

export type TabScope = 'standalone' | 'repository';

/** Keep only tabs that apply to the given session scope. */
export function filterTabsByScope(tabs: TabConfig[], scope: TabScope): TabConfig[] {
  return tabs.filter((t) => t.appliesTo === scope || t.appliesTo === 'both');
}

/**
 * Convert a TabConfig into a WindowSpec. Curried by claudeSessionId so the
 * same id is attached to the *first* claude tab in a list, mirroring the way
 * the Claude session tracker scans for the primary Claude window.
 */
export function tabConfigToWindowSpec(claudeSessionId?: string) {
  return (tab: TabConfig, idx: number, all: TabConfig[]): WindowSpec => {
    if (tab.kind === 'claude') {
      const isFirstClaude = all.findIndex((t) => t.kind === 'claude') === idx;
      return {
        name: tab.name,
        kind: 'claude',
        ...(tab.args ? { args: tab.args } : {}),
        ...(isFirstClaude && claudeSessionId ? { claudeSessionId } : {}),
      };
    }
    return {
      name: tab.name,
      kind: 'command',
      ...(tab.command ? { command: tab.command } : {}),
    };
  };
}
