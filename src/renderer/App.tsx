import { useRef, useState } from 'react';
import { Sidebar } from './components/sidebar/Sidebar';
import { SettingsSidebar } from './components/settings/SettingsSidebar';
import { SettingsView } from './components/settings/SettingsView';
import { TerminalView } from './components/terminal/Terminal';
import { ResizeHandle } from './components/terminal/ResizeHandle';
import { NewWorkspaceDialog } from './components/dialogs/NewWorkspaceDialog';
import { EditWorkspaceDialog } from './components/dialogs/EditWorkspaceDialog';
import { NewSessionDialog } from './components/dialogs/NewSessionDialog';
import { NewStandaloneDialog } from './components/dialogs/NewStandaloneDialog';
import { NewWorktreeDialog } from './components/dialogs/NewWorktreeDialog';
import { PinReposDialog } from './components/dialogs/PinReposDialog';
import { RemoveWorktreeDialog } from './components/dialogs/RemoveWorktreeDialog';
import { CleanWorktreesDialog } from './components/dialogs/CleanWorktreesDialog';
import { useAppStateSubscription, refreshState } from './hooks/use-app-state';
import { useKeyboardShortcuts } from './hooks/use-keyboard-shortcuts';
import { focusTerminal } from './hooks/use-terminal';
import { useTheme } from './hooks/use-theme';
import type { SessionTab } from '../main/domain/types';

type View = 'terminal' | 'settings';

export function App() {
  useAppStateSubscription();
  useTheme();
  useKeyboardShortcuts();

  const sidebarRef = useRef<HTMLElement>(null);
  const [view, setView] = useState<View>('terminal');
  const [settingsSection, setSettingsSection] = useState('appearance');

  // Dialog state
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [editWorkspaceId, setEditWorkspaceId] = useState<string | null>(null);
  const [newSessionWorkspaceId, setNewSessionWorkspaceId] = useState<string | null>(null);
  const [newStandaloneOpen, setNewStandaloneOpen] = useState(false);
  const [cleanOpen, setCleanOpen] = useState(false);
  const [pinReposWorkspaceId, setPinReposWorkspaceId] = useState<string | null>(null);

  // Worktree dialogs
  const [newWorktreeOpen, setNewWorktreeOpen] = useState(false);
  const [newWorktreeRepo, setNewWorktreeRepo] = useState('');
  const [newWorktreeRoot, setNewWorktreeRoot] = useState('');
  const [newWorktreeWorkspaceName, setNewWorktreeWorkspaceName] = useState('');
  const [removeTab, setRemoveTab] = useState<SessionTab | null>(null);
  const [removeRepoRoot, setRemoveRepoRoot] = useState<string | null>(null);

  return (
    <div className="flex h-screen bg-bg">
      <aside
        ref={sidebarRef}
        onMouseUp={() => { if (view === 'terminal') focusTerminal(); }}
        className="w-[220px] min-w-[220px] bg-bg flex flex-col pt-10 pb-2 select-none"
      >
        {view === 'terminal' ? (
          <Sidebar
            onNewWorkspace={() => setNewWorkspaceOpen(true)}
            onNewStandalone={() => setNewStandaloneOpen(true)}
            onNewSession={(wsId) => setNewSessionWorkspaceId(wsId)}
            onPinRepos={(wsId) => setPinReposWorkspaceId(wsId)}
            onEditWorkspace={(wsId) => setEditWorkspaceId(wsId)}
            onRemoveWorktree={(tab, repoRoot) => { setRemoveTab(tab); setRemoveRepoRoot(repoRoot); }}
            onAddWorktree={(repoName, repoRoot, workspaceName) => { setNewWorktreeRepo(repoName); setNewWorktreeRoot(repoRoot); setNewWorktreeWorkspaceName(workspaceName); setNewWorktreeOpen(true); }}
            onUnpinRepo={async (workspaceId, repoPath) => { await window.api.unpinRepo(workspaceId, repoPath); refreshState(); }}
            onClean={() => setCleanOpen(true)}
            onOpenSettings={() => setView('settings')}
          />
        ) : (
          <SettingsSidebar
            activeSection={settingsSection}
            onSelectSection={setSettingsSection}
            onBack={() => { setView('terminal'); focusTerminal(); }}
          />
        )}
      </aside>

      <ResizeHandle sidebarRef={sidebarRef} onResize={() => {}} />

      <div className="flex-1 flex flex-col m-2 ml-0 rounded-lg overflow-hidden bg-background shadow-lg">
        {/* Terminal stays mounted to preserve PTY state */}
        <div className={view === 'terminal' ? 'flex-1 flex flex-col overflow-hidden' : 'hidden'}>
          <TerminalView />
        </div>
        {view === 'settings' && <SettingsView section={settingsSection} />}
      </div>

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
      <PinReposDialog
        open={pinReposWorkspaceId !== null}
        onClose={() => setPinReposWorkspaceId(null)}
        workspaceId={pinReposWorkspaceId}
      />
      <NewWorktreeDialog
        open={newWorktreeOpen}
        onClose={() => setNewWorktreeOpen(false)}
        repo={newWorktreeRepo}
        repoRoot={newWorktreeRoot}
        workspaceName={newWorktreeWorkspaceName || undefined}
      />
      <RemoveWorktreeDialog
        open={removeTab !== null}
        onClose={() => { setRemoveTab(null); setRemoveRepoRoot(null); }}
        tab={removeTab}
        repoRoot={removeRepoRoot}
      />
      <CleanWorktreesDialog
        open={cleanOpen}
        onClose={() => setCleanOpen(false)}
      />
    </div>
  );
}
