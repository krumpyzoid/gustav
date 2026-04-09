import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
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

export function NewSessionDialog({ open, onClose }: Props) {
  const [name, setName] = useState('');

  async function handleCreate() {
    if (!name.trim()) return;
    await window.api.createSession(name.trim());
    setName('');
    onClose();
    setTimeout(refreshState, 500);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-background border-border text-foreground">
        <DialogHeader>
          <DialogTitle>New Session</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-foreground/60 text-xs uppercase tracking-wider">Session name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="session name..."
              className="bg-background border-border text-foreground mt-1"
              autoFocus
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-foreground/60">Cancel</Button>
          <Button onClick={handleCreate} disabled={!name.trim()} className="bg-accent text-primary-foreground hover:bg-accent/80">
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
