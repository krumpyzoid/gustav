// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DefaultTabsList } from '../DefaultTabsList';
import type { TabConfig } from '../../../../main/domain/tab-config';

/** Test harness: controlled wrapper that pipes onChange back into props
 *  so user events accumulate as they would in real usage. The spy is
 *  called with every emitted list. */
function ControlledList({
  initial,
  spy,
}: {
  initial: TabConfig[];
  spy?: (tabs: TabConfig[]) => void;
}) {
  const [tabs, setTabs] = useState(initial);
  return (
    <DefaultTabsList
      tabs={tabs}
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
    render(<DefaultTabsList tabs={initial} onChange={() => {}} />);
    expect(screen.getByDisplayValue('Claude Code')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Git')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Shell')).toBeInTheDocument();
  });

  it('always renders the appliesTo select on every row', () => {
    render(<DefaultTabsList tabs={initial} onChange={() => {}} />);
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
    render(<DefaultTabsList tabs={initial} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: /add tab/i }));

    expect(onChange).toHaveBeenCalledOnce();
    const next = onChange.mock.calls[0][0] as TabConfig[];
    expect(next).toHaveLength(4);
    expect(next[3]).toMatchObject({ name: 'New Tab', kind: 'command' });
  });

  it('removes a row when its delete button is clicked', async () => {
    const onChange = vi.fn();
    render(<DefaultTabsList tabs={initial} onChange={onChange} />);

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
    render(<DefaultTabsList tabs={claudeOnly} onChange={onChange} />);

    const kindSelect = screen.getByLabelText(/kind for claude/i);
    await userEvent.selectOptions(kindSelect, 'command');

    const next = onChange.mock.calls.at(-1)![0] as TabConfig[];
    expect(next[0].kind).toBe('command');
    expect(next[0].args).toBeUndefined();
  });

  it('renders an empty state when no tabs are configured', () => {
    render(<DefaultTabsList tabs={[]} onChange={() => {}} />);
    expect(screen.getByText(/no tabs configured/i)).toBeInTheDocument();
  });
});
