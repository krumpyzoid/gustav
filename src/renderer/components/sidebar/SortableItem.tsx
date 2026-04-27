import { useRef, useEffect, useState } from 'react';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { focusTerminal } from '../../hooks/use-terminal';

type DragState = 'idle' | 'dragging' | 'over-start' | 'over-end';

interface Props {
  dragType: string;
  itemId: string;
  scope: string; // e.g. workspaceId or workspaceId:repoName — prevents cross-container drops
  dragHandleRef?: React.RefObject<HTMLElement | null>;
  /** Visual layout of the list. Controls which axis the drop indicator uses. Defaults to vertical. */
  orientation?: 'vertical' | 'horizontal';
  children: React.ReactNode;
  onReorder: (draggedId: string, targetId: string, edge: 'top' | 'bottom') => void;
  onDropEffect?: () => void;
}

export function SortableItem({
  dragType,
  itemId,
  scope,
  dragHandleRef,
  orientation = 'vertical',
  children,
  onReorder,
  onDropEffect,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<DragState>('idle');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function isBefore(rect: DOMRect, x: number, y: number): boolean {
      if (orientation === 'horizontal') {
        const mid = rect.left + rect.width / 2;
        return x < mid;
      }
      const mid = rect.top + rect.height / 2;
      return y < mid;
    }

    return combine(
      draggable({
        element: el,
        dragHandle: dragHandleRef?.current ?? el,
        getInitialData: () => ({ type: dragType, itemId, scope }),
        onDragStart: () => setDragState('dragging'),
        onDrop: () => { setDragState('idle'); (onDropEffect ?? focusTerminal)(); },
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
          const before = isBefore(rect, location.current.input.clientX, location.current.input.clientY);
          setDragState(before ? 'over-start' : 'over-end');
        },
        onDrag: ({ location }) => {
          const rect = el.getBoundingClientRect();
          const before = isBefore(rect, location.current.input.clientX, location.current.input.clientY);
          setDragState(before ? 'over-start' : 'over-end');
        },
        onDragLeave: () => setDragState('idle'),
        onDrop: ({ source, location }) => {
          setDragState('idle');
          const draggedId = source.data.itemId as string;
          const rect = el.getBoundingClientRect();
          const before = isBefore(rect, location.current.input.clientX, location.current.input.clientY);
          // 'top' = before target, 'bottom' = after target. Names are kept for
          // backwards compatibility with reorderList; for horizontal lists they
          // mean left/right.
          onReorder(draggedId, itemId, before ? 'top' : 'bottom');
        },
      }),
    );
  }, [dragType, itemId, scope, dragHandleRef, orientation, onReorder, onDropEffect]);

  const indicatorBefore = orientation === 'horizontal' ? 'border-l-2 border-l-accent' : 'border-t-2 border-t-accent';
  const indicatorAfter = orientation === 'horizontal' ? 'border-r-2 border-r-accent' : 'border-b-2 border-b-accent';
  const indicator =
    dragState === 'over-start' ? indicatorBefore :
    dragState === 'over-end' ? indicatorAfter :
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
