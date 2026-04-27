import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { DefaultTabsList } from '../settings/DefaultTabsList';
import type { Workspace } from '../../../main/domain/types';
import type { TabConfig } from '../../../main/domain/tab-config';

interface Props {
  workspace: Workspace;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

export function WorkspaceSettingsDialog({ workspace, open, onOpenChange, onSaved }: Props) {
  const [tabs, setTabs] = useState<TabConfig[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    (async () => {
      if (workspace.defaultTabs !== undefined) {
        setTabs(workspace.defaultTabs);
      } else {
        const prefs = await window.api.getPreferences();
        setTabs(prefs.defaultTabs ?? []);
      }
      setLoading(false);
    })();
  }, [open, workspace]);

  async function handleSave() {
    await window.api.setWorkspaceDefaultTabs(workspace.id, tabs);
    onSaved?.();
    onOpenChange(false);
  }

  async function handleResetToDefaults() {
    await window.api.setWorkspaceDefaultTabs(workspace.id, null);
    onSaved?.();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{workspace.name} — Settings</DialogTitle>
          <DialogDescription>
            Default tabs for sessions in this workspace. Seeded from global defaults on first open.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <h3 className="text-sm font-semibold text-foreground mb-3">Default Tabs</h3>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <DefaultTabsList
              tabs={tabs}
              scope={`default-tabs:workspace:${workspace.id}`}
              onChange={setTabs}
            />
          )}
        </div>

        <DialogFooter>
          <button
            onClick={handleResetToDefaults}
            className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground bg-transparent border-none cursor-pointer"
          >
            Reset to defaults
          </button>
          <div className="flex-1" />
          <button
            onClick={() => onOpenChange(false)}
            className="px-3 py-1.5 text-sm bg-secondary text-secondary-foreground rounded hover:bg-muted cursor-pointer border-none"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 cursor-pointer border-none disabled:opacity-50"
          >
            Save
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
