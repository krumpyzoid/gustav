import { useRef, useEffect, useState } from 'react';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { focusTerminal } from '../../hooks/use-terminal';

interface Props {
  workspaceId: string;
  children: React.ReactNode;
  onReorder: (draggedId: string, targetId: string, edge: 'top' | 'bottom') => void;
}

export function DraggableWorkspace({ workspaceId, children, onReorder }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<'idle' | 'dragging' | 'over-top' | 'over-bottom'>('idle');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    return combine(
      draggable({
        element: el,
        getInitialData: () => ({ workspaceId }),
        onDragStart: () => setDragState('dragging'),
        onDrop: () => { setDragState('idle'); focusTerminal(); },
      }),
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) => source.data.workspaceId !== workspaceId,
        getData: () => ({ workspaceId }),
        onDragEnter: ({ location }) => {
          const rect = el.getBoundingClientRect();
          const mid = rect.top + rect.height / 2;
          setDragState(location.current.input.clientY < mid ? 'over-top' : 'over-bottom');
        },
        onDrag: ({ location }) => {
          const rect = el.getBoundingClientRect();
          const mid = rect.top + rect.height / 2;
          setDragState(location.current.input.clientY < mid ? 'over-top' : 'over-bottom');
        },
        onDragLeave: () => setDragState('idle'),
        onDrop: ({ source, location }) => {
          setDragState('idle');
          const draggedId = source.data.workspaceId as string;
          const rect = el.getBoundingClientRect();
          const mid = rect.top + rect.height / 2;
          const edge = location.current.input.clientY < mid ? 'top' : 'bottom';
          onReorder(draggedId, workspaceId, edge);
        },
      }),
    );
  }, [workspaceId, onReorder]);

  const indicator =
    dragState === 'over-top' ? 'border-t-2 border-t-accent' :
    dragState === 'over-bottom' ? 'border-b-2 border-b-accent' :
    '';

  return (
    <div
      ref={ref}
      className={`${dragState === 'dragging' ? 'opacity-40' : ''} ${indicator}`}
    >
      {children}
    </div>
  );
}
