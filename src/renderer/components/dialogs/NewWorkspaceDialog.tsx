import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { refreshState } from '../../hooks/use-app-state';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function NewWorkspaceDialog({ open, onClose }: Props) {
  const [name, setName] = useState('');
  const [directory, setDirectory] = useState('');
  const [error, setError] = useState('');

  async function handleSelectDir() {
    const result = await window.api.selectDirectory();
    if (result.success && result.data) {
      setDirectory(result.data);
      if (!name) {
        // Auto-fill name from last directory segment
        const parts = result.data.split('/');
        setName(parts[parts.length - 1]);
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!name.trim() || !directory.trim()) return;
    const result = await window.api.createWorkspace(name.trim(), directory.trim());
    if (result.success) {
      refreshState();
      setName('');
      setDirectory('');
      onClose();
    } else {
      setError(result.error);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-background/80" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-card text-card-foreground border border-border rounded-lg p-6 w-[24rem] shadow-lg">
          <Dialog.Title className="text-lg font-bold mb-4">New Workspace</Dialog.Title>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-2 py-1 bg-input border border-border rounded text-sm text-foreground"
                placeholder="My Project"
                autoFocus
              />
            </div>

            <div>
              <label className="text-sm text-muted-foreground block mb-1">Directory</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={directory}
                  onChange={(e) => setDirectory(e.target.value)}
                  className="flex-1 px-2 py-1 bg-input border border-border rounded text-sm text-foreground"
                  placeholder="/home/user/project"
                  readOnly
                />
                <button
                  type="button"
                  onClick={handleSelectDir}
                  className="px-3 py-1 bg-secondary text-secondary-foreground rounded text-sm border border-border hover:bg-muted cursor-pointer"
                >
                  Browse
                </button>
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1 bg-secondary text-secondary-foreground rounded text-sm border border-border hover:bg-muted cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!name.trim() || !directory.trim()}
                className="px-3 py-1 bg-primary text-primary-foreground rounded text-sm border border-border hover:opacity-90 cursor-pointer disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
