import { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useAppStore, refreshState } from '../../hooks/use-app-state';

interface Props {
  open: boolean;
  onClose: () => void;
  workspaceId: string | null;
}

export function EditWorkspaceDialog({ open, onClose, workspaceId }: Props) {
  const { workspaces } = useAppStore();
  const ws = workspaces.find((w) => w.workspace?.id === workspaceId)?.workspace;

  const [name, setName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (ws) setName(ws.name);
  }, [ws]);

  async function handleRename(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId || !name.trim()) return;
    setError('');
    const result = await window.api.renameWorkspace(workspaceId, name.trim());
    if (result.success) {
      refreshState();
      onClose();
    } else {
      setError(result.error);
    }
  }

  async function handleUnpin() {
    if (!workspaceId) return;
    await window.api.removeWorkspace(workspaceId);
    refreshState();
    onClose();
  }

  if (!ws) return null;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-background/80" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-card text-card-foreground border border-border rounded-lg p-6 w-[24rem] shadow-lg">
          <Dialog.Title className="text-lg font-bold mb-4">Edit Workspace</Dialog.Title>

          <form onSubmit={handleRename} className="flex flex-col gap-3">
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-2 py-1 bg-input border border-border rounded text-sm text-foreground"
                autoFocus
              />
            </div>

            <div>
              <label className="text-sm text-muted-foreground block mb-1">Directory</label>
              <input
                type="text"
                value={ws.directory}
                readOnly
                className="w-full px-2 py-1 bg-muted border border-border rounded text-sm text-muted-foreground"
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex justify-between mt-2">
              <button
                type="button"
                onClick={handleUnpin}
                className="px-3 py-1 bg-destructive text-destructive-foreground rounded text-sm border border-border hover:opacity-90 cursor-pointer"
              >
                Unpin
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1 bg-secondary text-secondary-foreground rounded text-sm border border-border hover:bg-muted cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!name.trim()}
                  className="px-3 py-1 bg-primary text-primary-foreground rounded text-sm border border-border hover:opacity-90 cursor-pointer disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
