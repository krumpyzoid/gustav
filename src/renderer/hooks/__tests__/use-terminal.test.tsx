// @vitest-environment jsdom
//
// Regression fence for the #15 invariant: bytes emitted by xterm.js's
// onData (typed keys AND auto-generated terminal protocol replies like
// DA1 `\x1b[?1;2c`) MUST reach `transport.sendPtyInput` and MUST NEVER
// be delivered into `term.write`. If the hook ever routes `onData`
// output back into the visible buffer (or buffers it across a transport
// swap and replays it into `write`), this test fails.
//
// We mock `@xterm/xterm` so this test doesn't need a real DOM/canvas.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRef } from 'react';

// Capture the onData callback registered by the hook so the test can
// fire synthetic xterm.js emissions.
const captured = {
  onDataCb: null as ((data: string) => void) | null,
  writeCalls: [] as string[],
};

const fakeTermInstance = {
  cols: 173,
  rows: 47,
  loadAddon: vi.fn(),
  open: vi.fn(),
  attachCustomKeyEventHandler: vi.fn(),
  attachCustomWheelEventHandler: vi.fn(),
  onSelectionChange: vi.fn(),
  onData: vi.fn((cb: (data: string) => void) => {
    captured.onDataCb = cb;
  }),
  write: vi.fn((data: string) => {
    captured.writeCalls.push(data);
  }),
  focus: vi.fn(),
  dispose: vi.fn(),
  getSelection: vi.fn(() => ''),
  options: { fontSize: 13 },
};

vi.mock('@xterm/xterm', () => {
  // Constructor must be `new`-able — return an object whose methods
  // assign to/read from the test-scope `fakeTermInstance` and `captured`.
  function FakeTerminal(this: typeof fakeTermInstance) {
    Object.assign(this, fakeTermInstance);
  }
  return { Terminal: FakeTerminal };
});
vi.mock('@xterm/addon-fit', () => {
  function FakeFitAddon() {}
  FakeFitAddon.prototype.fit = vi.fn();
  return { FitAddon: FakeFitAddon };
});
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

// jsdom doesn't ship ResizeObserver — give the hook a no-op so its mount
// effect doesn't blow up.
class FakeResizeObserver {
  observe = () => {};
  unobserve = () => {};
  disconnect = () => {};
}
(globalThis as unknown as { ResizeObserver: typeof FakeResizeObserver }).ResizeObserver = FakeResizeObserver;

// Stub window.api so the hook's theme/clipboard wiring doesn't blow up.
beforeEach(() => {
  captured.onDataCb = null;
  captured.writeCalls = [];
  fakeTermInstance.onData.mockClear();
  fakeTermInstance.write.mockClear();
  // @ts-expect-error — partial window.api for tests
  globalThis.window.api = {
    getTheme: vi.fn(() => Promise.resolve({})),
    onThemeUpdate: vi.fn(() => () => {}),
    writeClipboard: vi.fn(),
  };
});

// Stub the store with a transport whose sendPtyInput we can assert.
const sendPtyInput = vi.fn();
const onPtyData = vi.fn(() => () => {});
const activeTransport = {
  kind: 'remote' as const,
  ownsWindows: true,
  sendPtyInput,
  sendPtyResize: vi.fn(),
  onPtyData,
};

vi.mock('../use-app-state', () => ({
  useAppStore: Object.assign(
    (selector: (s: { activeTransport: unknown }) => unknown) =>
      selector({ activeTransport }),
    {
      getState: () => ({ activeTransport }),
    },
  ),
}));

vi.mock('../use-keyboard-shortcuts', () => ({
  navigateSession: vi.fn(),
  navigateWindow: vi.fn(),
}));

vi.mock('../use-theme', () => ({
  xtermTheme: () => ({}),
}));

import { useTerminal, requestTerminalFit } from '../use-terminal';

describe('use-terminal — onData routing invariant (#15)', () => {
  beforeEach(() => {
    sendPtyInput.mockClear();
  });

  it('routes the DA1 reply (\\x1b[?1;2c) emitted via onData to sendPtyInput, never to term.write', () => {
    function HostHook() {
      const ref = useRef<HTMLDivElement>(null);
      // Pretend the container is laid out — we only need a non-null ref.
      if (ref.current === null) {
        ref.current = document.createElement('div');
      }
      useTerminal(ref);
      return null;
    }

    renderHook(() => HostHook());

    expect(captured.onDataCb).not.toBeNull();
    const writeCallsBefore = captured.writeCalls.length;

    // Simulate xterm.js emitting a DA1 reply.
    captured.onDataCb!('\x1b[?1;2c');

    expect(sendPtyInput).toHaveBeenCalledWith('\x1b[?1;2c');
    // Crucially: no extra term.write call was triggered by the onData event.
    expect(captured.writeCalls.length).toBe(writeCallsBefore);
  });

  it('routes a typed keystroke through onData → sendPtyInput, never to term.write', () => {
    function HostHook() {
      const ref = useRef<HTMLDivElement>(null);
      if (ref.current === null) {
        ref.current = document.createElement('div');
      }
      useTerminal(ref);
      return null;
    }

    renderHook(() => HostHook());

    const writeCallsBefore = captured.writeCalls.length;
    captured.onDataCb!('x');

    expect(sendPtyInput).toHaveBeenCalledWith('x');
    expect(captured.writeCalls.length).toBe(writeCallsBefore);
  });
});

describe('use-terminal — rAF use-after-unmount guard', () => {
  it('a rAF scheduled before unmount short-circuits without calling fitAddon or terminal methods', () => {
    // Capture the rAF callback so we can fire it manually after unmount.
    const rafCallbacks: FrameRequestCallback[] = [];
    const rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
      });

    function HostHook() {
      const ref = useRef<HTMLDivElement>(null);
      if (ref.current === null) {
        ref.current = document.createElement('div');
      }
      useTerminal(ref);
      return null;
    }

    const { unmount } = renderHook(() => HostHook());

    // Schedule a fit — under fake rAF the callback queues but does not run.
    requestTerminalFit();

    // Unmount before the queued rAF fires.
    unmount();

    // Now flush all queued rAF callbacks. The post-unmount fit must NOT
    // touch fitAddon.fit() or term.write — both of which would be acting
    // on a disposed Terminal instance.
    fakeTermInstance.write.mockClear();
    const writeCountBefore = fakeTermInstance.write.mock.calls.length;
    for (const cb of rafCallbacks) cb(performance.now());

    expect(fakeTermInstance.write.mock.calls.length).toBe(writeCountBefore);
    // The transport must not see a stale resize push for a disposed terminal either.
    expect(activeTransport.sendPtyResize).not.toHaveBeenCalled();

    rafSpy.mockRestore();
  });
});
