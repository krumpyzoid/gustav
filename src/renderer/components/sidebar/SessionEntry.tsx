import type { SessionEntry as SessionEntryType, ClaudeStatus } from '../../../main/domain/types';
import { StatusDot } from './StatusDot';
import { useAppStore, refreshState } from '../../hooks/use-app-state';
import type { WindowInfo } from '../../../main/domain/types';
import { Button } from '../ui/button'
import { Moon } from 'lucide-react';

function statusLabel(status: ClaudeStatus): string {
  if (status === 'action') return 'needs input';
  if (status === 'busy') return 'working';
  if (status === 'done') return 'done';
  return '';
}

const statusLabelColors: Record<ClaudeStatus, string> = {
  new: '',
  busy: 'text-c3',
  action: 'text-c1',
  done: 'text-c2',
  none: '',
};

interface Props {
  entry: SessionEntryType;
  repoRoot?: string;
  onRequestRemove?: () => void;
}

export function SessionEntry({ entry, repoRoot, onRequestRemove }: Props) {
  const { activeSession, setActiveSession, setWindows } = useAppStore();
  const isActive = entry.tmuxSession === activeSession;
  const isOrphan = entry.tmuxSession === null;
  const label = statusLabel(entry.status);

  async function handleClick() {
    if (entry.tmuxSession) {
      setActiveSession(entry.tmuxSession);
      const result = await window.api.switchSession(entry.tmuxSession);
      if (result.success) setWindows(result.data as WindowInfo[]);
    } else if (entry.worktreePath) {
      const session = entry.isMainWorktree
        ? `${entry.repo}/_dir`
        : `${entry.repo}/${entry.branch}`;
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
      className={`flex items-center gap-1.5 px-3 py-1 cursor-pointer border-l-2 transition-colors
        ${isActive ? 'border-l-accent bg-c0' : 'border-l-transparent'}
        ${isOrphan ? 'opacity-80 hover:opacity-100' : 'hover:bg-c0'}`}
    >
      {entry.repo !== 'standalone' && <div className="w-5 flex justify-center">
        {isOrphan ? <Moon className="size-5" /> : <StatusDot status={entry.status} />}
      </div>
      }

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          {entry.isMainWorktree && (
            <span className="text-accent/90 shrink-0">(dir)</span>
          )}
          <span className="truncate">
            {entry.branch}
          </span>
        </div>
        {entry.upstream && (
          <div className="text-fg/50 truncate pl-px">
            {entry.upstream}
          </div>
        )}
      </div>

      {label && entry.tmuxSession && (
        <span className={`text-sm shrink-0 ${statusLabelColors[entry.status]}`}>
          {label}
        </span>
      )}

      <div className="hidden group-hover/entry:flex gap-0.5 shrink-0 ml-auto">
        {entry.tmuxSession && (
          <Button
            onClick={handleKill}
            className="size-5"
            title="Kill tmux session"
            variant="destructive"
            size="icon"
          >✕</Button>
        )}
        {entry.repo !== 'standalone' && !entry.isMainWorktree && onRequestRemove && (
          <Button
            onClick={(e) => { e.stopPropagation(); onRequestRemove(); }}
            className="size-5"
            variant="destructive"
            title="Remove worktree"
            size="icon"
          >🗑</Button>
        )}
      </div>
    </div>
  );
}
