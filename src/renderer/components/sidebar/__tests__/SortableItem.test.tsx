// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

type DraggableConfig = {
  element: HTMLElement;
  dragHandle?: HTMLElement;
  getInitialData: () => Record<string, unknown>;
  onDragStart?: () => void;
  onDrop?: () => void;
};

let captured: DraggableConfig | null = null;

vi.mock('@atlaskit/pragmatic-drag-and-drop/element/adapter', () => ({
  draggable: (config: DraggableConfig) => {
    captured = config;
    return () => {};
  },
  dropTargetForElements: () => () => {},
}));

vi.mock('@atlaskit/pragmatic-drag-and-drop/combine', () => ({
  combine: (...cleanups: Array<() => void>) => () => cleanups.forEach((c) => c()),
}));

const focusTerminal = vi.fn();
vi.mock('../../../hooks/use-terminal', () => ({
  focusTerminal: () => focusTerminal(),
}));

import { SortableItem } from '../SortableItem';

beforeEach(() => {
  captured = null;
  focusTerminal.mockReset();
});

describe('SortableItem onDropEffect', () => {
  it('runs focusTerminal on drop when no onDropEffect is provided', () => {
    render(
      <SortableItem dragType="x" itemId="a" scope="s" onReorder={() => {}}>
        row
      </SortableItem>,
    );

    expect(captured).not.toBeNull();
    captured!.onDrop?.();

    expect(focusTerminal).toHaveBeenCalledOnce();
  });

  it('runs onDropEffect instead of focusTerminal when provided', () => {
    const onDropEffect = vi.fn();
    render(
      <SortableItem
        dragType="x"
        itemId="a"
        scope="s"
        onReorder={() => {}}
        onDropEffect={onDropEffect}
      >
        row
      </SortableItem>,
    );

    expect(captured).not.toBeNull();
    captured!.onDrop?.();

    expect(onDropEffect).toHaveBeenCalledOnce();
    expect(focusTerminal).not.toHaveBeenCalled();
  });
});
