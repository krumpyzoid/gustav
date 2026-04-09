import { useState, type ReactNode } from 'react';
import { ChevronRight, Plus, Settings } from 'lucide-react';
import { StatusIcon } from './StatusIcon';
import { SessionTab } from './SessionTab';
import type { WorkspaceState, SessionTab as SessionTabType } from '../../../main/domain/types';

interface RepoGroupProps {
  repoName: string;
  sessions: SessionTabType[];
  onRemoveWorktree?: (tab: SessionTabType) => void;
}

function RepoGroup({ repoName, sessions, onRemoveWorktree }: RepoGroupProps) {
  return (
    <div className="mb-1">
      <div className="flex items-center justify-between px-3 pt-1.5 pb-0.5 font-bold tracking-wider uppercase text-accent">
        {repoName}
      </div>
      {sessions.map((tab) => (
        <SessionTab
          key={tab.tmuxSession}
          tab={tab}
          onRequestRemove={
            tab.type === 'worktree' ? () => onRemoveWorktree?.(tab) : undefined
          }
        />
      ))}
    </div>
  );
}

interface Props {
  state: WorkspaceState;
  onAddSession?: () => void;
  onEdit?: () => void;
  onRemoveWorktree?: (tab: SessionTabType) => void;
  defaultExpanded?: boolean;
}

export function WorkspaceAccordion({ state, onAddSession, onEdit, onRemoveWorktree, defaultExpanded = true }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const isDefault = state.workspace === null;
  const name = isDefault ? 'Standalone' : state.workspace!.name;

  const totalSessions = state.sessions.length +
    state.repoGroups.reduce((sum, rg) => sum + rg.sessions.length, 0);

  if (isDefault && totalSessions === 0) return null;

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-sm font-bold tracking-widest uppercase text-foreground/60 bg-transparent border-t border-b border-border/50 cursor-pointer hover:text-foreground transition-colors"
      >
        <ChevronRight
          size={10}
          className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
        <div className="w-4 flex justify-center">
          <StatusIcon status={state.status} />
        </div>
        <span className="truncate">{name}</span>
        <span className="text-muted-foreground ml-0.5 font-normal">{totalSessions}</span>

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
        <div>
          {/* Workspace sessions first */}
          {state.sessions.map((tab) => (
            <SessionTab key={tab.tmuxSession} tab={tab} />
          ))}

          {/* Repo groups */}
          {state.repoGroups.map((rg) => (
            <RepoGroup
              key={rg.repoName}
              repoName={rg.repoName}
              sessions={rg.sessions}
              onRemoveWorktree={onRemoveWorktree}
            />
          ))}
        </div>
      )}
    </div>
  );
}
