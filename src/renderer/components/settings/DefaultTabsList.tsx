import { useCallback, useRef } from 'react';
import { Trash2, Plus, GripVertical } from 'lucide-react';
import { SortableItem } from '../sidebar/SortableItem';
import { reorderList } from '../../lib/reorder-list';
import type { TabConfig } from '../../../main/domain/tab-config';

interface Props {
  tabs: TabConfig[];
  scope: string;
  onChange: (tabs: TabConfig[]) => void;
}

const NOOP = () => {};

function makeId(): string {
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

interface TabRowProps {
  tab: TabConfig;
  scope: string;
  onUpdate: (patch: Partial<TabConfig>) => void;
  onChangeKind: (kind: 'claude' | 'command') => void;
  onRemove: () => void;
  onReorder: (draggedId: string, targetId: string, edge: 'top' | 'bottom') => void;
}

function TabRow({ tab, scope, onUpdate, onChangeKind, onRemove, onReorder }: TabRowProps) {
  const handleRef = useRef<HTMLSpanElement>(null);

  return (
    <SortableItem
      dragType="default-tab"
      itemId={tab.id}
      scope={scope}
      dragHandleRef={handleRef}
      onReorder={onReorder}
      onDropEffect={NOOP}
    >
      <div className="flex items-center gap-2 p-2 border border-border rounded bg-card">
        <span
          ref={handleRef}
          aria-label={`Drag handle for ${tab.name}`}
          className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing flex items-center"
        >
          <GripVertical size={14} />
        </span>

        <input
          aria-label={`Name for ${tab.name}`}
          value={tab.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          className="flex-1 min-w-0 px-2 py-1 text-sm bg-background border border-input rounded text-foreground"
          placeholder="Tab name"
        />

        <select
          aria-label={`Kind for ${tab.name}`}
          value={tab.kind}
          onChange={(e) => onChangeKind(e.target.value as 'claude' | 'command')}
          className="px-2 py-1 text-sm bg-background border border-input rounded text-foreground"
        >
          <option value="claude">Claude</option>
          <option value="command">Command</option>
        </select>

        {tab.kind === 'claude' ? (
          <input
            aria-label={`Args for ${tab.name}`}
            value={tab.args ?? ''}
            onChange={(e) => onUpdate({ args: e.target.value || undefined })}
            placeholder="extra flags (e.g. --dangerously-skip-permissions)"
            className="flex-[2] min-w-0 px-2 py-1 text-sm bg-background border border-input rounded text-foreground"
          />
        ) : (
          <input
            aria-label={`Command for ${tab.name}`}
            value={tab.command ?? ''}
            onChange={(e) => onUpdate({ command: e.target.value || undefined })}
            placeholder="command (empty = shell at cwd)"
            className="flex-[2] min-w-0 px-2 py-1 text-sm bg-background border border-input rounded text-foreground"
          />
        )}

        <select
          aria-label={`Applies to for ${tab.name}`}
          value={tab.appliesTo}
          onChange={(e) => onUpdate({ appliesTo: e.target.value as TabConfig['appliesTo'] })}
          className="px-2 py-1 text-sm bg-background border border-input rounded text-foreground"
        >
          <option value="both">Both</option>
          <option value="standalone">Standalone</option>
          <option value="repository">Repository</option>
        </select>

        <button
          aria-label={`Delete tab ${tab.name}`}
          onClick={onRemove}
          className="p-1 text-muted-foreground hover:text-destructive bg-transparent border-none cursor-pointer"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </SortableItem>
  );
}

export function DefaultTabsList({ tabs, scope, onChange }: Props) {
  function updateById(id: string, patch: Partial<TabConfig>): void {
    onChange(tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function changeKindById(id: string, kind: 'claude' | 'command'): void {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    const next: TabConfig =
      kind === 'claude'
        ? {
            id: tab.id,
            name: tab.name,
            kind: 'claude',
            appliesTo: tab.appliesTo,
            ...(tab.args ? { args: tab.args } : {}),
          }
        : {
            id: tab.id,
            name: tab.name,
            kind: 'command',
            appliesTo: tab.appliesTo,
            ...(tab.command ? { command: tab.command } : {}),
          };
    onChange(tabs.map((t) => (t.id === id ? next : t)));
  }

  function add(): void {
    onChange([...tabs, newTab()]);
  }

  function removeById(id: string): void {
    onChange(tabs.filter((t) => t.id !== id));
  }

  const handleReorder = useCallback(
    (draggedId: string, targetId: string, edge: 'top' | 'bottom') => {
      const ids = tabs.map((t) => t.id);
      const nextIds = reorderList(ids, draggedId, targetId, edge);
      const byId = new Map(tabs.map((t) => [t.id, t]));
      onChange(nextIds.map((id) => byId.get(id)!));
    },
    [tabs, onChange],
  );

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
      {tabs.map((tab) => (
        <TabRow
          key={tab.id}
          tab={tab}
          scope={scope}
          onUpdate={(patch) => updateById(tab.id, patch)}
          onChangeKind={(kind) => changeKindById(tab.id, kind)}
          onRemove={() => removeById(tab.id)}
          onReorder={handleReorder}
        />
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
