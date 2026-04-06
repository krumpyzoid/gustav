import { useRef, useState } from 'react';
import { Sidebar } from './components/sidebar/Sidebar';
import { TerminalView } from './components/terminal/Terminal';
import { ResizeHandle } from './components/terminal/ResizeHandle';
import { NewWorktreeDialog } from './components/dialogs/NewWorktreeDialog';
import { RemoveWorktreeDialog } from './components/dialogs/RemoveWorktreeDialog';
import { CleanWorktreesDialog } from './components/dialogs/CleanWorktreesDialog';
import { NewSessionDialog } from './components/dialogs/NewSessionDialog';
import { useAppStateSubscription } from './hooks/use-app-state';
import { useTheme } from './hooks/use-theme';
import type { SessionEntry } from '../main/domain/types';

export function App() {
  useAppStateSubscription();
  useTheme();

  const sidebarRef = useRef<HTMLElement>(null);

  // Dialog state
  const [newWorktreeOpen, setNewWorktreeOpen] = useState(false);
  const [newWorktreeRepo, setNewWorktreeRepo] = useState('');
  const [newWorktreeRoot, setNewWorktreeRoot] = useState('');

  const [removeEntry, setRemoveEntry] = useState<SessionEntry | null>(null);
  const [cleanOpen, setCleanOpen] = useState(false);
  const [newSessionOpen, setNewSessionOpen] = useState(false);

  function handleNewWorktree(repo: string, repoRoot: string) {
    setNewWorktreeRepo(repo);
    setNewWorktreeRoot(repoRoot);
    setNewWorktreeOpen(true);
  }

  return (
    <div className="flex h-screen">
      <aside ref={sidebarRef} onMouseDown={(e) => e.preventDefault()} className="w-[220px] min-w-[220px] bg-bg flex flex-col py-2">
        <Sidebar
          onNewWorktree={handleNewWorktree}
          onRemoveWorktree={(entry) => setRemoveEntry(entry)}
          onNewSession={() => setNewSessionOpen(true)}
          onClean={() => setCleanOpen(true)}
        />
      </aside>

      <ResizeHandle sidebarRef={sidebarRef} onResize={() => {}} />

      <TerminalView />

      {/* Dialogs */}
      <NewWorktreeDialog
        open={newWorktreeOpen}
        onClose={() => setNewWorktreeOpen(false)}

        repo={newWorktreeRepo}
        repoRoot={newWorktreeRoot}
      />
      <RemoveWorktreeDialog
        open={removeEntry !== null}
        onClose={() => setRemoveEntry(null)}

        entry={removeEntry}
      />
      <CleanWorktreesDialog
        open={cleanOpen}
        onClose={() => setCleanOpen(false)}

      />
      <NewSessionDialog
        open={newSessionOpen}
        onClose={() => setNewSessionOpen(false)}

      />
    </div>
  );
}
