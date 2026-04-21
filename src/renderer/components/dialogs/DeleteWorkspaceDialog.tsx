import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { refreshState } from '../../hooks/use-app-state';
import type { WorkspaceState } from '../../../main/domain/types';

interface Props {
  open: boolean;
  onClose: () => void;
  workspace: WorkspaceState | null;
}

export function DeleteWorkspaceDialog({ open, onClose, workspace }: Props) {
  const [deleteWorktrees, setDeleteWorktrees] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!workspace?.workspace) return null;

  const ws = workspace.workspace;
  const activeSessions = [
    ...workspace.sessions.filter((s) => s.active),
    ...workspace.repoGroups.flatMap((rg) => rg.sessions.filter((s) => s.active)),
  ];
  const worktreeCount = workspace.repoGroups.reduce(
    (n, rg) => n + rg.sessions.filter((s) => s.type === 'worktree').length, 0,
  );

  async function handleDelete() {
    setError('');
    setLoading(true);
    try {
      const result = await window.api.deleteWorkspace(ws.id, deleteWorktrees);
      if (result.success) {
        refreshState();
        setDeleteWorktrees(false);
        onClose();
      } else {
        setError(result.error);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) { setDeleteWorktrees(false); onClose(); } }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-background/80" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-card text-card-foreground border border-border rounded-lg p-6 w-[24rem] shadow-lg">
          <Dialog.Title className="text-lg font-bold mb-2">Delete Workspace</Dialog.Title>

          <p className="text-sm text-muted-foreground mb-4">
            Are you sure you want to delete <strong className="text-foreground">{ws.name}</strong>?
          </p>

          {activeSessions.length > 0 && (
            <div className="bg-muted rounded-md px-3 py-2 mb-3 text-sm">
              <span className="text-destructive font-medium">{activeSessions.length}</span>
              {' '}active session{activeSessions.length > 1 ? 's' : ''} will be terminated.
            </div>
          )}

          {worktreeCount > 0 && (
            <label className="flex items-center gap-2 mb-4 cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={deleteWorktrees}
                onChange={(e) => setDeleteWorktrees(e.target.checked)}
                className="rounded"
              />
              Also delete {worktreeCount} worktree{worktreeCount > 1 ? 's' : ''} from disk
            </label>
          )}

          {error && <p className="text-sm text-destructive mb-3">{error}</p>}

          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-sm bg-secondary text-secondary-foreground rounded-md cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={loading}
              className="px-4 py-2 text-sm bg-destructive text-destructive-foreground rounded-md cursor-pointer disabled:opacity-50"
            >
              {loading ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
