import { useRef, useState } from 'react';
import { Sidebar } from './components/sidebar/Sidebar';
import { TerminalView } from './components/terminal/Terminal';
import { ResizeHandle } from './components/terminal/ResizeHandle';
import { NewWorkspaceDialog } from './components/dialogs/NewWorkspaceDialog';
import { EditWorkspaceDialog } from './components/dialogs/EditWorkspaceDialog';
import { NewSessionDialog } from './components/dialogs/NewSessionDialog';
import { NewStandaloneDialog } from './components/dialogs/NewStandaloneDialog';
import { NewWorktreeDialog } from './components/dialogs/NewWorktreeDialog';
import { RemoveWorktreeDialog } from './components/dialogs/RemoveWorktreeDialog';
import { CleanWorktreesDialog } from './components/dialogs/CleanWorktreesDialog';
import { useAppStateSubscription } from './hooks/use-app-state';
import { useKeyboardShortcuts } from './hooks/use-keyboard-shortcuts';
import { useTheme } from './hooks/use-theme';
import type { SessionTab } from '../main/domain/types';

export function App() {
  useAppStateSubscription();
  useTheme();
  useKeyboardShortcuts();

  const sidebarRef = useRef<HTMLElement>(null);

  // Dialog state
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [editWorkspaceId, setEditWorkspaceId] = useState<string | null>(null);
  const [newSessionWorkspaceId, setNewSessionWorkspaceId] = useState<string | null>(null);
  const [newStandaloneOpen, setNewStandaloneOpen] = useState(false);
  const [cleanOpen, setCleanOpen] = useState(false);

  // Legacy worktree dialogs
  const [newWorktreeOpen, setNewWorktreeOpen] = useState(false);
  const [newWorktreeRepo, setNewWorktreeRepo] = useState('');
  const [newWorktreeRoot, setNewWorktreeRoot] = useState('');
  const [removeTab, setRemoveTab] = useState<SessionTab | null>(null);

  return (
    <div className="flex h-screen">
      <aside ref={sidebarRef} onMouseDown={(e) => e.preventDefault()} className="w-[220px] min-w-[220px] bg-bg flex flex-col py-2">
        <Sidebar
          onNewWorkspace={() => setNewWorkspaceOpen(true)}
          onNewStandalone={() => setNewStandaloneOpen(true)}
          onNewSession={(wsId) => setNewSessionWorkspaceId(wsId)}
          onEditWorkspace={(wsId) => setEditWorkspaceId(wsId)}
          onRemoveWorktree={(tab) => setRemoveTab(tab)}
          onClean={() => setCleanOpen(true)}
        />
      </aside>

      <ResizeHandle sidebarRef={sidebarRef} onResize={() => {}} />

      <TerminalView />

      {/* Dialogs */}
      <NewWorkspaceDialog
        open={newWorkspaceOpen}
        onClose={() => setNewWorkspaceOpen(false)}
      />
      <EditWorkspaceDialog
        open={editWorkspaceId !== null}
        onClose={() => setEditWorkspaceId(null)}
        workspaceId={editWorkspaceId}
      />
      <NewSessionDialog
        open={newSessionWorkspaceId !== null}
        onClose={() => setNewSessionWorkspaceId(null)}
        workspaceId={newSessionWorkspaceId}
      />
      <NewStandaloneDialog
        open={newStandaloneOpen}
        onClose={() => setNewStandaloneOpen(false)}
      />
      <NewWorktreeDialog
        open={newWorktreeOpen}
        onClose={() => setNewWorktreeOpen(false)}
        repo={newWorktreeRepo}
        repoRoot={newWorktreeRoot}
      />
      <RemoveWorktreeDialog
        open={removeTab !== null}
        onClose={() => setRemoveTab(null)}
        entry={removeTab as any}
      />
      <CleanWorktreesDialog
        open={cleanOpen}
        onClose={() => setCleanOpen(false)}
      />
    </div>
  );
}
