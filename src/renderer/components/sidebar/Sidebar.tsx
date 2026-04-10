import { useState, useRef, useEffect, useCallback } from 'react';
import { Plus, ChevronDown } from 'lucide-react';
import { useAppStore, refreshState } from '../../hooks/use-app-state';
import { WorkspaceAccordion } from './WorkspaceAccordion';
import { DraggableWorkspace } from './DraggableWorkspace';
import type { SessionTab as SessionTabType } from '../../../main/domain/types';

import type { WorkspaceState } from '../../../main/domain/types';

function DraggableWorkspaceItem({ ws, onReorder, onAddSession, onPinRepos, onEditWorkspace, onRemoveWorktree, onAddWorktree, onUnpinRepo }: {
  ws: WorkspaceState;
  onReorder: (draggedId: string, targetId: string, edge: 'top' | 'bottom') => void;
  onAddSession: (wsId: string) => void;
  onPinRepos: (wsId: string) => void;
  onEditWorkspace: (wsId: string) => void;
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
  onClean: () => void;
}

export function Sidebar({ onNewWorkspace, onNewStandalone, onNewSession, onPinRepos, onEditWorkspace, onRemoveWorktree, onAddWorktree, onUnpinRepo, onClean }: Props) {
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
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
        <span className="text-sm font-bold tracking-wider uppercase text-foreground/60">
          Workspaces
        </span>
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen((v) => !v)}
            className="bg-transparent border-none text-foreground/60 hover:text-foreground cursor-pointer p-0.5 transition-colors flex items-center gap-0.5"
            title="Add workspace or session"
          >
            <Plus size={14} />
            <ChevronDown size={10} />
          </button>
          {dropdownOpen && (
            <div className="absolute right-0 top-full mt-1 bg-popover text-popover-foreground border border-border rounded-md shadow-md z-50 min-w-[10rem]">
              <button
                onClick={() => { setDropdownOpen(false); onNewWorkspace(); }}
                className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted cursor-pointer bg-transparent border-none text-popover-foreground"
              >
                New Workspace
              </button>
              <button
                onClick={() => { setDropdownOpen(false); onNewStandalone(); }}
                className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted cursor-pointer bg-transparent border-none text-popover-foreground"
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
            onRemoveWorktree={onRemoveWorktree}
            onAddWorktree={onAddWorktree}
            onUnpinRepo={onUnpinRepo}
          />
        ))}
      </div>

      {/* Bottom action bar */}
      <div className="px-3 py-1.5 border-t border-border">
        <button
          onClick={onClean}
          className="text-sm text-muted-foreground hover:text-foreground bg-transparent border-none cursor-pointer transition-colors"
        >
          Clean worktrees
        </button>
      </div>
    </>
  );
}
