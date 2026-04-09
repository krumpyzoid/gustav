import { useRef, useEffect, useState } from 'react';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { focusTerminal } from '../../hooks/use-terminal';

type DragState = 'idle' | 'dragging' | 'over-top' | 'over-bottom';

interface Props {
  dragType: string;
  itemId: string;
  scope: string; // e.g. workspaceId or workspaceId:repoName — prevents cross-container drops
  dragHandleRef?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  onReorder: (draggedId: string, targetId: string, edge: 'top' | 'bottom') => void;
}

export function SortableItem({ dragType, itemId, scope, dragHandleRef, children, onReorder }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<DragState>('idle');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    return combine(
      draggable({
        element: el,
        dragHandle: dragHandleRef?.current ?? el,
        getInitialData: () => ({ type: dragType, itemId, scope }),
        onDragStart: () => setDragState('dragging'),
        onDrop: () => { setDragState('idle'); focusTerminal(); },
      }),
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) =>
          source.data.type === dragType &&
          source.data.scope === scope &&
          source.data.itemId !== itemId,
        getData: () => ({ type: dragType, itemId, scope }),
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
          const draggedId = source.data.itemId as string;
          const rect = el.getBoundingClientRect();
          const mid = rect.top + rect.height / 2;
          const edge = location.current.input.clientY < mid ? 'top' : 'bottom';
          onReorder(draggedId, itemId, edge);
        },
      }),
    );
  }, [dragType, itemId, scope, dragHandleRef, onReorder]);

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
