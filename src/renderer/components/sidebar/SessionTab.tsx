import { useRef } from 'react';
import type { SessionTab as SessionTabType, ClaudeStatus } from '../../../main/domain/types';
import { StatusIcon } from './StatusIcon';
import { useAppStore, refreshState } from '../../hooks/use-app-state';
import type { WindowInfo } from '../../../main/domain/types';
import { Button } from '../ui/button';
import { Folder, GitBranch, Moon, Terminal, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LocalTransport } from '../../lib/transport/local-transport';
import { RemoteGustavTransport } from '../../lib/transport/remote-transport';
import { getTerminalSize } from '../../hooks/use-terminal';

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
  const {
    activeSession,
    remoteActiveSession,
    setActiveSession,
    setWindows,
    setRemoteActiveSession,
    setActiveTransport,
  } = useAppStore();
  const isSelected = isRemote
    ? tab.tmuxSession === remoteActiveSession
    : tab.tmuxSession === activeSession;
  const isInactive = !tab.active;
  const label = statusLabel(tab.status);

  // Re-entry guard for click handlers: a rapid double-click could otherwise
  // open two PTY channels on the server (the first never gets detached
  // because the second `setActiveTransport` overwrites it). Drop concurrent
  // invocations until the in-flight one settles.
  const inFlightRef = useRef(false);

  async function handleClick() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      await handleClickInner();
    } finally {
      inFlightRef.current = false;
    }
  }

  async function handleClickInner() {
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
      // Fallback: create fresh session (for entries with no persisted snapshot).
      // Construct the transport eagerly so it can be detached on every error
      // path; only `setActiveTransport` callers transfer ownership to the store.
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
        const localTransport = new LocalTransport();
        const switchResult = await localTransport.switchSession(result.data);
        if (switchResult.success) {
          // Store takes ownership; previous transport detached automatically.
          setActiveTransport(localTransport);
          setWindows(switchResult.data as WindowInfo[]);
        } else {
          // The transport was never installed; release any tracked subscriptions.
          localTransport.detach();
        }
        refreshState();
      }
      return;
    }
    // Switching back to a local session — install a fresh LocalTransport.
    // The store's setActiveTransport calls detach() on the old transport,
    // which tears down any remote PTY channel.
    setRemoteActiveSession(null);
    const localTransport = new LocalTransport();
    const result = await localTransport.switchSession(tab.tmuxSession);
    if (result.success) {
      setActiveSession(tab.tmuxSession);
      setActiveTransport(localTransport);
      setWindows(result.data as WindowInfo[]);
    } else {
      localTransport.detach();
    }
  }

  async function handleRemoteClick() {
    if (isInactive) {
      // Wake the remote session first via a transient transport — the
      // persistent transport (below) attaches a PTY only after the
      // session exists on the remote side. Aborting on wake failure
      // prevents `tmux attach` from running against a non-existent
      // session and surfacing tmux's dying-tty banner in the terminal.
      const wakeTransport = new RemoteGustavTransport();
      try {
        const wakeResult = await wakeTransport.wakeSession(tab.tmuxSession);
        if (!wakeResult.success) {
          console.error('Remote wake failed:', wakeResult.error);
          refreshState();
          return;
        }
      } finally {
        wakeTransport.detach();
      }
    }

    // Install a fresh RemoteGustavTransport for ongoing PTY I/O. Any
    // prior transport (remote or local) is detached by the store, which
    // sends detach-pty for any outstanding remote channel. Pass the live
    // terminal size so the remote PTY is spawned at the actual viewport
    // dimensions — without this the user sees a 80x24 layout until they
    // resize the OS window (#14).
    const remoteTransport = new RemoteGustavTransport();
    const size = getTerminalSize() ?? undefined;
    const result = await remoteTransport.switchSession(tab.tmuxSession, size);
    if (result.success) {
      setActiveSession(null);
      setRemoteActiveSession(tab.tmuxSession);
      setActiveTransport(remoteTransport);
      setWindows(result.data);
    } else {
      remoteTransport.detach();
    }
  }

  // For one-off lifecycle commands (sleep / destroy) the transport choice
  // is determined by where the session lives, not by which transport is
  // currently bound for PTY I/O. We construct a transient adapter and
  // detach it after the one-shot call so any tracked subscriptions are
  // released even though the transport is never installed in the store.
  function transportForSession(): LocalTransport | RemoteGustavTransport {
    return isRemote ? new RemoteGustavTransport() : new LocalTransport();
  }

  async function handleSleep(e: React.MouseEvent) {
    e.stopPropagation();
    const t = transportForSession();
    try {
      await t.sleepSession(tab.tmuxSession);
    } finally {
      t.detach();
    }
    refreshState();
  }

  async function handleDestroy(e: React.MouseEvent) {
    e.stopPropagation();
    const t = transportForSession();
    try {
      await t.destroySession(tab.tmuxSession);
    } finally {
      t.detach();
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
