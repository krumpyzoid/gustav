import { useCallback, useRef } from 'react';

interface Props {
  sidebarRef: React.RefObject<HTMLElement | null>;
  onResize: () => void;
}

export function ResizeHandle({ sidebarRef, onResize }: Props) {
  const dragging = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();

    function onMouseMove(e: MouseEvent) {
      if (!dragging.current || !sidebarRef.current) return;
      const newWidth = Math.max(120, Math.min(400, e.clientX));
      sidebarRef.current.style.width = `${newWidth}px`;
      sidebarRef.current.style.minWidth = `${newWidth}px`;
      onResize();
    }

    function onMouseUp() {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      onResize();
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [sidebarRef, onResize]);

  return (
    <div
      onMouseDown={onMouseDown}
      className="w-1 cursor-col-resize bg-c0 hover:bg-accent transition-colors"
    />
  );
}
