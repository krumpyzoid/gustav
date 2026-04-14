import type { SessionTab as SessionTabType, ClaudeStatus } from '../../../main/domain/types';
import { StatusIcon } from './StatusIcon';
import { useAppStore, refreshState } from '../../hooks/use-app-state';
import type { WindowInfo } from '../../../main/domain/types';
import { Button } from '../ui/button';
import { Folder, GitBranch, Moon, Terminal, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

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
  workspaceName?: string;
  workspaceDir?: string;
  repoRoot?: string;
  onRequestRemove?: () => void;
  isRemote?: boolean;
}

export function SessionTab({ tab, workspaceName, workspaceDir, repoRoot, onRequestRemove, isRemote }: Props) {
  const { activeSession, remoteActiveSession, setActiveSession, setWindows, setRemoteActiveSession, setIsRemoteSession, setRemotePtyChannelId } = useAppStore();
  const isSelected = isRemote
    ? tab.tmuxSession === remoteActiveSession
    : tab.tmuxSession === activeSession;
  const isInactive = !tab.active;
  const label = statusLabel(tab.status);

  async function handleClick() {
    if (isRemote) {
      await handleRemoteClick();
      return;
    }
    if (isInactive) {
      // Try to wake from persisted snapshot first (preserves user-created tabs)
      const wakeResult = await window.api.wakeSession(tab.tmuxSession);
      if (wakeResult.success) {
        setActiveSession(tab.tmuxSession);
        setWindows(wakeResult.data as WindowInfo[]);
        refreshState();
        return;
      }
      // Fallback: create fresh session (for entries with no persisted snapshot)
      let result: { success: boolean; data?: string; error?: string } | undefined;
      if (tab.type === 'workspace' && workspaceName && workspaceDir) {
        const parts = tab.tmuxSession.split('/');
        const last = parts[parts.length - 1];
        const label = last === '_ws' ? undefined : last;
        result = await window.api.createWorkspaceSession(workspaceName, workspaceDir, label);
      } else if (tab.type === 'worktree' && workspaceName && repoRoot && tab.branch && tab.worktreePath) {
        result = await window.api.launchWorktreeSession(workspaceName, repoRoot, tab.branch, tab.worktreePath);
      } else if (tab.type === 'directory' && workspaceName && repoRoot) {
        result = await window.api.createRepoSession(workspaceName, repoRoot, 'directory');
      }
      if (result?.success && result.data) {
        setActiveSession(result.data);
        const switchResult = await window.api.switchSession(result.data);
        if (switchResult.success) setWindows(switchResult.data as WindowInfo[]);
        refreshState();
      }
      return;
    }
    setIsRemoteSession(false);
    setActiveSession(tab.tmuxSession);
    const result = await window.api.switchSession(tab.tmuxSession);
    if (result.success) setWindows(result.data as WindowInfo[]);
  }

  async function handleRemoteClick() {
    if (isInactive) {
      // Wake remote session
      await window.api.remoteSessionCommand('wake-session', { session: tab.tmuxSession });
    }

    // Detach previous remote PTY if any
    const prevChannel = useAppStore.getState().remotePtyChannelId;
    if (prevChannel !== null) {
      window.api.remoteSessionCommand('detach-pty', { channelId: prevChannel });
    }

    // Attach to remote PTY — waits for server response with channelId
    const result = await window.api.remoteSessionCommand('attach-pty', { tmuxSession: tab.tmuxSession, cols: 80, rows: 24 });
    if (result.success && result.data?.channelId) {
      setRemoteActiveSession(tab.tmuxSession);
      setIsRemoteSession(true);
      setRemotePtyChannelId(result.data.channelId as number);
    }
  }

  async function handleSleep(e: React.MouseEvent) {
    e.stopPropagation();
    if (isRemote) {
      await window.api.remoteSessionCommand('sleep-session', { session: tab.tmuxSession });
    } else {
      await window.api.sleepSession(tab.tmuxSession);
    }
    refreshState();
  }

  async function handleDestroy(e: React.MouseEvent) {
    e.stopPropagation();
    if (isRemote) {
      await window.api.remoteSessionCommand('destroy-session', { session: tab.tmuxSession });
    } else {
      await window.api.destroySession(tab.tmuxSession);
    }
    refreshState();
  }

  return (
    <button
      onClick={handleClick}
      className={cn(`flex grow w-full text-left cursor-pointer items-center gap-1.5 px-1.5 py-1 transition-colors group/entry rounded-md hover:bg-foreground/5`,
        isSelected && 'bg-foreground/10 hover:bg-foreground/10',
        isInactive && 'opacity-40 hover:opacity-60')}
    >
      <div className="w-5 flex justify-center shrink-0">
        <StatusIcon status={tab.status} />
      </div>

      <TypeIcon type={tab.type} isOrphan={isInactive} />

      <span className="truncate flex-1 min-w-0">
        {sessionDisplayName(tab)}
      </span>

      {label && (
        <span className={`text-sm shrink-0 ${statusLabelColors[tab.status]}`}>
          {label}
        </span>
      )}

      <div className="hidden group-hover/entry:flex gap-0.5 shrink-0 ml-auto">
        {!isInactive && (
          <Button
            onClick={handleSleep}
            className="size-5 text-c3 hover:text-c3 hover:bg-c3/20"
            title="Put to sleep"
            variant="ghost"
            size="icon"
          >
            <Moon className="size-3" />
          </Button>
        )}
        {tab.type === 'worktree' && onRequestRemove ? (
          <Button
            onClick={(e) => { e.stopPropagation(); onRequestRemove(); }}
            className="size-5"
            variant="destructive"
            title="Delete worktree"
            size="icon"
          >
            <Trash2 className="size-3" />
          </Button>
        ) : (
          <Button
            onClick={handleDestroy}
            className="size-5"
            title="Destroy session"
            variant="destructive"
            size="icon"
          >
            <Trash2 className="size-3" />
          </Button>
        )}
      </div>
    </button>
  );
}
