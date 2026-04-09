import type { SessionTab as SessionTabType, ClaudeStatus } from '../../../main/domain/types';
import { StatusIcon } from './StatusIcon';
import { useAppStore, refreshState } from '../../hooks/use-app-state';
import type { WindowInfo } from '../../../main/domain/types';
import { Button } from '../ui/button';
import { Folder, GitBranch, Moon, Terminal } from 'lucide-react';

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

function TypeIcon({ type, isOrphan }: { type: SessionTabType['type']; isOrphan: boolean }) {
  if (isOrphan) return <Moon className="size-3.5 text-muted-foreground" />;
  switch (type) {
    case 'workspace':
      return <Terminal className="size-4.5 text-muted-foreground" />;
    case 'directory':
      return <Folder className="size-4.5 text-muted-foreground" />;
    case 'worktree':
      return <GitBranch className="size-4.5 text-muted-foreground" />;
  }
}

function sessionDisplayName(tab: SessionTabType): string {
  if (tab.type === 'workspace') {
    // Extract label from tmux session name
    const parts = tab.tmuxSession.split('/');
    const last = parts[parts.length - 1];
    return last === '_ws' ? 'workspace' : last;
  }
  if (tab.type === 'directory') {
    return tab.branch ?? tab.repoName ?? 'directory';
  }
  return tab.branch ?? tab.repoName ?? 'session';
}

interface Props {
  tab: SessionTabType;
  onRequestRemove?: () => void;
}

export function SessionTab({ tab, onRequestRemove }: Props) {
  const { activeSession, setActiveSession, setWindows } = useAppStore();
  const isActive = tab.tmuxSession === activeSession;
  const isOrphan = false; // TODO: orphan detection once worktree scanning is in collectWorkspaces
  const label = statusLabel(tab.status);

  async function handleClick() {
    setActiveSession(tab.tmuxSession);
    const result = await window.api.switchSession(tab.tmuxSession);
    if (result.success) setWindows(result.data as WindowInfo[]);
  }

  async function handleKill(e: React.MouseEvent) {
    e.stopPropagation();
    await window.api.killSession(tab.tmuxSession);
    refreshState();
  }

  return (
    <div
      onClick={handleClick}
      className={`flex items-center gap-1.5 px-3 py-1 cursor-pointer border-l-2 transition-colors group/entry
        ${isActive ? 'border-l-accent bg-muted' : 'border-l-transparent'}
        ${isOrphan ? 'opacity-80 hover:opacity-100' : 'hover:bg-muted'}`}
    >
      <div className="w-5 flex justify-center shrink-0">
        <StatusIcon status={tab.status} />
      </div>

      <TypeIcon type={tab.type} isOrphan={isOrphan} />

      <span className="truncate flex-1 min-w-0">
        {sessionDisplayName(tab)}
      </span>

      {label && (
        <span className={`text-sm shrink-0 ${statusLabelColors[tab.status]}`}>
          {label}
        </span>
      )}

      <div className="hidden group-hover/entry:flex gap-0.5 shrink-0 ml-auto">
        <Button
          onClick={handleKill}
          className="size-5"
          title="Kill session"
          variant="destructive"
          size="icon"
        >✕</Button>
        {tab.type === 'worktree' && onRequestRemove && (
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
