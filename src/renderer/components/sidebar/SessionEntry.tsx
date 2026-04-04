import type { SessionEntry as SessionEntryType, ClaudeStatus } from '../../../main/domain/types';
import { StatusDot } from './StatusDot';
import { useAppStore, refreshState } from '../../hooks/use-app-state';

function statusLabel(status: ClaudeStatus): string {
  if (status === 'action') return 'needs input';
  if (status === 'busy') return 'working';
  if (status === 'done') return 'done';
  return '';
}

const statusLabelColors: Record<ClaudeStatus, string> = {
  action: 'text-c1',
  busy: 'text-c3',
  done: 'text-c2',
  none: '',
};

interface Props {
  entry: SessionEntryType;
  repoRoot?: string;
  onRequestRemove?: () => void;
}

export function SessionEntry({ entry, repoRoot, onRequestRemove }: Props) {
  const { activeSession, setActiveSession } = useAppStore();
  const isActive = entry.tmuxSession === activeSession;
  const isOrphan = entry.tmuxSession === null;
  const label = statusLabel(entry.status);

  async function handleClick() {
    if (entry.tmuxSession) {
      setActiveSession(entry.tmuxSession);
      await window.api.switchSession(entry.tmuxSession);
    } else if (entry.worktreePath) {
      const session = `${entry.repo}/${entry.branch}`;
      await window.api.startSession(session, entry.worktreePath);
      setActiveSession(session);
      setTimeout(refreshState, 500);
    }
  }

  async function handleKill(e: React.MouseEvent) {
    e.stopPropagation();
    if (entry.tmuxSession) {
      await window.api.killSession(entry.tmuxSession);
      refreshState();
    }
  }

  return (
    <div
      onClick={handleClick}
      className={`flex items-center gap-1.5 px-3 py-[3px] cursor-pointer border-l-2 transition-colors
        ${isActive ? 'border-l-accent bg-c0' : 'border-l-transparent'}
        ${isOrphan ? 'opacity-50 hover:opacity-80' : 'hover:bg-c0'}`}
    >
      {entry.repo !== 'standalone' && <StatusDot status={entry.status} />}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="truncate text-[13px]">
            {isOrphan ? `○ ${entry.branch}` : entry.branch}
          </span>
          {entry.isMainWorktree && (
            <span className="text-[10px] text-accent/60 shrink-0">(dir)</span>
          )}
        </div>
        {entry.repo !== 'standalone' && (
          <div className="text-[10px] text-fg/30 truncate pl-px">
            origin/{entry.branch}
          </div>
        )}
      </div>

      {label && entry.tmuxSession && (
        <span className={`text-[10px] shrink-0 ${statusLabelColors[entry.status]}`}>
          {label}
        </span>
      )}

      <div className="hidden group-hover/entry:flex gap-0.5 shrink-0 ml-auto">
        {entry.tmuxSession && (
          <button
            onClick={handleKill}
            className="bg-transparent border-none text-c0 hover:text-c1 cursor-pointer text-xs px-[3px] rounded"
            title="Kill tmux session"
          >✕</button>
        )}
        {entry.repo !== 'standalone' && !entry.isMainWorktree && onRequestRemove && (
          <button
            onClick={(e) => { e.stopPropagation(); onRequestRemove(); }}
            className="bg-transparent border-none text-c0 hover:text-c1 cursor-pointer text-xs px-[3px] rounded"
            title="Remove worktree"
          >🗑</button>
        )}
      </div>
    </div>
  );
}
