import { useState, useCallback } from 'react';
import { useAppStore } from '../../hooks/use-app-state';
import { focusTerminal } from '../../hooks/use-terminal';
import { SortableItem } from '../sidebar/SortableItem';
import { reorderList } from '../../lib/reorder-list';
import type { WindowInfo } from '../../../main/domain/types';

interface WindowTabProps {
  win: WindowInfo;
  scope: string;
  onClick: (name: string) => void;
  onClose: (e: React.MouseEvent, index: number) => void;
  onReorder: (draggedName: string, targetName: string, edge: 'top' | 'bottom') => void;
}

function WindowTab({ win, scope, onClick, onClose, onReorder }: WindowTabProps) {
  return (
    <SortableItem
      dragType="window-tab"
      itemId={win.name}
      scope={scope}
      orientation="horizontal"
      onReorder={onReorder}
      onDropEffect={focusTerminal}
    >
      <button
        onClick={() => onClick(win.name)}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className={`group/tab relative px-4 py-3.5 text-sm transition-colors border-b-2
          ${win.active
            ? 'border-b-accent text-foreground'
            : 'border-b-transparent text-foreground/60 hover:text-foreground hover:bg-muted'
          }`}
      >
        {win.name}
        <span
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => onClose(e, win.index)}
          className="absolute top-1 right-0.5 w-4 h-4 flex items-center justify-center rounded text-xs leading-none text-foreground/40 hover:text-foreground hover:bg-muted opacity-0 group-hover/tab:opacity-100 transition-opacity"
        >
          ×
        </span>
      </button>
    </SortableItem>
  );
}

export function TabBar() {
  const {
    windows,
    activeSession,
    remoteActiveSession,
    isRemoteSession,
    remotePtyChannelId,
    setWindows,
    setActiveSession,
    setRemoteActiveSession,
    setIsRemoteSession,
    setRemotePtyChannelId,
  } = useAppStore();
  const [isAdding, setIsAdding] = useState(false);

  // The session this tab bar operates on — local or remote.
  const session = isRemoteSession ? remoteActiveSession : activeSession;

  const handleReorder = useCallback(
    async (draggedName: string, targetName: string, edge: 'top' | 'bottom') => {
      if (!session) return;
      const names = windows.map((w) => w.name);
      const next = reorderList(names, draggedName, targetName, edge);
      const byName = new Map(windows.map((w) => [w.name, w]));
      setWindows(next.map((name) => byName.get(name)!).filter(Boolean));
      if (isRemoteSession) {
        await window.api.remoteSessionCommand('set-window-order', { session, names: next });
      } else {
        await window.api.setWindowOrder(session, next);
      }
    },
    [session, isRemoteSession, windows, setWindows],
  );

  if (windows.length === 0) return null;

  async function handleClick(windowName: string) {
    if (!session) return;
    setWindows(windows.map((w) => ({ ...w, active: w.name === windowName })));
    if (isRemoteSession) {
      await window.api.remoteSessionCommand('select-window', { session, window: windowName });
    } else {
      await window.api.selectWindow(session, windowName);
    }
    // The button briefly steals focus on mousedown — restore it to the terminal
    // so the user can keep typing. (This used to be done by preventDefault on
    // mousedown, but that path blocks pragmatic-drag-and-drop's drag-start.)
    focusTerminal();
  }

  async function handleAdd(name: string) {
    if (!session || !name.trim()) return;
    const trimmed = name.trim();
    const nextIndex = Math.max(...windows.map((w) => w.index)) + 1;
    setIsAdding(false);
    setWindows([
      ...windows.map((w) => ({ ...w, active: false })),
      { index: nextIndex, name: trimmed, active: true },
    ]);
    if (isRemoteSession) {
      await window.api.remoteSessionCommand('new-window', { session, name: trimmed });
    } else {
      await window.api.newWindow(session, trimmed);
    }
    focusTerminal();
  }

  async function handleClose(e: React.MouseEvent, windowIndex: number) {
    e.stopPropagation();
    if (!session) return;
    if (windows.length <= 1) {
      setActiveSession(null);
      if (isRemoteSession) {
        if (remotePtyChannelId !== null) {
          await window.api.remoteSessionCommand('detach-pty', { channelId: remotePtyChannelId });
        }
        setRemoteActiveSession(null);
        setIsRemoteSession(false);
        setRemotePtyChannelId(null);
        await window.api.remoteSessionCommand('sleep-session', { session });
      } else {
        await window.api.sleepSession(session);
      }
    } else {
      const remaining = windows.filter((w) => w.index !== windowIndex);
      if (!remaining.some((w) => w.active)) {
        remaining[0].active = true;
      }
      setWindows(remaining);
      if (isRemoteSession) {
        await window.api.remoteSessionCommand('kill-window', { session, windowIndex });
      } else {
        await window.api.killWindow(session, windowIndex);
      }
    }
  }

  const scope = `window-tabs:${session ?? ''}`;

  return (
    <div className="flex justify-center bg-bg px-2 gap-0.5 shrink-0" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      {windows.map((w) => (
        <WindowTab
          key={w.index}
          win={w}
          scope={scope}
          onClick={handleClick}
          onClose={handleClose}
          onReorder={handleReorder}
        />
      ))}

      {isAdding ? (
        <input
          autoFocus
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="px-4 py-3.5 text-sm bg-transparent text-foreground border-b-2 border-b-accent outline-none w-32"
          placeholder="Tab name…"
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd(e.currentTarget.value);
            if (e.key === 'Escape') setIsAdding(false);
          }}
          onBlur={() => setIsAdding(false)}
        />
      ) : (
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setIsAdding(true)}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="px-4 py-3.5 text-sm text-foreground/40 hover:text-foreground transition-colors border-b-2 border-b-transparent"
        >
          +
        </button>
      )}
    </div>
  );
}
