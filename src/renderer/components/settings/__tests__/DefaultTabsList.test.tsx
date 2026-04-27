// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TabConfig } from '../../../../main/domain/tab-config';

type SortableProps = {
  itemId: string;
  scope: string;
  onReorder: (draggedId: string, targetId: string, edge: 'top' | 'bottom') => void;
  onDropEffect?: () => void;
};

const sortableProps: Record<string, SortableProps> = {};

vi.mock('../../sidebar/SortableItem', () => ({
  SortableItem: ({
    children,
    itemId,
    scope,
    onReorder,
    onDropEffect,
  }: SortableProps & { children: React.ReactNode }) => {
    sortableProps[itemId] = { itemId, scope, onReorder, onDropEffect };
    return <div data-testid={`sortable-${itemId}`}>{children}</div>;
  },
}));

import { DefaultTabsList } from '../DefaultTabsList';

beforeEach(() => {
  for (const k of Object.keys(sortableProps)) delete sortableProps[k];
});

/** Test harness: controlled wrapper that pipes onChange back into props
 *  so user events accumulate as they would in real usage. The spy is
 *  called with every emitted list. */
function ControlledList({
  initial,
  spy,
  scope = 'test-scope',
}: {
  initial: TabConfig[];
  spy?: (tabs: TabConfig[]) => void;
  scope?: string;
}) {
  const [tabs, setTabs] = useState(initial);
  return (
    <DefaultTabsList
      tabs={tabs}
      scope={scope}
      onChange={(next) => {
        spy?.(next);
        setTabs(next);
      }}
    />
  );
}

const initial: TabConfig[] = [
  { id: '1', name: 'Claude Code', kind: 'claude', appliesTo: 'both' },
  { id: '2', name: 'Git', kind: 'command', command: 'lazygit', appliesTo: 'repository' },
  { id: '3', name: 'Shell', kind: 'command', appliesTo: 'both' },
];

describe('DefaultTabsList', () => {
  it('renders one row per tab with the tab name as the input value', () => {
    render(<DefaultTabsList tabs={initial} scope="s" onChange={() => {}} />);
    expect(screen.getByDisplayValue('Claude Code')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Git')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Shell')).toBeInTheDocument();
  });

  it('always renders the appliesTo select on every row', () => {
    render(<DefaultTabsList tabs={initial} scope="s" onChange={() => {}} />);
    expect(screen.getByLabelText(/applies to for claude code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/applies to for git/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/applies to for shell/i)).toBeInTheDocument();
  });

  it('calls onChange with the renamed tab when name input changes', async () => {
    const spy = vi.fn();
    render(<ControlledList initial={initial} spy={spy} />);
    const input = screen.getByDisplayValue('Shell');

    await userEvent.clear(input);
    await userEvent.type(input, 'Term');

    expect(spy).toHaveBeenCalled();
    const last = spy.mock.calls.at(-1)![0] as TabConfig[];
    expect(last.find((t) => t.id === '3')?.name).toBe('Term');
  });

  it('adds a new row when "Add tab" is clicked', async () => {
    const onChange = vi.fn();
    render(<DefaultTabsList tabs={initial} scope="s" onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: /add tab/i }));

    expect(onChange).toHaveBeenCalledOnce();
    const next = onChange.mock.calls[0][0] as TabConfig[];
    expect(next).toHaveLength(4);
    expect(next[3]).toMatchObject({ name: 'New Tab', kind: 'command' });
  });

  it('removes a row when its delete button is clicked', async () => {
    const onChange = vi.fn();
    render(<DefaultTabsList tabs={initial} scope="s" onChange={onChange} />);

    const deleteBtns = screen.getAllByRole('button', { name: /delete tab/i });
    await userEvent.click(deleteBtns[1]); // Git row

    expect(onChange).toHaveBeenCalledOnce();
    const next = onChange.mock.calls[0][0] as TabConfig[];
    expect(next.map((t) => t.id)).toEqual(['1', '3']);
  });

  it('switches kind to command and clears args when changed from claude', async () => {
    const claudeOnly: TabConfig[] = [
      { id: '1', name: 'Claude', kind: 'claude', args: '--foo', appliesTo: 'both' },
    ];
    const onChange = vi.fn();
    render(<DefaultTabsList tabs={claudeOnly} scope="s" onChange={onChange} />);

    const kindSelect = screen.getByLabelText(/kind for claude/i);
    await userEvent.selectOptions(kindSelect, 'command');

    const next = onChange.mock.calls.at(-1)![0] as TabConfig[];
    expect(next[0].kind).toBe('command');
    expect(next[0].args).toBeUndefined();
  });

  it('renders an empty state when no tabs are configured', () => {
    render(<DefaultTabsList tabs={[]} scope="s" onChange={() => {}} />);
    expect(screen.getByText(/no tabs configured/i)).toBeInTheDocument();
  });

  it('renders a drag handle for every row', () => {
    render(<DefaultTabsList tabs={initial} scope="s" onChange={() => {}} />);
    expect(screen.getByLabelText(/drag handle for claude code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/drag handle for git/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/drag handle for shell/i)).toBeInTheDocument();
  });

  it('forwards the scope prop to every SortableItem', () => {
    render(<DefaultTabsList tabs={initial} scope="my-scope" onChange={() => {}} />);
    expect(sortableProps['1'].scope).toBe('my-scope');
    expect(sortableProps['2'].scope).toBe('my-scope');
    expect(sortableProps['3'].scope).toBe('my-scope');
  });

  it('passes a no-op onDropEffect so the terminal is not refocused on drop', () => {
    render(<DefaultTabsList tabs={initial} scope="s" onChange={() => {}} />);
    // All three rows must opt out of the default focusTerminal behavior.
    for (const id of ['1', '2', '3']) {
      const fn = sortableProps[id].onDropEffect;
      expect(fn).toBeTypeOf('function');
      // Calling it must do nothing observable (i.e. not throw).
      expect(() => fn!()).not.toThrow();
    }
  });

  it('reorders tabs by id when SortableItem fires onReorder above the target', () => {
    const spy = vi.fn();
    render(<ControlledList initial={initial} spy={spy} />);

    // Drag id="3" (Shell) above id="1" (Claude Code).
    sortableProps['3'].onReorder('3', '1', 'top');

    expect(spy).toHaveBeenCalledOnce();
    const next = spy.mock.calls[0][0] as TabConfig[];
    expect(next.map((t) => t.id)).toEqual(['3', '1', '2']);
  });

  it('reorders tabs by id when SortableItem fires onReorder below the target', () => {
    const spy = vi.fn();
    render(<ControlledList initial={initial} spy={spy} />);

    // Drag id="1" (Claude Code) below id="3" (Shell).
    sortableProps['1'].onReorder('1', '3', 'bottom');

    expect(spy).toHaveBeenCalledOnce();
    const next = spy.mock.calls[0][0] as TabConfig[];
    expect(next.map((t) => t.id)).toEqual(['2', '3', '1']);
  });
});
