import { useState, useRef, useCallback, useEffect } from 'react';
import { ChevronRight, ChevronDown, GitBranchPlus, Pin, PinOff, Plus, Settings } from 'lucide-react';
import { StatusIcon } from './StatusIcon';
import { SessionTab } from './SessionTab';
import { SortableItem } from './SortableItem';
import { refreshState } from '../../hooks/use-app-state';
import type { WorkspaceState, SessionTab as SessionTabType } from '../../../main/domain/types';

function reorderList(ids: string[], draggedId: string, targetId: string, edge: 'top' | 'bottom'): string[] {
  const result = ids.filter((id) => id !== draggedId);
  let toIdx = result.indexOf(targetId);
  if (toIdx === -1) return ids;
  if (edge === 'bottom') toIdx += 1;
  result.splice(toIdx, 0, draggedId);
  return result;
}

interface RepoGroupProps {
  repoName: string;
  repoRoot: string;
  workspaceName: string;
  sessions: SessionTabType[];
  workspaceId: string;
  onRemoveWorktree?: (tab: SessionTabType, repoRoot: string) => void;
  onAddWorktree?: (repoName: string, repoRoot: string, workspaceName: string) => void;
  onUnpinRepo?: (repoPath: string) => void;
  onEditRepoSettings?: (repoRoot: string, repoName: string, workspaceId: string | null) => void;
  onReorderRepoSession: (repoName: string, newOrder: string[]) => void;
  isRemote?: boolean;
}

function RepoGroup({ repoName, repoRoot, workspaceName, sessions, workspaceId, onRemoveWorktree, onAddWorktree, onUnpinRepo, onEditRepoSettings, onReorderRepoSession, isRemote }: RepoGroupProps) {
  const headerRef = useRef<HTMLDivElement>(null);
  const scope = `${workspaceId}:${repoName}`;
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    function handleClick(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [contextMenu]);

  const handleReorder = useCallback((draggedId: string, targetId: string, edge: 'top' | 'bottom') => {
    const currentOrder = sessions.map((s) => s.tmuxSession);
    const newOrder = reorderList(currentOrder, draggedId, targetId, edge);
    onReorderRepoSession(repoName, newOrder);
  }, [sessions, repoName, onReorderRepoSession]);

  return (
    <div className="mb-1">
      <div
        ref={headerRef}
        onContextMenu={(e) => {
          if (!isRemote && onEditRepoSettings) {
            e.preventDefault();
            setContextMenu({ x: e.clientX, y: e.clientY });
          }
        }}
        className="flex items-center justify-between px-3 pl-7 pt-1.5 pb-0.5 text-sm font-normal text-foreground/60 group/repo"
      >
        <span className="truncate">{repoName}</span>
        <div className="hidden group-hover/repo:flex gap-1.5 shrink-0 ml-1">
          {onAddWorktree && (
            <span
              onClick={(e) => { e.stopPropagation(); onAddWorktree(repoName, repoRoot, workspaceName); }}
              className="text-foreground/60 hover:text-foreground cursor-pointer transition-colors"
              title="Add worktree"
            >
              <GitBranchPlus size={13} />
            </span>
          )}
          {onUnpinRepo && (
            <span
              onClick={(e) => { e.stopPropagation(); onUnpinRepo(repoRoot); }}
              className="text-foreground/60 hover:text-destructive cursor-pointer transition-colors"
              title="Unpin repository"
            >
              <PinOff size={13} />
            </span>
          )}
        </div>
      </div>
      {contextMenu && onEditRepoSettings && (
        <div
          ref={contextMenuRef}
          className="fixed bg-popover text-popover-foreground border border-border rounded-md shadow-lg z-50 min-w-[10rem] py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => { setContextMenu(null); onEditRepoSettings(repoRoot, repoName, workspaceId === '__default' ? null : workspaceId); }}
            className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted cursor-pointer bg-transparent border-none text-popover-foreground"
          >
            Edit settings
          </button>
        </div>
      )}
      {sessions.map((tab) => (
        <SortableItem
          key={tab.tmuxSession}
          dragType="repo-session"
          itemId={tab.tmuxSession}
          scope={scope}
          onReorder={handleReorder}
        >
          <SessionTab
            tab={tab}
            workspaceName={workspaceName}
            repoRoot={repoRoot}
            isRemote={isRemote}
            onRequestRemove={
              tab.type === 'worktree' ? () => onRemoveWorktree?.(tab, repoRoot) : undefined
            }
          />
        </SortableItem>
      ))}
    </div>
  );
}

interface Props {
  state: WorkspaceState;
  headerRef?: React.RefObject<HTMLButtonElement | null>;
  onAddSession?: () => void;
  onPinRepos?: () => void;
  onEdit?: () => void;
  onRemoveWorktree?: (tab: SessionTabType, repoRoot: string) => void;
  onAddWorktree?: (repoName: string, repoRoot: string, workspaceName: string) => void;
  onUnpinRepo?: (workspaceId: string, repoPath: string) => void;
  onDeleteWorkspace?: () => void;
  onEditSettings?: () => void;
  onEditRepoSettings?: (repoRoot: string, repoName: string, workspaceId: string | null) => void;
  defaultExpanded?: boolean;
  isRemote?: boolean;
}

export function WorkspaceAccordion({ state, headerRef, onAddSession, onPinRepos, onEdit, onRemoveWorktree, onAddWorktree, onUnpinRepo, onDeleteWorkspace, onEditSettings, onEditRepoSettings, defaultExpanded = true, isRemote }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [plusDropdownOpen, setPlusDropdownOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const plusDropdownRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const isDefault = state.workspace === null;

  useEffect(() => {
    if (!contextMenu) return;
    function handleClick(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [contextMenu]);

  useEffect(() => {
    if (!plusDropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (plusDropdownRef.current && !plusDropdownRef.current.contains(e.target as Node)) {
        setPlusDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [plusDropdownOpen]);
  const name = isDefault ? 'Standalone' : state.workspace!.name;
  const workspaceId = state.workspace?.id ?? '__default';

  const totalSessions = state.sessions.length +
    state.repoGroups.reduce((sum, rg) => sum + rg.sessions.length, 0);

  // Persist ordering helper
  const persistOrdering = useCallback(async (patch: Record<string, unknown>) => {
    if (!state.workspace) return;
    const current = state.workspace.ordering ?? {};
    await window.api.reorderWithinWorkspace(state.workspace.id, { ...current, ...patch });
    refreshState();
  }, [state.workspace]);

  const handleReorderSession = useCallback((draggedId: string, targetId: string, edge: 'top' | 'bottom') => {
    const currentOrder = state.sessions.map((s) => s.tmuxSession);
    const newOrder = reorderList(currentOrder, draggedId, targetId, edge);
    persistOrdering({ sessions: newOrder });
  }, [state.sessions, persistOrdering]);

  const handleReorderRepo = useCallback((draggedId: string, targetId: string, edge: 'top' | 'bottom') => {
    const currentOrder = state.repoGroups.map((rg) => rg.repoName);
    const newOrder = reorderList(currentOrder, draggedId, targetId, edge);
    persistOrdering({ repos: newOrder });
  }, [state.repoGroups, persistOrdering]);

  const handleReorderRepoSession = useCallback((repoName: string, newOrder: string[]) => {
    const current = (state.workspace?.ordering?.repoSessions as Record<string, string[]>) ?? {};
    persistOrdering({ repoSessions: { ...current, [repoName]: newOrder } });
  }, [state.workspace, persistOrdering]);

  if (isDefault && totalSessions === 0) return null;

  return (
    <div>
      <button
        ref={headerRef}
        onClick={() => setExpanded((v) => !v)}
        onContextMenu={(e) => {
          if (!isDefault && !isRemote && (onDeleteWorkspace || onEditSettings)) {
            e.preventDefault();
            setContextMenu({ x: e.clientX, y: e.clientY });
          }
        }}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-sm font-bold tracking-widest uppercase text-foreground bg-transparent cursor-pointer hover:text-foreground transition-colors"
      >
        <ChevronRight
          size={10}
          className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
        <div className="w-4 flex justify-center">
          <StatusIcon status={state.status} />
        </div>
        <span className="truncate">{name}</span>

        {!isDefault && (
          <div className="ml-auto flex gap-1 shrink-0">
            {onEdit && (
              <span
                onClick={(e) => { e.stopPropagation(); onEdit(); }}
                className="text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
                title="Edit workspace"
              >
                <Settings size={12} />
              </span>
            )}
            {(onAddSession || onPinRepos) && (
              <div className="relative" ref={plusDropdownRef}>
                <span
                  onClick={(e) => { e.stopPropagation(); setPlusDropdownOpen((v) => !v); }}
                  className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center"
                  title="Add session or pin repos"
                >
                  <Plus size={14} />
                  <ChevronDown size={8} />
                </span>
                {plusDropdownOpen && (
                  <div className="absolute right-0 top-full mt-1 bg-popover text-popover-foreground   rounded-md shadow-md z-50 min-w-[11rem]">
                    {onAddSession && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setPlusDropdownOpen(false); onAddSession(); }}
                        className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted cursor-pointer bg-transparent border-none text-popover-foreground"
                      >
                        Create new session
                      </button>
                    )}
                    {onPinRepos && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setPlusDropdownOpen(false); onPinRepos(); }}
                        className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted cursor-pointer bg-transparent border-none text-popover-foreground"
                      >
                        Pin repositories
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </button>

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed bg-popover text-popover-foreground border border-border rounded-md shadow-lg z-50 min-w-[10rem] py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {onEditSettings && (
            <button
              onClick={() => { setContextMenu(null); onEditSettings(); }}
              className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted cursor-pointer bg-transparent border-none text-popover-foreground"
            >
              Edit settings
            </button>
          )}
          {onDeleteWorkspace && (
            <button
              onClick={() => { setContextMenu(null); onDeleteWorkspace(); }}
              className="w-full px-3 py-1.5 text-sm text-left hover:bg-destructive/10 text-destructive cursor-pointer bg-transparent border-none"
            >
              Delete Workspace
            </button>
          )}
        </div>
      )}

      {expanded && (
        <div className="pl-4">
          {/* Workspace sessions */}
          {state.sessions.map((tab) => (
            <SortableItem
              key={tab.tmuxSession}
              dragType="ws-session"
              itemId={tab.tmuxSession}
              scope={workspaceId}
              onReorder={handleReorderSession}
            >
              <SessionTab
                tab={tab}
                workspaceName={state.workspace?.name}
                workspaceDir={state.workspace?.directory}
                isRemote={isRemote}
              />
            </SortableItem>
          ))}

          {/* Repo groups */}
          {state.repoGroups.map((rg) => (
            <SortableItem
              key={rg.repoName}
              dragType="repo-group"
              itemId={rg.repoName}
              scope={workspaceId}
              onReorder={handleReorderRepo}
            >
              <RepoGroup
                repoName={rg.repoName}
                repoRoot={rg.repoRoot}
                workspaceName={state.workspace?.name ?? ''}
                sessions={rg.sessions}
                workspaceId={workspaceId}
                onRemoveWorktree={onRemoveWorktree}
                onAddWorktree={onAddWorktree}
                onUnpinRepo={onUnpinRepo ? (repoPath) => onUnpinRepo(workspaceId, repoPath) : undefined}
                onEditRepoSettings={onEditRepoSettings}
                onReorderRepoSession={handleReorderRepoSession}
                isRemote={isRemote}
              />
            </SortableItem>
          ))}
        </div>
      )}
    </div>
  );
}
