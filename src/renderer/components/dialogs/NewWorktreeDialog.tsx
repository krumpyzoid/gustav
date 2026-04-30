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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { refreshState } from '../../hooks/use-app-state';
import { LocalTransport } from '../../lib/transport/local-transport';
import type { SessionTransport } from '../../lib/transport/session-transport';
import type { BranchInfo } from '../../../main/domain/types';

interface Props {
  open: boolean;
  onClose: () => void;
  repo: string;
  repoRoot: string;
  workspaceName?: string;
  transport?: SessionTransport;
}

export function NewWorktreeDialog({ open, onClose, repo, repoRoot, workspaceName, transport }: Props) {
  const activeTransport: SessionTransport = transport ?? new LocalTransport();
  const [branch, setBranch] = useState('');
  const [base, setBase] = useState('origin/main');
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open && repoRoot) {
      activeTransport.getBranches(repoRoot).then(setBranches);
    }
  }, [open, repoRoot, activeTransport]);

  async function handleCreate() {
    if (!branch.trim()) return;
    setLoading(true);
    setError('');

    let result;
    if (workspaceName) {
      result = await activeTransport.createRepoSession(workspaceName, repoRoot, 'worktree', branch.trim(), base);
    } else {
      // Local-only fallback: bare worktree without a workspace context.
      // Remote does not support this path.
      result = await window.api.createWorktree({ repo, repoRoot, branch: branch.trim(), base });
    }
    setLoading(false);

    if (result.success) {
      setBranch('');
      onClose();
      setTimeout(refreshState, 500);
    } else {
      setError(result.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-background border-border text-foreground">
        <DialogHeader>
          <DialogTitle>New Worktree</DialogTitle>
          <DialogDescription className="text-foreground/60">
            Create a new git worktree and launch a tmux session
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-foreground/60 text-xs uppercase tracking-wider">Repository</Label>
            <div className="bg-background border border-border rounded-md px-3 py-2 text-accent text-sm mt-1">{repo}</div>
          </div>

          <div>
            <Label className="text-foreground/60 text-xs uppercase tracking-wider">Branch name</Label>
            <Input
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="feat-my-feature"
              className="bg-background border-border text-foreground mt-1"
              autoFocus
            />
          </div>

          <div>
            <Label className="text-foreground/60 text-xs uppercase tracking-wider">Base ref</Label>
            <Select value={base} onValueChange={setBase}>
              <SelectTrigger className="bg-background border-border text-foreground mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background border-border text-foreground">
                <SelectItem value="origin/main">origin/main (default)</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.name} value={b.isRemote ? `origin/${b.name}` : b.name}>
                    {b.isRemote ? `origin/${b.name}` : b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>


          {error && (
            <div className="text-c1 text-sm bg-c1/10 p-2 rounded">{error}</div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-foreground/60">Cancel</Button>
          <Button
            onClick={handleCreate}
            disabled={!branch.trim() || loading}
            className="bg-accent text-primary-foreground hover:bg-accent/80"
          >
            {loading ? 'Creating...' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
