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
import { refreshState } from '../../hooks/use-app-state';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function NewStandaloneDialog({ open, onClose }: Props) {
  const [label, setLabel] = useState('');
  const [directory, setDirectory] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setLabel('');
      setDirectory('');
      setError('');
    }
  }, [open]);

  async function handleSelectDir() {
    const result = await window.api.selectDirectory();
    if (result.success && result.data) {
      setDirectory(result.data);
      if (!label) {
        const parts = result.data.split('/');
        setLabel(parts[parts.length - 1]);
      }
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !directory.trim()) return;
    setError('');
    const result = await window.api.createStandaloneSession(label.trim(), directory.trim());
    if (result.success) {
      refreshState();
      onClose();
    } else {
      setError(result.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-background border-border text-foreground">
        <DialogHeader>
          <DialogTitle>New Standalone Session</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleCreate} className="flex flex-col gap-3">
          <div>
            <Label className="text-foreground/60 text-xs uppercase tracking-wider">Session name</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="scratch"
              className="bg-background border-border text-foreground mt-1"
              autoFocus
            />
          </div>
          <div>
            <Label className="text-foreground/60 text-xs uppercase tracking-wider">Directory</Label>
            <div className="flex gap-2 mt-1">
              <Input
                value={directory}
                readOnly
                placeholder="/home/user/dir"
                className="bg-background border-border text-foreground flex-1"
              />
              <Button type="button" variant="outline" onClick={handleSelectDir}>
                Browse
              </Button>
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} className="text-foreground/60">Cancel</Button>
            <Button type="submit" disabled={!label.trim() || !directory.trim()} className="bg-accent text-primary-foreground hover:bg-accent/80">
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
