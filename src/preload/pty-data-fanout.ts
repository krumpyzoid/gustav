/**
 * Pure in-memory fan-out for PTY-data IPC streams.
 *
 * Why this exists (#16): without it, every renderer-side subscriber
 * registers its own `ipcRenderer.on('remote-pty-data', handler)` and
 * tears it down on unsubscribe. During a transport swap the old
 * subscriber is removed and the new one is added across two synchronous
 * operations, but those operations are *separated* in the renderer's
 * event-loop timeline by anything that runs between them — including
 * the React commit and effect cleanup chain. An IPC frame arriving in
 * that window has no listener and is dropped, leaving xterm.js to render
 * partial escape sequences (visible as "weird characters" and the
 * cumulative lag the user sees after several remote session swaps).
 *
 * The fix is to register the IPC handler exactly once, at preload load
 * time, and dispatch incoming bytes through this fan-out. Subscribers
 * register/unregister against an in-memory Set; there is no IPC churn
 * across swaps. As a side benefit, a subscriber that throws cannot break
 * delivery to its peers.
 */

export interface PtyDataFanout<T> {
  subscribe(cb: (value: T) => void): () => void;
  dispatch(value: T): void;
}

export function createPtyDataFanout<T>(): PtyDataFanout<T> {
  const subscribers = new Set<(value: T) => void>();

  return {
    subscribe(cb) {
      subscribers.add(cb);
      // Idempotent unsubscribe — calling twice is a no-op rather than
      // a delete-on-something-not-present surprise.
      return () => {
        subscribers.delete(cb);
      };
    },

    dispatch(value) {
      // Snapshot before iterating so a callback that subscribes during
      // dispatch does not receive the in-flight value (and a callback
      // that unsubscribes itself mid-dispatch finishes its own call but
      // is gone for the next dispatch). Standard observer semantics.
      const snapshot = Array.from(subscribers);
      for (const cb of snapshot) {
        try {
          cb(value);
        } catch (e) {
          // A throwing subscriber must not break delivery to its peers.
          // No console here — preload runs in a sandboxed context where
          // console output may not surface; the renderer-side wrapper
          // can choose to log.
        }
      }
    },
  };
}
