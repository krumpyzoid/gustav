import { Trash2, Plus } from 'lucide-react';
import type { TabConfig } from '../../../main/domain/tab-config';

interface Props {
  tabs: TabConfig[];
  onChange: (tabs: TabConfig[]) => void;
}

function makeId(): string {
  // Crypto API is available in renderer (Electron exposes it).
  return crypto.randomUUID();
}

function newTab(): TabConfig {
  return {
    id: makeId(),
    name: 'New Tab',
    kind: 'command',
    appliesTo: 'both',
  };
}

export function DefaultTabsList({ tabs, onChange }: Props) {
  function update(idx: number, patch: Partial<TabConfig>): void {
    onChange(tabs.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  }

  function changeKind(idx: number, kind: 'claude' | 'command'): void {
    const tab = tabs[idx];
    // Strip kind-specific fields when switching
    const next: TabConfig =
      kind === 'claude'
        ? { id: tab.id, name: tab.name, kind: 'claude', appliesTo: tab.appliesTo, ...(tab.args ? { args: tab.args } : {}) }
        : { id: tab.id, name: tab.name, kind: 'command', appliesTo: tab.appliesTo, ...(tab.command ? { command: tab.command } : {}) };
    onChange(tabs.map((t, i) => (i === idx ? next : t)));
  }

  function add(): void {
    onChange([...tabs, newTab()]);
  }

  function remove(idx: number): void {
    onChange(tabs.filter((_, i) => i !== idx));
  }

  if (tabs.length === 0) {
    return (
      <div>
        <p className="text-sm text-muted-foreground mb-3">No tabs configured.</p>
        <button
          onClick={add}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-secondary text-secondary-foreground rounded hover:bg-muted cursor-pointer border-none"
        >
          <Plus size={14} /> Add tab
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {tabs.map((tab, idx) => (
        <div
          key={tab.id}
          className="flex items-center gap-2 p-2 border border-border rounded bg-card"
        >
          <input
            aria-label={`Name for ${tab.name}`}
            value={tab.name}
            onChange={(e) => update(idx, { name: e.target.value })}
            className="flex-1 min-w-0 px-2 py-1 text-sm bg-background border border-input rounded text-foreground"
            placeholder="Tab name"
          />

          <select
            aria-label={`Kind for ${tab.name}`}
            value={tab.kind}
            onChange={(e) => changeKind(idx, e.target.value as 'claude' | 'command')}
            className="px-2 py-1 text-sm bg-background border border-input rounded text-foreground"
          >
            <option value="claude">Claude</option>
            <option value="command">Command</option>
          </select>

          {tab.kind === 'claude' ? (
            <input
              aria-label={`Args for ${tab.name}`}
              value={tab.args ?? ''}
              onChange={(e) => update(idx, { args: e.target.value || undefined })}
              placeholder="extra flags (e.g. --dangerously-skip-permissions)"
              className="flex-[2] min-w-0 px-2 py-1 text-sm bg-background border border-input rounded text-foreground"
            />
          ) : (
            <input
              aria-label={`Command for ${tab.name}`}
              value={tab.command ?? ''}
              onChange={(e) => update(idx, { command: e.target.value || undefined })}
              placeholder="command (empty = shell at cwd)"
              className="flex-[2] min-w-0 px-2 py-1 text-sm bg-background border border-input rounded text-foreground"
            />
          )}

          <select
            aria-label={`Applies to for ${tab.name}`}
            value={tab.appliesTo}
            onChange={(e) =>
              update(idx, { appliesTo: e.target.value as TabConfig['appliesTo'] })
            }
            className="px-2 py-1 text-sm bg-background border border-input rounded text-foreground"
          >
            <option value="both">Both</option>
            <option value="standalone">Standalone</option>
            <option value="repository">Repository</option>
          </select>

          <button
            aria-label={`Delete tab ${tab.name}`}
            onClick={() => remove(idx)}
            className="p-1 text-muted-foreground hover:text-destructive bg-transparent border-none cursor-pointer"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}

      <button
        onClick={add}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-secondary text-secondary-foreground rounded hover:bg-muted cursor-pointer border-none"
      >
        <Plus size={14} /> Add tab
      </button>
    </div>
  );
}
