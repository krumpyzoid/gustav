import { useAppStore } from '../../hooks/use-app-state';

export function TabBar() {
  const { windows, activeSession, setWindows } = useAppStore();

  if (windows.length === 0) return null;

  async function handleClick(windowName: string) {
    if (!activeSession) return;
    // Optimistic update — highlight immediately, don't wait for poll
    setWindows(windows.map((w) => ({ ...w, active: w.name === windowName })));
    await window.api.selectWindow(activeSession, windowName);
  }

  return (
    <div className="flex bg-bg border-b border-c0 px-2 gap-0.5 shrink-0">
      {windows.map((w) => (
        <button
          key={w.index}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleClick(w.name)}
          className={`px-3 py-3 text-sm transition-colors border-b-2
            ${w.active
              ? 'border-b-accent text-fg'
              : 'border-b-transparent text-fg/60 hover:text-fg hover:bg-c0'
            }`}
        >
          {w.name}
        </button>
      ))}
    </div>
  );
}
