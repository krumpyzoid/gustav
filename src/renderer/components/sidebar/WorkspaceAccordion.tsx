import { useState, useRef, useCallback } from 'react';
import { ChevronRight, Plus, Settings } from 'lucide-react';
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
  sessions: SessionTabType[];
  workspaceId: string;
  onRemoveWorktree?: (tab: SessionTabType) => void;
  onReorderRepoSession: (repoName: string, newOrder: string[]) => void;
}

function RepoGroup({ repoName, sessions, workspaceId, onRemoveWorktree, onReorderRepoSession }: RepoGroupProps) {
  const headerRef = useRef<HTMLDivElement>(null);
  const scope = `${workspaceId}:${repoName}`;

  const handleReorder = useCallback((draggedId: string, targetId: string, edge: 'top' | 'bottom') => {
    const currentOrder = sessions.map((s) => s.tmuxSession);
    const newOrder = reorderList(currentOrder, draggedId, targetId, edge);
    onReorderRepoSession(repoName, newOrder);
  }, [sessions, repoName, onReorderRepoSession]);

  return (
    <div className="mb-1">
      <div
        ref={headerRef}
        className="flex items-center justify-between px-3 pl-7 pt-1.5 pb-0.5 text-sm font-normal text-foreground/60"
      >
        {repoName}
      </div>
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
            onRequestRemove={
              tab.type === 'worktree' ? () => onRemoveWorktree?.(tab) : undefined
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
  onEdit?: () => void;
  onRemoveWorktree?: (tab: SessionTabType) => void;
  defaultExpanded?: boolean;
}

export function WorkspaceAccordion({ state, headerRef, onAddSession, onEdit, onRemoveWorktree, defaultExpanded = true }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const isDefault = state.workspace === null;
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
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-sm font-bold tracking-widest uppercase text-foreground bg-transparent border-t border-b border-border/50 cursor-pointer hover:text-foreground transition-colors"
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
            {onAddSession && (
              <span
                onClick={(e) => { e.stopPropagation(); onAddSession(); }}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Add session"
              >
                <Plus size={14} />
              </span>
            )}
          </div>
        )}
      </button>

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
              <SessionTab tab={tab} />
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
                sessions={rg.sessions}
                workspaceId={workspaceId}
                onRemoveWorktree={onRemoveWorktree}
                onReorderRepoSession={handleReorderRepoSession}
              />
            </SortableItem>
          ))}
        </div>
      )}
    </div>
  );
}
