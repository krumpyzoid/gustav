import { useState, useEffect } from 'react';
import type { ClaudeStatus } from '../../../main/domain/types';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL = 100;

function BusySpinner() {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), SPINNER_INTERVAL);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="text-c3 text-sm font-mono leading-none">
      {SPINNER_FRAMES[frame]}
    </span>
  );
}

export function StatusIcon({ status }: { status: ClaudeStatus }) {
  switch (status) {
    case 'busy':
      return <BusySpinner />;
    case 'action':
      return <span className="inline-block w-2 h-2 rounded-full bg-c1 shrink-0" />;
    case 'done':
      return <span className="text-c2 text-sm font-mono leading-none">✓</span>;
    case 'new':
      return <span className="inline-block w-2 h-2 rounded-full bg-foreground/20 shrink-0" />;
    case 'none':
    default:
      return null;
  }
}
