import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

interface Props {
  label: string;
  count: number;
  defaultExpanded?: boolean;
  children: ReactNode;
}

export function AccordionCategory({ label, count, defaultExpanded = true, children }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-sm font-bold tracking-widest uppercase text-foreground/60 bg-transparent border-t border-b border-border/50 cursor-pointer hover:text-foreground transition-colors"
      >
        <ChevronRight
          size={10}
          className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
        {label}
        <span className="text-c0 ml-0.5 font-normal">{count}</span>
      </button>
      {expanded && children}
    </div>
  );
}
