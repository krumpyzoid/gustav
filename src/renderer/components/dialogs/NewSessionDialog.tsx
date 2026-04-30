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
import { LocalTransport } from '../../lib/transport/local-transport';
import type { SessionTransport } from '../../lib/transport/session-transport';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Local workspace lookup key. Ignored when `workspaceDescriptor` is supplied. */
  workspaceId?: string | null;
  /** Direct workspace descriptor — required when targeting a workspace
   * that's not in the local store (e.g. a remote workspace). Takes
   * precedence over `workspaceId` when both are passed. */
  workspaceDescriptor?: { name: string; directory: string };
  /** Transport to dispatch the create through. Defaults to LocalTransport
   * so existing callers (local sidebar) keep working unchanged. */
  transport?: SessionTransport;
}

export function NewSessionDialog({ open, onClose, workspaceId, workspaceDescriptor, transport }: Props) {
  const activeTransport: SessionTransport = transport ?? new LocalTransport();
  const { workspaces } = useAppStore();
  const ws = workspaceDescriptor ?? workspaces.find((w) => w.workspace?.id === workspaceId)?.workspace;

  const [wsLabel, setWsLabel] = useState('');
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
      setWsLabel('');
      setError('');
    }
  }, [open]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!ws) return;
    const label = wsLabel.trim() || undefined;
    const key = label ?? '_ws';
    if (existingWsLabels.has(key)) {
      setError(`Session "${label ?? 'default'}" already exists in this workspace`);
      return;
    }
    setError('');
    const result = await activeTransport.createWorkspaceSession(ws.name, ws.directory, label);
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

        <form onSubmit={handleCreate} className="flex flex-col gap-3">
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
          <div className="flex justify-end">
            <Button type="submit" className="bg-accent text-primary-foreground hover:bg-accent/80">
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
