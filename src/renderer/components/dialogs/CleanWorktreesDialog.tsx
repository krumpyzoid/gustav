import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { CleanCandidate } from '../../../main/domain/types';
import { refreshState } from '../../hooks/use-app-state';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CleanWorktreesDialog({ open, onClose }: Props) {
  const [candidates, setCandidates] = useState<CleanCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (open) {
      setFetching(true);
      window.api.getCleanCandidates().then((c) => {
        setCandidates(c);
        setSelected(new Set());
        setFetching(false);
      });
    }
  }, [open]);

  function toggleCandidate(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleClean() {
    const items = candidates
      .filter((c) => selected.has(`${c.repoRoot}:${c.branch}`))
      .map((c) => ({
        repoRoot: c.repoRoot,
        branch: c.branch,
        worktreePath: c.worktreePath,
        deleteBranch: true,
      }));

    setLoading(true);
    await window.api.cleanWorktrees(items);
    setLoading(false);
    onClose();
    refreshState();
  }

  // Group by repo
  const groups = new Map<string, CleanCandidate[]>();
  for (const c of candidates) {
    const g = groups.get(c.repo) ?? [];
    g.push(c);
    groups.set(c.repo, g);
  }

  const reasonBadge = (reason: CleanCandidate['reason']) => {
    if (reason === 'merged') {
      return <span className="text-xs text-c2 bg-c2/10 px-1.5 py-0.5 rounded">merged to staging</span>;
    }
    return <span className="text-xs text-c3 bg-c3/10 px-1.5 py-0.5 rounded">remote deleted</span>;
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-background border-border text-foreground max-w-lg">
        <DialogHeader>
          <DialogTitle>Clean Stale Worktrees</DialogTitle>
          <DialogDescription className="text-foreground/60">
            Worktrees that are merged or have deleted remote branches
          </DialogDescription>
        </DialogHeader>

        {fetching ? (
          <div className="text-foreground/50 text-sm py-4 text-center">Scanning repos...</div>
        ) : candidates.length === 0 ? (
          <div className="text-foreground/50 text-sm py-4 text-center">No stale worktrees found.</div>
        ) : (
          <div className="space-y-4 max-h-[400px] overflow-y-auto">
            {[...groups.entries()].map(([repo, items]) => (
              <div key={repo}>
                <div className="text-xs text-accent font-bold uppercase tracking-wider mb-2">{repo}</div>
                {items.map((c) => {
                  const key = `${c.repoRoot}:${c.branch}`;
                  return (
                    <div
                      key={key}
                      onClick={() => toggleCandidate(key)}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-muted/50
                        ${selected.has(key) ? 'bg-muted/30' : ''}`}
                    >
                      <Checkbox checked={selected.has(key)} />
                      <span className="text-sm flex-1">{c.branch}</span>
                      {reasonBadge(c.reason)}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="flex items-center justify-between">
          <span className="text-foreground/60 text-xs">{selected.size} selected</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} className="text-foreground/60">Cancel</Button>
            <Button
              onClick={handleClean}
              disabled={selected.size === 0 || loading}
              className="bg-c1 text-primary-foreground hover:bg-c1/80"
            >
              {loading ? 'Cleaning...' : `Clean ${selected.size} worktree${selected.size !== 1 ? 's' : ''}`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
