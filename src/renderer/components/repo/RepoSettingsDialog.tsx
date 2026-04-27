import { useEffect, useState } from 'react';
import { Trash2, Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { DefaultTabsList } from '../settings/DefaultTabsList';
import { useAppStore } from '../../hooks/use-app-state';
import type { RepoConfig } from '../../../main/domain/repo-config';
import type { TabConfig } from '../../../main/domain/tab-config';
import type { BranchInfo } from '../../../main/domain/types';

interface Props {
  repoRoot: string;
  repoName: string;
  /** Originating workspace for seeding the parent tab list. null when the repo
   * is opened from outside any workspace context. */
  workspaceId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

type EnvRow = { key: string; value: string };

function envObjectToRows(env: Record<string, string> | undefined): EnvRow[] {
  return Object.entries(env ?? {}).map(([key, value]) => ({ key, value }));
}

function envRowsToObject(rows: EnvRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key, value } of rows) {
    if (key.trim()) out[key.trim()] = value;
  }
  return out;
}

export function RepoSettingsDialog({ repoRoot, repoName, workspaceId, open, onOpenChange, onSaved }: Props) {
  const [loading, setLoading] = useState(true);
  const [tabs, setTabs] = useState<TabConfig[]>([]);
  const [envRows, setEnvRows] = useState<EnvRow[]>([]);
  const [postCreate, setPostCreate] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [branches, setBranches] = useState<BranchInfo[]>([]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);

    (async () => {
      const [cfg, branchList] = await Promise.all([
        window.api.getRepoConfig(repoRoot),
        window.api.getBranches(repoRoot),
      ]);
      setBranches(branchList);
      setEnvRows(envObjectToRows(cfg?.env));
      setPostCreate(cfg?.postCreateCommand ?? '');
      setBaseBranch(cfg?.baseBranch ?? '');

      if (cfg?.tabs !== undefined) {
        setTabs(cfg.tabs);
      } else {
        // No override — seed from workspace.defaultTabs ?? globals
        const ws = workspaceId
          ? useAppStore.getState().workspaces.find((w) => w.workspace?.id === workspaceId)?.workspace
          : null;
        if (ws?.defaultTabs !== undefined) {
          setTabs(ws.defaultTabs);
        } else {
          const prefs = await window.api.getPreferences();
          setTabs(prefs.defaultTabs ?? []);
        }
      }

      setLoading(false);
    })();
  }, [open, repoRoot, workspaceId]);

  async function handleSave() {
    const env = envRowsToObject(envRows);
    const config: RepoConfig = { tabs };
    if (Object.keys(env).length > 0) config.env = env;
    if (postCreate.trim()) config.postCreateCommand = postCreate.trim();
    if (baseBranch) config.baseBranch = baseBranch;

    await window.api.setRepoConfig(repoRoot, config);
    onSaved?.();
    onOpenChange(false);
  }

  async function handleReset() {
    await window.api.setRepoConfig(repoRoot, null);
    onSaved?.();
    onOpenChange(false);
  }

  function updateEnvRow(idx: number, patch: Partial<EnvRow>) {
    setEnvRows((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function addEnvRow() {
    setEnvRows((rows) => [...rows, { key: '', value: '' }]);
  }

  function removeEnvRow(idx: number) {
    setEnvRows((rows) => rows.filter((_, i) => i !== idx));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{repoName} — Settings</DialogTitle>
          <DialogDescription>
            Per-repository configuration: tabs, environment, post-create command, base branch.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-6 py-2">
            <section>
              <h3 className="text-sm font-semibold text-foreground mb-3">Tabs</h3>
              <DefaultTabsList
                tabs={tabs}
                scope={`default-tabs:repo:${repoRoot}`}
                onChange={setTabs}
              />
            </section>

            <section>
              <h3 className="text-sm font-semibold text-foreground mb-3">Environment</h3>
              {envRows.length === 0 && (
                <p className="text-sm text-muted-foreground mb-2">No environment variables.</p>
              )}
              {envRows.map((row, idx) => (
                <div key={idx} className="flex items-center gap-2 mb-2">
                  <input
                    aria-label={`Env key ${idx}`}
                    value={row.key}
                    onChange={(e) => updateEnvRow(idx, { key: e.target.value })}
                    placeholder="KEY"
                    className="flex-1 px-2 py-1 text-sm bg-background border border-input rounded text-foreground"
                  />
                  <span className="text-muted-foreground">=</span>
                  <input
                    aria-label={`Env value ${idx}`}
                    value={row.value}
                    onChange={(e) => updateEnvRow(idx, { value: e.target.value })}
                    placeholder="value"
                    className="flex-1 px-2 py-1 text-sm bg-background border border-input rounded text-foreground"
                  />
                  <button
                    aria-label={`Delete env row ${idx}`}
                    onClick={() => removeEnvRow(idx)}
                    className="p-1 text-muted-foreground hover:text-destructive bg-transparent border-none cursor-pointer"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <button
                onClick={addEnvRow}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-secondary text-secondary-foreground rounded hover:bg-muted cursor-pointer border-none"
              >
                <Plus size={14} /> Add variable
              </button>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-foreground mb-3">Post-Create Command</h3>
              <input
                aria-label="Post-create command"
                value={postCreate}
                onChange={(e) => setPostCreate(e.target.value)}
                placeholder="e.g. npm install"
                className="w-full px-2 py-1 text-sm bg-background border border-input rounded text-foreground"
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Runs in the new worktree directory after creation. Empty = no-op.
              </p>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-foreground mb-3">Base Branch</h3>
              <select
                aria-label="Base branch"
                value={baseBranch}
                onChange={(e) => setBaseBranch(e.target.value)}
                className="w-full px-2 py-1 text-sm bg-background border border-input rounded text-foreground"
              >
                <option value="">(not set)</option>
                {branches.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-muted-foreground">
                Used as the base for new worktrees AND the merge target for cleanup. Repos with
                no base branch produce no clean candidates.
              </p>
            </section>
          </div>
        )}

        <DialogFooter>
          <button
            onClick={handleReset}
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
