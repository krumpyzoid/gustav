import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAppStore, refreshState } from '../../hooks/use-app-state';

type Step = 'choose-type' | 'ws-name' | 'choose-repo' | 'choose-mode' | 'worktree-branch';

interface Props {
  open: boolean;
  onClose: () => void;
  workspaceId: string | null;
}

function pathBasename(p: string): string {
  const parts = p.split('/');
  return parts[parts.length - 1] || p;
}

export function NewSessionDialog({ open, onClose, workspaceId }: Props) {
  const { workspaces } = useAppStore();
  const ws = workspaces.find((w) => w.workspace?.id === workspaceId)?.workspace;

  const [step, setStep] = useState<Step>('choose-type');
  const [repos, setRepos] = useState<string[]>([]);
  const [selectedRepo, setSelectedRepo] = useState('');
  const [branch, setBranch] = useState('');
  const [wsLabel, setWsLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Existing workspace session names for collision detection
  const wsState = workspaces.find((w) => w.workspace?.id === workspaceId);
  const existingWsLabels = new Set(
    (wsState?.sessions ?? []).map((s) => {
      const parts = s.tmuxSession.split('/');
      return parts[parts.length - 1];
    }),
  );

  useEffect(() => {
    if (open) {
      setStep('choose-type');
      setRepos([]);
      setSelectedRepo('');
      setBranch('');
      setWsLabel('');
      setError('');
    }
  }, [open]);

  function handleGoToWsName() {
    setWsLabel('');
    setError('');
    setStep('ws-name');
  }

  async function handleCreateWorkspaceSession(e: React.FormEvent) {
    e.preventDefault();
    if (!ws) return;
    const label = wsLabel.trim() || undefined;
    const key = label ?? '_ws';
    if (existingWsLabels.has(key)) {
      setError(`Session "${label ?? 'default'}" already exists in this workspace`);
      return;
    }
    setError('');
    const result = await window.api.createWorkspaceSession(ws.name, ws.directory, label);
    if (result.success) {
      refreshState();
      onClose();
    } else {
      setError(result.error);
    }
  }

  async function handleRepoSession() {
    if (!ws) return;
    setLoading(true);
    setError('');
    const result = await window.api.discoverRepos(ws.directory);
    setLoading(false);
    if (result.success) {
      setRepos(result.data);
      setStep('choose-repo');
    } else {
      setError(result.error);
    }
  }

  function handleSelectRepo(repoPath: string) {
    setSelectedRepo(repoPath);
    setStep('choose-mode');
  }

  async function handleDirectoryMode() {
    if (!ws || !selectedRepo) return;
    setError('');
    const result = await window.api.createRepoSession(ws.name, selectedRepo, 'directory');
    if (result.success) {
      refreshState();
      onClose();
    } else {
      setError(result.error);
    }
  }

  async function handleCreateWorktree(e: React.FormEvent) {
    e.preventDefault();
    if (!ws || !selectedRepo || !branch.trim()) return;
    setError('');
    const result = await window.api.createRepoSession(ws.name, selectedRepo, 'worktree', branch.trim());
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
          <DialogTitle>New Session in {ws.name}</DialogTitle>
        </DialogHeader>

        {step === 'choose-type' && (
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              onClick={handleGoToWsName}
              className="w-full justify-start h-auto py-2 flex-col items-start"
            >
              <span className="font-medium">Workspace Session</span>
              <span className="text-muted-foreground text-xs">Claude + Shell in workspace directory</span>
            </Button>
            <Button
              variant="outline"
              onClick={handleRepoSession}
              disabled={loading}
              className="w-full justify-start h-auto py-2 flex-col items-start"
            >
              <span className="font-medium">Repository Session</span>
              <span className="text-muted-foreground text-xs">
                {loading ? 'Discovering repos...' : 'Choose a git repo in workspace'}
              </span>
            </Button>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        {step === 'ws-name' && (
          <form onSubmit={handleCreateWorkspaceSession} className="flex flex-col gap-3">
            <div>
              <Label className="text-foreground/60 text-xs uppercase tracking-wider">Session name</Label>
              <Input
                value={wsLabel}
                onChange={(e) => setWsLabel(e.target.value)}
                placeholder="e.g. refactor, debug, docs"
                className="bg-background border-border text-foreground mt-1"
                autoFocus
              />
              <p className="text-xs text-muted-foreground mt-1">Leave empty for default workspace session</p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-between">
              <Button type="button" variant="ghost" onClick={() => setStep('choose-type')} className="text-muted-foreground">
                ← Back
              </Button>
              <Button type="submit" className="bg-accent text-primary-foreground hover:bg-accent/80">
                Create
              </Button>
            </div>
          </form>
        )}

        {step === 'choose-repo' && (
          <div className="flex flex-col gap-2">
            {repos.length === 0 ? (
              <p className="text-sm text-muted-foreground">No git repos found in {ws.directory}</p>
            ) : (
              repos.map((repo) => (
                <Button
                  key={repo}
                  variant="outline"
                  onClick={() => handleSelectRepo(repo)}
                  className="w-full justify-start h-auto py-2 flex-col items-start"
                >
                  <span className="font-medium">{pathBasename(repo)}</span>
                  <span className="text-muted-foreground text-xs truncate w-full text-left">{repo}</span>
                </Button>
              ))
            )}
            <Button variant="ghost" onClick={() => setStep('choose-type')} className="text-muted-foreground">
              ← Back
            </Button>
          </div>
        )}

        {step === 'choose-mode' && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">{pathBasename(selectedRepo)}</p>
            <Button
              variant="outline"
              onClick={handleDirectoryMode}
              className="w-full justify-start h-auto py-2 flex-col items-start"
            >
              <span className="font-medium">Repository Directory</span>
              <span className="text-muted-foreground text-xs">Session in the repo root</span>
            </Button>
            <Button
              variant="outline"
              onClick={() => setStep('worktree-branch')}
              className="w-full justify-start h-auto py-2 flex-col items-start"
            >
              <span className="font-medium">New Worktree</span>
              <span className="text-muted-foreground text-xs">Create a new worktree branch</span>
            </Button>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button variant="ghost" onClick={() => setStep('choose-repo')} className="text-muted-foreground">
              ← Back
            </Button>
          </div>
        )}

        {step === 'worktree-branch' && (
          <form onSubmit={handleCreateWorktree} className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">New worktree in {pathBasename(selectedRepo)}</p>
            <div>
              <Label className="text-foreground/60 text-xs uppercase tracking-wider">Branch name</Label>
              <Input
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="feat-new-feature"
                className="bg-background border-border text-foreground mt-1"
                autoFocus
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep('choose-mode')} className="text-muted-foreground">
                ← Back
              </Button>
              <Button type="submit" disabled={!branch.trim()} className="bg-accent text-primary-foreground hover:bg-accent/80">
                Create
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
