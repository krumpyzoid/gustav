import { describe, it, expect, vi } from 'vitest';
import { createPtyDataFanout } from '../pty-data-fanout';

describe('createPtyDataFanout', () => {
  it('dispatches incoming bytes to all current subscribers', () => {
    const fanout = createPtyDataFanout<string>();
    const a = vi.fn();
    const b = vi.fn();
    fanout.subscribe(a);
    fanout.subscribe(b);

    fanout.dispatch('hello');

    expect(a).toHaveBeenCalledWith('hello');
    expect(b).toHaveBeenCalledWith('hello');
  });

  it('stops delivering to a subscriber once it unsubscribes', () => {
    const fanout = createPtyDataFanout<string>();
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = fanout.subscribe(a);
    fanout.subscribe(b);

    unsubA();
    fanout.dispatch('after');

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith('after');
  });

  it('subscribe returns an idempotent unsubscribe (calling twice is safe)', () => {
    const fanout = createPtyDataFanout<string>();
    const a = vi.fn();
    const unsub = fanout.subscribe(a);

    unsub();
    expect(() => unsub()).not.toThrow();
    fanout.dispatch('after');
    expect(a).not.toHaveBeenCalled();
  });

  it('does not lose bytes during a synchronous unsubscribe-then-resubscribe (transport swap)', () => {
    const fanout = createPtyDataFanout<string>();
    const oldCb = vi.fn();
    const newCb = vi.fn();

    const unsubOld = fanout.subscribe(oldCb);
    // Simulate a transport swap: synchronous unsubscribe followed
    // immediately by a re-subscribe with the new callback.
    unsubOld();
    fanout.subscribe(newCb);

    // A byte arriving NOW must reach the new subscriber, not the old.
    fanout.dispatch('post-swap');
    expect(oldCb).not.toHaveBeenCalled();
    expect(newCb).toHaveBeenCalledWith('post-swap');
  });

  it('dispatching with no subscribers is a no-op (does not throw)', () => {
    const fanout = createPtyDataFanout<string>();
    expect(() => fanout.dispatch('orphan')).not.toThrow();
  });

  it('a subscriber that throws does not prevent other subscribers from receiving the byte', () => {
    const fanout = createPtyDataFanout<string>();
    const failing = vi.fn(() => { throw new Error('boom'); });
    const ok = vi.fn();
    fanout.subscribe(failing);
    fanout.subscribe(ok);

    fanout.dispatch('msg');

    expect(failing).toHaveBeenCalled();
    expect(ok).toHaveBeenCalledWith('msg');
  });

  it('a subscriber added during dispatch does NOT receive the in-flight byte', () => {
    const fanout = createPtyDataFanout<string>();
    const lateCb = vi.fn();
    const firstCb = vi.fn(() => {
      // The first callback subscribes a new one mid-dispatch.
      fanout.subscribe(lateCb);
    });
    fanout.subscribe(firstCb);

    fanout.dispatch('once');

    expect(firstCb).toHaveBeenCalledWith('once');
    // The late subscriber must not see the byte that triggered its
    // own registration — that's what set-snapshot dispatch guarantees.
    expect(lateCb).not.toHaveBeenCalled();
  });
});
