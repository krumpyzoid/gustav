import { useState, useRef, useEffect, useCallback } from 'react';
import { Moon, Plus, Settings, Wifi } from 'lucide-react';
import { useAppStore, refreshState } from '../../hooks/use-app-state';
import { RemoteSection } from './RemoteSection';
import { WorkspaceAccordion } from './WorkspaceAccordion';
import { DraggableWorkspace } from './DraggableWorkspace';
import type { SessionTab as SessionTabType } from '../../../main/domain/types';

import type { WorkspaceState } from '../../../main/domain/types';

function DraggableWorkspaceItem({ ws, onReorder, onAddSession, onPinRepos, onEditWorkspace, onDeleteWorkspace, onEditSettings, onEditRepoSettings, onRemoveWorktree, onAddWorktree, onUnpinRepo }: {
  ws: WorkspaceState;
  onReorder: (draggedId: string, targetId: string, edge: 'top' | 'bottom') => void;
  onAddSession: (wsId: string) => void;
  onPinRepos: (wsId: string) => void;
  onEditWorkspace: (wsId: string) => void;
  onDeleteWorkspace: (wsId: string) => void;
  onEditSettings: (wsId: string) => void;
  onEditRepoSettings: (repoRoot: string, repoName: string, workspaceId: string | null) => void;
  onRemoveWorktree: (tab: SessionTabType, repoRoot: string) => void;
  onAddWorktree: (repoName: string, repoRoot: string, workspaceName: string) => void;
  onUnpinRepo: (workspaceId: string, repoPath: string) => void;
}) {
  const headerRef = useRef<HTMLButtonElement>(null);
  return (
    <DraggableWorkspace
      workspaceId={ws.workspace!.id}
      dragHandleRef={headerRef}
      onReorder={onReorder}
    >
      <WorkspaceAccordion
        state={ws}
        headerRef={headerRef}
        onAddSession={() => onAddSession(ws.workspace!.id)}
        onPinRepos={() => onPinRepos(ws.workspace!.id)}
        onEdit={() => onEditWorkspace(ws.workspace!.id)}
        onDeleteWorkspace={() => onDeleteWorkspace(ws.workspace!.id)}
        onEditSettings={() => onEditSettings(ws.workspace!.id)}
        onEditRepoSettings={onEditRepoSettings}
        onRemoveWorktree={onRemoveWorktree}
        onAddWorktree={onAddWorktree}
        onUnpinRepo={onUnpinRepo}
      />
    </DraggableWorkspace>
  );
}

interface Props {
  onNewWorkspace: () => void;
  onNewStandalone: () => void;
  onNewSession: (workspaceId: string) => void;
  onPinRepos: (workspaceId: string) => void;
  onEditWorkspace: (workspaceId: string) => void;
  onRemoveWorktree: (tab: SessionTabType, repoRoot: string) => void;
  onAddWorktree: (repoName: string, repoRoot: string, workspaceName: string) => void;
  onUnpinRepo: (workspaceId: string, repoPath: string) => void;
  onDeleteWorkspace: (workspaceId: string) => void;
  onEditSettings: (workspaceId: string) => void;
  onEditRepoSettings: (repoRoot: string, repoName: string, workspaceId: string | null) => void;
  onOpenSettings: () => void;
  onConnectRemote?: () => void;
}

export function Sidebar({ onNewWorkspace, onNewStandalone, onNewSession, onPinRepos, onEditWorkspace, onDeleteWorkspace, onEditSettings, onEditRepoSettings, onRemoveWorktree, onAddWorktree, onUnpinRepo, onOpenSettings, onConnectRemote }: Props) {
  const { defaultWorkspace, workspaces } = useAppStore();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleReorder = useCallback(async (draggedId: string, targetId: string, edge: 'top' | 'bottom') => {
    const ids = workspaces.map((ws) => ws.workspace!.id);
    const fromIdx = ids.indexOf(draggedId);
    if (fromIdx === -1) return;

    // Remove dragged item
    ids.splice(fromIdx, 1);

    // Find target position after removal
    let toIdx = ids.indexOf(targetId);
    if (toIdx === -1) return;
    if (edge === 'bottom') toIdx += 1;

    ids.splice(toIdx, 0, draggedId);

    await window.api.reorderWorkspaces(ids);
    refreshState();
  }, [workspaces]);

  async function handleSleepAll() {
    const allSessions = [
      ...defaultWorkspace.sessions,
      ...workspaces.flatMap((ws) => [
        ...ws.sessions,
        ...ws.repoGroups.flatMap((rg) => rg.sessions),
      ]),
    ];
    for (const tab of allSessions) {
      if (tab.active) {
        try { await window.api.sleepSession(tab.tmuxSession); } catch {}
      }
    }
    refreshState();
  }

  useEffect(() => {
    if (!dropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [dropdownOpen]);

  return (
    <>
      <div className="flex items-center justify-end gap-2 pb-4" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <button
          onClick={onConnectRemote}
          className="bg-transparent -none text-foreground/60 hover:text-foreground cursor-pointer p-0.5 transition-colors flex items-center"
          title="Connect to Remote"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <Wifi size={14} />
        </button>
        <button
          onClick={handleSleepAll}
          className="bg-transparent -none text-foreground/60 hover:text-foreground cursor-pointer p-0.5 transition-colors flex items-center"
          title="Sleep all sessions"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <Moon size={14} />
        </button>
        <button
          onClick={onOpenSettings}
          className="bg-transparent -none text-foreground/60 hover:text-foreground cursor-pointer p-0.5 transition-colors flex items-center"
          title="Settings"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <Settings size={14} />
        </button>
        <div className="relative" ref={dropdownRef} style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={() => setDropdownOpen((v) => !v)}
            className="bg-transparent -none text-foreground/60 hover:text-foreground cursor-pointer p-0.5 transition-colors flex items-center"
            title="Add workspace or session"
          >
            <Plus size={14} />
          </button>
          {dropdownOpen && (
            <div className="absolute right-0 top-full mt-1 bg-popover text-popover-foreground -rounded-md shadow-md z-50 min-w-[10rem]">
              <button
                onClick={() => { setDropdownOpen(false); onNewWorkspace(); }}
                className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted cursor-pointer bg-transparent -none text-popover-foreground"
              >
                New Workspace
              </button>
              <button
                onClick={() => { setDropdownOpen(false); onNewStandalone(); }}
                className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted cursor-pointer bg-transparent -none text-popover-foreground"
              >
                New Standalone Session
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Default workspace (standalone sessions) at top */}
        <WorkspaceAccordion
          state={defaultWorkspace}
        />

        {/* Named workspaces */}
        {workspaces.map((ws) => (
          <DraggableWorkspaceItem
            key={ws.workspace!.id}
            ws={ws}
            onReorder={handleReorder}
            onAddSession={onNewSession}
            onPinRepos={onPinRepos}
            onEditWorkspace={onEditWorkspace}
            onDeleteWorkspace={onDeleteWorkspace}
            onEditSettings={onEditSettings}
            onEditRepoSettings={onEditRepoSettings}
            onRemoveWorktree={onRemoveWorktree}
            onAddWorktree={onAddWorktree}
            onUnpinRepo={onUnpinRepo}
          />
        ))}

        {/* Remote section */}
        <RemoteSection />
      </div>

    </>
  );
}
