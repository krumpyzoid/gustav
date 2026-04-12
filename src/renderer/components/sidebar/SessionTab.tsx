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
}

export function SessionTab({ tab, workspaceName, workspaceDir, repoRoot, onRequestRemove }: Props) {
  const { activeSession, setActiveSession, setWindows } = useAppStore();
  const isSelected = tab.tmuxSession === activeSession;
  const isInactive = !tab.active;
  const label = statusLabel(tab.status);

  async function handleClick() {
    if (isInactive && tab.type === 'workspace' && workspaceName && workspaceDir) {
      // Extract label from tmux session name (e.g. "dev/Cocorico" → "Cocorico", "dev/_ws" → undefined)
      const parts = tab.tmuxSession.split('/');
      const last = parts[parts.length - 1];
      const label = last === '_ws' ? undefined : last;
      const result = await window.api.createWorkspaceSession(workspaceName, workspaceDir, label);
      if (result.success) {
        setActiveSession(result.data);
        const switchResult = await window.api.switchSession(result.data);
        if (switchResult.success) setWindows(switchResult.data as WindowInfo[]);
        refreshState();
      }
      return;
    }
    if (isInactive && tab.type === 'worktree' && workspaceName && repoRoot && tab.branch && tab.worktreePath) {
      const result = await window.api.launchWorktreeSession(workspaceName, repoRoot, tab.branch, tab.worktreePath);
      if (result.success) {
        setActiveSession(result.data);
        const switchResult = await window.api.switchSession(result.data);
        if (switchResult.success) setWindows(switchResult.data as WindowInfo[]);
        refreshState();
      }
      return;
    }
    if (isInactive && tab.type === 'directory' && workspaceName && repoRoot) {
      const result = await window.api.createRepoSession(workspaceName, repoRoot, 'directory');
      if (result.success) {
        setActiveSession(result.data);
        const switchResult = await window.api.switchSession(result.data);
        if (switchResult.success) setWindows(switchResult.data as WindowInfo[]);
        refreshState();
      }
      return;
    }
    if (isInactive) return;
    setActiveSession(tab.tmuxSession);
    const result = await window.api.switchSession(tab.tmuxSession);
    if (result.success) setWindows(result.data as WindowInfo[]);
  }

  async function handleSleep(e: React.MouseEvent) {
    e.stopPropagation();
    await window.api.sleepSession(tab.tmuxSession);
    refreshState();
  }

  async function handleDestroy(e: React.MouseEvent) {
    e.stopPropagation();
    await window.api.destroySession(tab.tmuxSession);
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
