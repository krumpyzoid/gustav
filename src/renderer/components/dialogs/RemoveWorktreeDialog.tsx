import { useState } from 'react';
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
import { Label } from '@/components/ui/label';
import { refreshState } from '../../hooks/use-app-state';
import type { SessionTab } from '../../../main/domain/types';

interface Props {
  open: boolean;
  onClose: () => void;
  tab: SessionTab | null;
  repoRoot: string | null;
}

export function RemoveWorktreeDialog({ open, onClose, tab, repoRoot }: Props) {
  const [deleteBranch, setDeleteBranch] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleRemove() {
    if (!tab || !repoRoot || !tab.branch) return;

    setLoading(true);
    setError('');
    const result = await window.api.removeWorktree(repoRoot, tab.branch, deleteBranch);
    setLoading(false);

    if (result.success) {
      setDeleteBranch(false);
      onClose();
      refreshState();
    } else {
      setError(result.error);
    }
  }

  if (!tab) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-background border-border text-foreground">
        <DialogHeader>
          <DialogTitle>Remove Worktree</DialogTitle>
          <DialogDescription className="text-foreground/60">
            This will remove the worktree directory, kill the tmux session, and optionally delete the branch.
          </DialogDescription>
        </DialogHeader>

        <div className="bg-muted/50 rounded-md p-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-foreground/60">Repo</span>
            <span className="text-accent">{tab.repoName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-foreground/60">Branch</span>
            <span>{tab.branch}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="delete-branch"
            checked={deleteBranch}
            onCheckedChange={(v) => setDeleteBranch(v === true)}
          />
          <Label htmlFor="delete-branch" className="text-sm">Also delete branch</Label>
        </div>

        {error && (
          <div className="text-c1 text-sm bg-c1/10 p-2 rounded">{error}</div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-foreground/60">Cancel</Button>
          <Button
            onClick={handleRemove}
            disabled={loading}
            className="bg-c1 text-primary-foreground hover:bg-c1/80"
          >
            {loading ? 'Removing...' : 'Remove'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
