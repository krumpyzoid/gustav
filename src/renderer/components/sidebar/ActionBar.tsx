interface Props {
  onNewSession: () => void;
  onClean: () => void;
}

export function ActionBar({ onNewSession, onClean }: Props) {
  return (
    <div className="px-3 py-2 border-t border-c0 flex gap-1.5">
      <button
        onClick={onNewSession}
        className="bg-c0 text-accent border-none px-2.5 py-1 rounded text-xs font-inherit cursor-pointer hover:opacity-80 transition-opacity"
      >
        + session
      </button>
      <button
        onClick={onClean}
        className="bg-c0 text-c5 border-none px-2.5 py-1 rounded text-xs font-inherit cursor-pointer hover:opacity-80 transition-opacity ml-auto"
      >
        🗑 clean
      </button>
    </div>
  );
}
