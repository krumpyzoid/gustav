import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useAppStore, refreshState } from '../../hooks/use-app-state';

interface Props {
  open: boolean;
  onClose: () => void;
  workspaceId: string | null;
}

function pathBasename(p: string): string {
  const parts = p.split('/');
  return parts[parts.length - 1] || p;
}

export function PinReposDialog({ open, onClose, workspaceId }: Props) {
  const ws = useAppStore((s) => s.workspaces.find((w) => w.workspace?.id === workspaceId)?.workspace);

  const [repos, setRepos] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !workspaceId) return;
    const currentWs = useAppStore.getState().workspaces.find((w) => w.workspace?.id === workspaceId)?.workspace;
    if (!currentWs) return;

    setLoading(true);
    setError('');
    setSelected(new Set());
    window.api.discoverRepos(currentWs.directory).then((result) => {
      setLoading(false);
      if (result.success) {
        const pinnedPaths = new Set((currentWs.pinnedRepos ?? []).map((r) => r.path));
        setRepos(result.data.filter((r) => !pinnedPaths.has(r)));
      } else {
        setError(result.error);
      }
    });
  }, [open, workspaceId]);

  function toggleRepo(repoPath: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(repoPath)) {
        next.delete(repoPath);
      } else {
        next.add(repoPath);
      }
      return next;
    });
  }

  async function handlePin() {
    if (!ws || selected.size === 0) return;
    setError('');
    const result = await window.api.pinRepos(ws.id, [...selected]);
    if (result.success) {
      refreshState();
      onClose();
    } else {
      setError(result.error);
    }
  }

  if (!ws) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-background border-border text-foreground">
        <DialogHeader>
          <DialogTitle>Pin Repositories</DialogTitle>
        </DialogHeader>

        {loading && <p className="text-sm text-muted-foreground">Discovering repos...</p>}

        {!loading && repos.length === 0 && !error && (
          <p className="text-sm text-muted-foreground">No unpinned repos found in {ws.directory}</p>
        )}

        {!loading && repos.length > 0 && (
          <div className="flex flex-col gap-2 max-h-[20rem] overflow-y-auto">
            {repos.map((repoPath) => (
              <label
                key={repoPath}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
              >
                <Checkbox
                  checked={selected.has(repoPath)}
                  onCheckedChange={() => toggleRepo(repoPath)}
                />
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-medium truncate">{pathBasename(repoPath)}</span>
                  <span className="text-xs text-muted-foreground truncate">{repoPath}</span>
                </div>
              </label>
            ))}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2 mt-2">
          <Button variant="ghost" onClick={onClose} className="text-muted-foreground">
            Cancel
          </Button>
          <Button
            onClick={handlePin}
            disabled={selected.size === 0}
            className="bg-accent text-primary-foreground hover:bg-accent/80"
          >
            Pin {selected.size > 0 ? `(${selected.size})` : ''}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
