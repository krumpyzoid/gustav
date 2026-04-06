import { useState } from 'react';
import { useAppStore } from '../../hooks/use-app-state';

export function TabBar() {
  const { windows, activeSession, setWindows, setActiveSession } = useAppStore();
  const [isAdding, setIsAdding] = useState(false);

  if (windows.length === 0) return null;

  async function handleClick(windowName: string) {
    if (!activeSession) return;
    setWindows(windows.map((w) => ({ ...w, active: w.name === windowName })));
    await window.api.selectWindow(activeSession, windowName);
  }

  async function handleAdd(name: string) {
    if (!activeSession || !name.trim()) return;
    const trimmed = name.trim();
    const nextIndex = Math.max(...windows.map((w) => w.index)) + 1;
    setIsAdding(false);
    setWindows([
      ...windows.map((w) => ({ ...w, active: false })),
      { index: nextIndex, name: trimmed, active: true },
    ]);
    await window.api.newWindow(activeSession, trimmed);
  }

  async function handleClose(e: React.MouseEvent, windowIndex: number) {
    e.stopPropagation();
    if (!activeSession) return;
    if (windows.length <= 1) {
      setActiveSession(null);
      await window.api.killSession(activeSession);
    } else {
      const remaining = windows.filter((w) => w.index !== windowIndex);
      if (!remaining.some((w) => w.active)) {
        remaining[0].active = true;
      }
      setWindows(remaining);
      await window.api.killWindow(activeSession, windowIndex);
    }
  }

  return (
    <div className="flex bg-bg border-b border-c0 px-2 gap-0.5 shrink-0">
      {windows.map((w) => (
        <button
          key={w.index}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleClick(w.name)}
          className={`group/tab relative px-4 py-3.5 text-sm transition-colors border-b-2
            ${w.active
              ? 'border-b-accent text-fg'
              : 'border-b-transparent text-fg/60 hover:text-fg hover:bg-c0'
            }`}
        >
          {w.name}
          <span
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => handleClose(e, w.index)}
            className="absolute top-1 right-0.5 w-4 h-4 flex items-center justify-center rounded text-xs leading-none text-fg/40 hover:text-fg hover:bg-c0 opacity-0 group-hover/tab:opacity-100 transition-opacity"
          >
            ×
          </span>
        </button>
      ))}

      {isAdding ? (
        <input
          autoFocus
          className="px-4 py-3.5 text-sm bg-transparent text-fg border-b-2 border-b-accent outline-none w-32"
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
          className="px-4 py-3.5 text-sm text-fg/40 hover:text-fg transition-colors border-b-2 border-b-transparent"
        >
          +
        </button>
      )}
    </div>
  );
}
