import { useAppStore } from '../../hooks/use-app-state';

export function TabBar() {
  const { windows, activeSession } = useAppStore();

  if (windows.length === 0) return null;

  async function handleClick(windowName: string) {
    if (!activeSession) return;
    await window.api.selectWindow(activeSession, windowName);
  }

  return (
    <div className="flex bg-bg border-b border-c0 px-2 gap-0.5 shrink-0">
      {windows.map((w) => (
        <button
          key={w.index}
          onClick={() => handleClick(w.name)}
          className={`px-3 py-1.5 text-sm transition-colors border-b-2
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
