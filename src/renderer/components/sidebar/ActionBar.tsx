interface Props {
  onNewSession: () => void;
  onClean: () => void;
}

export function ActionBar({ onNewSession, onClean }: Props) {
  return (
    <div className="px-3 py-2 border-t border-border flex gap-1.5">
      <button
        onClick={onNewSession}
        className="bg-muted text-foreground/70 border-none px-2.5 py-1 rounded text-xs font-inherit cursor-pointer hover:text-foreground transition-colors"
      >
        + session
      </button>
      <button
        onClick={onClean}
        className="bg-muted text-foreground/70 border-none px-2.5 py-1 rounded text-xs font-inherit cursor-pointer hover:text-foreground transition-colors ml-auto"
      >
        🗑 clean
      </button>
    </div>
  );
}
