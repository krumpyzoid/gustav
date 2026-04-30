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
import { chooseCreateCall } from './create-call-selector';

/**
 * Module-level click-sequence counter shared by every `SessionTab` instance
 * in the sidebar. Each click bumps it and captures a ticket; after the
 * `switchSession` round-trip, a handler whose ticket no longer matches the
 * latest value treats itself as superseded and discards its result. This is
 * the cross-tab "latest wins" policy — without it, fast cycles between
 * different session tabs leave the user on whichever switchSession resolved
 * last in *server queue order*, not the last one the user actually clicked.
 */
let switchSequence = 0;

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

  async function handleClick() {
    // Latest-wins: each click bumps the module-level sequence counter and
    // captures its own ticket. After awaiting the network round-trip, a
    // handler whose ticket no longer matches the current counter discards
    // its result — preventing a fast burst of clicks from leaving the
    // user on whichever session happened to *resolve last in the order
    // the server queue processed them*. The latest click always wins,
    // and superseded handlers detach their unused transport so the
    // server-side PTY channel is not orphaned.
    const ticket = ++switchSequence;
    await handleClickInner(ticket);
  }

  async function handleClickInner(ticket: number) {
    if (isRemote) {
      await handleRemoteClick(ticket);
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
      // Dispatch through `chooseCreateCall` so the local and remote paths
      // share one decision point and the missing-prop case becomes
      // auditable instead of a silent no-op (#18).
      const choice = chooseCreateCall(tab, { workspaceName, workspaceDir, repoRoot });
      if (choice.kind === 'unsupported') {
        console.error(`[gustav] cannot start session for ${tab.tmuxSession}: ${choice.reason}`);
        refreshState();
        return;
      }
      let result: { success: boolean; data?: string; error?: string } | undefined;
      if (choice.kind === 'workspace') {
        result = await window.api.createWorkspaceSession(choice.workspaceName, choice.workspaceDir, choice.label);
      } else if (choice.kind === 'worktree') {
        result = await window.api.launchWorktreeSession(choice.workspaceName, choice.repoRoot, choice.branch, choice.worktreePath);
      } else if (choice.kind === 'directory') {
        result = await window.api.createRepoSession(choice.workspaceName, choice.repoRoot, 'directory');
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

  async function handleRemoteClick(ticket: number) {
    // The session id we end up attaching may not be the same as `tab.tmuxSession`:
    // for a killed session, the create-* path returns a fresh id.
    let sessionToAttach = tab.tmuxSession;

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
          // Killed-session restart: wake has nothing persisted to bring
          // back. Fall back to fresh creation, mirroring the local path
          // and routing through the same `chooseCreateCall` selector
          // (#18) so the two paths can't drift apart.
          const choice = chooseCreateCall(tab, { workspaceName, workspaceDir, repoRoot });
          if (choice.kind === 'unsupported') {
            console.error(`[gustav] cannot start remote session for ${tab.tmuxSession}: ${choice.reason}`);
            refreshState();
            return;
          }
          let createResult: { success: boolean; data?: string; error?: string } | undefined;
          if (choice.kind === 'workspace') {
            createResult = await wakeTransport.createWorkspaceSession(choice.workspaceName, choice.workspaceDir, choice.label);
          } else if (choice.kind === 'worktree') {
            createResult = await wakeTransport.createRepoSession(choice.workspaceName, choice.repoRoot, 'worktree', choice.branch);
          } else if (choice.kind === 'directory') {
            createResult = await wakeTransport.createRepoSession(choice.workspaceName, choice.repoRoot, 'directory');
          }
          if (!createResult?.success || !createResult.data) {
            console.error('Remote create after killed session failed:', createResult?.error);
            refreshState();
            return;
          }
          sessionToAttach = createResult.data;
        }
      } finally {
        wakeTransport.detach();
      }
    }

    // Detach the previous transport NOW — before the multi-second
    // attach-pty round-trip — so its `onPtyData` listener stops painting
    // OLD-channel frames into the xterm viewport during the swap.
    //
    // Why this matters: `useTerminal` subscribes to `activeTransport.onPtyData`
    // and only re-runs that effect when `activeTransport` changes. The
    // store doesn't flip until `setActiveTransport(remoteTransport)` runs
    // *after* the await below. For the entire 3-5s round-trip the OLD
    // transport stays the active one, its fanout subscriber stays alive,
    // and its filter (`channelId === this.ptyChannelId`) keeps matching
    // the OLD channel — so the user sees the previous session's content
    // shifting/updating the whole time, then a sudden snap to the new
    // session. The new transport's own `switchSession` cleanup only
    // detaches *its* `ptyChannelId`, which is null for a freshly
    // constructed instance, so it can't release the previous channel.
    //
    // detach() is idempotent — `setActiveTransport(remoteTransport)` below
    // calls it again on the same instance and that's a no-op. Tradeoff:
    // on attach-pty failure, the rollback below restores the prior session
    // id but the terminal stays frozen at its last frame until the user
    // re-clicks (the prior PTY channel is gone server-side). Acceptable
    // — failure here is rare and the previous behaviour painted live OLD
    // content over the optimistic new selection regardless.
    useAppStore.getState().activeTransport.detach();

    // Optimistic UI update — the sidebar's selection indicator and the
    // window-tab bar react immediately, so the user sees feedback while
    // the remote `attach-pty` + `list-windows` round-trips run. Without
    // this, the click looks dead for the duration of the round-trip
    // (often 3-5 seconds on a remote host). Capture the prior selection
    // for rollback on failure.
    const priorActive = useAppStore.getState().activeSession;
    const priorRemoteActive = useAppStore.getState().remoteActiveSession;
    setActiveSession(null);
    setRemoteActiveSession(sessionToAttach);
    // Clear the window-tab bar so we don't render stale tabs from the
    // previous session against the new selection. The TabBar early-returns
    // when `windows.length === 0`.
    setWindows([]);

    // Install a fresh RemoteGustavTransport for ongoing PTY I/O. Pass the
    // live terminal size so the remote PTY is spawned at the actual
    // viewport dimensions — without this the user sees a 80x24 layout
    // until they resize the OS window (#14).
    const remoteTransport = new RemoteGustavTransport();
    const size = getTerminalSize() ?? undefined;
    const result = await remoteTransport.switchSession(sessionToAttach, size);

    // Latest-wins: a click that arrived later has already incremented the
    // counter past our ticket. Detach the unused transport (so its
    // server-side PTY channel doesn't orphan) and abandon — leave the
    // store untouched so the LATER click's optimistic state and eventual
    // result remain authoritative.
    if (ticket !== switchSequence) {
      remoteTransport.detach();
      return;
    }

    if (result.success) {
      setActiveTransport(remoteTransport);
      setWindows(result.data);
      // The hook's [activeTransport] effect now drives the post-swap fit
      // (#16). We no longer call `requestTerminalFit()` here — calling it
      // before React commits the new transport would race the data
      // subscription, which is the bug #16 was filed to fix.
    } else {
      remoteTransport.detach();
      // Roll back the optimistic selection so the sidebar reflects what
      // the user actually has attached.
      setActiveSession(priorActive);
      setRemoteActiveSession(priorRemoteActive);
      refreshState();
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
