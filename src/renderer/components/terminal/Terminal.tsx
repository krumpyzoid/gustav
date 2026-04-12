import { useRef } from 'react';
import { useTerminal } from '../../hooks/use-terminal';
import { TabBar } from './TabBar';

export function TerminalView() {
  const containerRef = useRef<HTMLDivElement>(null);
  useTerminal(containerRef);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg">
      <TabBar />
      <div
        ref={containerRef}
        className="flex-1 border border-border rounded-lg overflow-hidden [&_.xterm]:h-full [&_.xterm]:p-4 [&_.xterm-viewport]:!scrollbar-none"
      />
    </div>
  );
}
