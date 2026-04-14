# Plan: Gustav Remote Control

**Created**: 2026-04-14
**Branch**: main
**Status**: implemented
**Spec**: `specs/remote-control.md`

## Goal

Allow a macOS Gustav instance to connect to a remote Linux Gustav instance over the internet and operate it as if local — browsing workspaces, controlling sessions, typing into terminals, and forwarding dev server ports. The server remains fully usable locally with shared tmux access.

## Acceptance Criteria

- [ ] Server exposes a WSS server on a configurable port (default 7777)
- [ ] Server UI shows host info (IP, port, pairing code) in a settings panel
- [ ] Client can pair with server using host + port + 6-char code, exchanging Ed25519 keys
- [ ] Subsequent connections use mutual key auth (no code)
- [ ] All traffic is TLS-encrypted
- [ ] Connected client sees remote workspaces/sessions in a "Remote" sidebar section
- [ ] Client can create, switch, sleep, wake, and destroy remote sessions
- [ ] Attaching to a remote session streams PTY output to local xterm.js and relays input
- [ ] Terminal resize propagates to remote
- [ ] Ports detected from remote tmux panes appear in a Ports panel
- [ ] User can forward a detected port, creating a local TCP listener tunneled through WSS
- [ ] Graceful disconnect tears down tunnels; auto-reconnect on network drop
- [ ] Server remains fully usable locally while serving a remote client

## Steps

### Step 1: Remote protocol types and message framing

**Complexity**: standard
**RED**: Write tests for message serialization/deserialization — control messages (JSON text frames) and binary frame encoding/decoding (channel type byte + 4-byte channel ID + payload).
**GREEN**: Implement `src/main/remote/protocol.ts` with types (`RemoteMessage`, `BinaryFrame`, channel type constants) and encode/decode functions.
**REFACTOR**: None needed
**Files**: `src/main/remote/protocol.ts`, `src/main/remote/__tests__/protocol.test.ts`
**Commit**: `feat(remote): add protocol types and binary frame encoding`

### Step 2: Crypto utilities — key generation, pairing codes, challenge-response

**Complexity**: complex
**RED**: Write tests for: Ed25519 keypair generation, pairing code generation (6-char alphanumeric, expiry), challenge-response signing/verification, TLS self-signed cert generation.
**GREEN**: Implement `src/main/remote/crypto.ts` using Node.js `crypto` module (Ed25519 via `generateKeyPairSync('ed25519')`, `createSign`/`createVerify`, `randomBytes` for pairing codes, `generateKeyPairSync('rsa')` + `createCertificate` for self-signed TLS).
**REFACTOR**: Extract shared constants (code length, expiry duration)
**Files**: `src/main/remote/crypto.ts`, `src/main/remote/__tests__/crypto.test.ts`
**Commit**: `feat(remote): add crypto utilities for auth and TLS`

### Step 3: Remote server adapter — WSS server with TLS and connection lifecycle

**Complexity**: complex
**RED**: Write tests for: server starts/stops on a port, accepts WSS connections, rejects second client, emits connection/disconnection events, rate-limits failed auth (5/min).
**GREEN**: Implement `src/main/remote/remote-server.adapter.ts` using Node.js `https.createServer` + `ws` library. Server manages a single client slot, TLS with self-signed cert from Step 2, connection/disconnection callbacks.
**REFACTOR**: None needed
**Files**: `src/main/remote/remote-server.adapter.ts`, `src/main/remote/__tests__/remote-server.adapter.test.ts`
**Commit**: `feat(remote): add WSS server adapter with TLS and single-client enforcement`

### Step 4: Server auth handler — pairing and key-based reconnection

**Complexity**: complex
**RED**: Write tests for: pairing flow (valid code → key exchange → persisted), expired code rejection, invalid code rejection, key-based reconnection (challenge-response), code invalidation after successful pairing.
**GREEN**: Implement auth state machine in `src/main/remote/auth.service.ts`. Manages pairing codes, known hosts persistence (`~/.local/share/gustav/remote/known_hosts.json`), and challenge-response protocol. Integrates with crypto utilities from Step 2.
**REFACTOR**: None needed
**Files**: `src/main/remote/auth.service.ts`, `src/main/remote/__tests__/auth.service.test.ts`
**Commit**: `feat(remote): add auth service with pairing and key-based reconnection`

### Step 5: Server command dispatcher — bridge WebSocket commands to existing services

**Complexity**: standard
**RED**: Write tests for: dispatching `get-state` returns workspace state, dispatching `switch-session` / `sleep-session` / `wake-session` / `destroy-session` calls the correct service method, dispatching `create-*-session` calls session service, unknown commands return error.
**GREEN**: Implement `src/main/remote/command-dispatcher.ts`. Takes a command message from the WebSocket, maps it to the same service calls that `handlers.ts` uses, returns the result. Reuses `StateService`, `SessionService`, `WorkspaceService`, etc. by injection.
**REFACTOR**: Extract the shared logic between `handlers.ts` and the command dispatcher into reusable functions where it makes sense (e.g., `buildWindowSpecs`, `findClaudeSessionId`, `snapshotAndPersist`).
**Files**: `src/main/remote/command-dispatcher.ts`, `src/main/remote/__tests__/command-dispatcher.test.ts`
**Commit**: `feat(remote): add command dispatcher bridging WebSocket to services`

### Step 6: Server PTY manager — attach to remote tmux sessions for streaming

**Complexity**: standard
**RED**: Write tests for: attaching to a tmux session spawns a node-pty process, PTY output is emitted as binary frames, input binary frames are written to PTY stdin, resize messages resize the PTY, detach kills the PTY process, multiple sessions can be attached simultaneously.
**GREEN**: Implement `src/main/remote/pty-manager.ts`. Manages a map of `tmuxSession → pty.IPty` for remote client attachments. Each attachment runs `tmux attach -t <session>`. Emits binary frames (channel 0x01) on data, accepts input frames (channel 0x02).
**REFACTOR**: None needed
**Files**: `src/main/remote/pty-manager.ts`, `src/main/remote/__tests__/pty-manager.test.ts`
**Commit**: `feat(remote): add PTY manager for remote terminal streaming`

### Step 7: Port scanner service — detect listening ports on server

**Complexity**: standard
**RED**: Write tests for: parsing `ss -tlnp` output into port/PID pairs, regex matching of tmux pane output for port patterns (`localhost:NNNN`, `0.0.0.0:NNNN`, common framework strings), associating detected ports with tmux sessions via PID cross-reference.
**GREEN**: Implement `src/main/remote/port-scanner.service.ts`. Two detection strategies: (1) periodic `ss -tlnp` parsing, (2) pane output regex. Returns `DetectedPort[]` with session association.
**REFACTOR**: None needed
**Files**: `src/main/remote/port-scanner.service.ts`, `src/main/remote/__tests__/port-scanner.service.test.ts`
**Commit**: `feat(remote): add port scanner with ss and pane output detection`

### Step 8: Server port tunnel manager — TCP proxy for forwarded ports

**Complexity**: complex
**RED**: Write tests for: creating a tunnel (connect to localhost:PORT, relay data as binary frames), tearing down a tunnel, multiple concurrent tunnels with unique channel IDs, handling connection errors (target port not listening).
**GREEN**: Implement `src/main/remote/tunnel-manager.ts`. On `forward-port` command, opens a `net.Socket` to `localhost:<port>`, assigns a unique channel ID, relays data as binary frames (channel 0x03). Accepts incoming binary frames and writes to the socket.
**REFACTOR**: None needed
**Files**: `src/main/remote/tunnel-manager.ts`, `src/main/remote/__tests__/tunnel-manager.test.ts`
**Commit**: `feat(remote): add server-side TCP tunnel manager`

### Step 9: Remote service — orchestrate server-side components

**Complexity**: standard
**RED**: Write tests for: enabling/disabling remote access starts/stops the WSS server, state updates are broadcast to connected client, host info returns IP + port + pairing code, disconnect kicks client.
**GREEN**: Implement `src/main/remote/remote.service.ts`. Wires together: server adapter (Step 3), auth service (Step 4), command dispatcher (Step 5), PTY manager (Step 6), port scanner (Step 7), tunnel manager (Step 8). Subscribes to `StateService.onChange` and forwards state + detected ports to the client.
**REFACTOR**: None needed
**Files**: `src/main/remote/remote.service.ts`, `src/main/remote/__tests__/remote.service.test.ts`
**Commit**: `feat(remote): add remote service orchestrating all server components`

### Step 10: Server IPC channels and handlers — expose remote control to server's own UI

**Complexity**: trivial
**RED**: Write tests for new IPC channels: `enable-remote`, `disable-remote`, `get-host-info`, `disconnect-client`, `regenerate-code`.
**GREEN**: Add channels to `channels.ts`, register handlers in `handlers.ts` that delegate to `remote.service.ts`. Wire up in `index.ts`.
**REFACTOR**: None needed
**Files**: `src/main/ipc/channels.ts`, `src/main/ipc/handlers.ts`, `src/main/index.ts`, `src/preload/index.ts`
**Commit**: `feat(remote): add server-side IPC channels for remote host management`

### Step 11: Server "Pair" button and host info panel

**Complexity**: standard
**RED**: N/A (UI component — tested via integration)
**GREEN**: Add a "Pair" button to the top bar / settings area. Clicking it reveals a panel showing: the machine's IP + port + 6-char pairing code (copyable as a single string the client can paste). Pairing code has a 5-min expiry countdown with a "Regenerate" button. When a client is connected, the panel shows "Connected: \<client IP\>" with a "Disconnect" button. Add `src/renderer/components/settings/RemoteHostPanel.tsx`.
**REFACTOR**: None needed
**Files**: `src/renderer/components/settings/RemoteHostPanel.tsx`, `src/renderer/App.tsx` or settings parent
**Commit**: `feat(remote): add Pair button and host info panel on server`

### Step 12: Install `ws` dependency

**Complexity**: trivial
**RED**: N/A
**GREEN**: `npm install ws && npm install -D @types/ws`. Verify build still works.
**REFACTOR**: None needed
**Files**: `package.json`, `package-lock.json`
**Commit**: `chore: add ws dependency for remote WebSocket support`

Note: This step should be done whenever first needed (likely before Step 3). Listed separately for clarity.

### Step 13: Remote client adapter — WSS client with reconnection

**Complexity**: complex
**RED**: Write tests for: connecting to a WSS server, handling auth handshake (pairing + key-based), auto-reconnect with exponential backoff (1s, 2s, 4s, ... max 30s), emitting connection/disconnection events, sending/receiving text and binary frames.
**GREEN**: Implement `src/main/remote/remote-client.adapter.ts` using `ws` library. Manages connection state, TLS cert pinning, reconnection loop.
**REFACTOR**: None needed
**Files**: `src/main/remote/remote-client.adapter.ts`, `src/main/remote/__tests__/remote-client.adapter.test.ts`
**Commit**: `feat(remote): add WSS client adapter with reconnection`

### Step 14: Client port tunnel manager — local TCP listeners

**Complexity**: standard
**RED**: Write tests for: starting a local TCP listener on a port, relaying incoming TCP data as binary frames to the server, relaying binary frame responses back to the TCP socket, stopping a listener, handling port-in-use errors (suggest alternate port).
**GREEN**: Implement `src/main/remote/client-tunnel-manager.ts`. Uses `net.createServer` to listen locally, relays data as binary frames (channel 0x03) through the WebSocket.
**REFACTOR**: None needed
**Files**: `src/main/remote/client-tunnel-manager.ts`, `src/main/remote/__tests__/client-tunnel-manager.test.ts`
**Commit**: `feat(remote): add client-side TCP tunnel manager`

### Step 15: Remote client service — orchestrate client-side components

**Complexity**: standard
**RED**: Write tests for: connect/disconnect lifecycle, receiving state updates and exposing them, forwarding commands to server, PTY data relay (binary frames → callback), port forward start/stop lifecycle, restoring state on reconnect.
**GREEN**: Implement `src/main/remote/remote-client.service.ts`. Wires: client adapter (Step 13), client tunnel manager (Step 14). Provides methods: `connect()`, `disconnect()`, `sendCommand()`, `attachPty()`, `detachPty()`, `forwardPort()`, `stopForward()`. Emits state updates and PTY data for the renderer.
**REFACTOR**: None needed
**Files**: `src/main/remote/remote-client.service.ts`, `src/main/remote/__tests__/remote-client.service.test.ts`
**Commit**: `feat(remote): add remote client service`

### Step 16: Client IPC channels and handlers

**Complexity**: trivial
**RED**: Write tests for new IPC channels: `connect-remote`, `disconnect-remote`, `get-remote-state`, `remote-session-command`, `forward-port`, `stop-forward`, `get-saved-servers`.
**GREEN**: Add channels to `channels.ts`, register handlers in `handlers.ts` that delegate to `remote-client.service.ts`. Add preload API methods. Wire up in `index.ts`. Add event channels: `remote-state-update`, `remote-pty-data`, `remote-connection-status`.
**REFACTOR**: None needed
**Files**: `src/main/ipc/channels.ts`, `src/main/ipc/handlers.ts`, `src/main/index.ts`, `src/preload/index.ts`
**Commit**: `feat(remote): add client-side IPC channels for remote connection`

### Step 17: Extend Zustand store for remote state

**Complexity**: standard
**RED**: Write tests for `group-by-workspace` handling remote state (separate from local).
**GREEN**: Add to `AppStore`: `remoteState: WorkspaceAppState | null`, `remoteActiveSession: string | null`, `forwardedPorts: ForwardedPort[]`, `remoteConnectionStatus: 'disconnected' | 'connecting' | 'connected' | 'reconnecting'`. Add `setRemoteState()`, `setRemoteConnectionStatus()`, `setForwardedPorts()`.
**REFACTOR**: None needed
**Files**: `src/renderer/hooks/use-app-state.ts`, `src/renderer/lib/__tests__/group-by-workspace.test.ts`
**Commit**: `feat(remote): extend Zustand store with remote state`

### Step 18: Connect to Remote dialog

**Complexity**: standard
**RED**: N/A (UI component)
**GREEN**: Add `src/renderer/components/dialogs/ConnectRemoteDialog.tsx`. Primary input: a single paste-able field that accepts the connection string from the server's "Pair" panel (e.g., `100.64.0.1:7777:ABC123`), auto-parsed into host, port, and code. Also supports manual entry of individual fields. Saved servers dropdown for previously paired hosts. Calls `connect-remote` IPC on submit. Shows connection status and errors.
**REFACTOR**: None needed
**Files**: `src/renderer/components/dialogs/ConnectRemoteDialog.tsx`, `src/renderer/App.tsx`
**Commit**: `feat(remote): add Connect to Remote dialog`

### Step 19: Remote sidebar section

**Complexity**: standard
**RED**: N/A (UI component)
**GREEN**: Add `src/renderer/components/sidebar/RemoteSection.tsx`. Renders below local workspaces when `remoteState` is non-null. Shows remote workspaces, repo groups, and sessions using the same `WorkspaceAccordion` / `SessionTab` components but tagged as remote. Connection status indicator. Disconnect button. Clicking a remote session calls `remote-session-command` (switch) and switches terminal to remote PTY source.
**REFACTOR**: Extract any shared rendering logic between local and remote sidebar sections.
**Files**: `src/renderer/components/sidebar/RemoteSection.tsx`, `src/renderer/components/sidebar/Sidebar.tsx`
**Commit**: `feat(remote): add Remote section to sidebar`

### Step 20: Terminal dual-source — local and remote PTY

**Complexity**: standard
**RED**: N/A (integration — verify manually that switching between local and remote sessions works)
**GREEN**: Modify `Terminal.tsx` and `use-terminal.ts` to support two PTY data sources. When a remote session is active, subscribe to `remote-pty-data` instead of `pty-data`. Input goes to `remote-pty-input` instead of `pty-input`. Resize sends to both local and remote as appropriate. Show "Disconnected" overlay when remote connection drops.
**REFACTOR**: Abstract the PTY source behind a simple interface so Terminal doesn't branch on local/remote everywhere.
**Files**: `src/renderer/components/terminal/Terminal.tsx`, `src/renderer/hooks/use-terminal.ts`, `src/preload/index.ts`
**Commit**: `feat(remote): support remote PTY streaming in terminal`

### Step 21: Ports panel UI

**Complexity**: standard
**RED**: N/A (UI component)
**GREEN**: Add `src/renderer/components/sidebar/PortsPanel.tsx`. Shows detected ports for the currently active remote session. Each port shows: port number, detection source, Forward/Stop button, local port override input. Forwarded ports show clickable `localhost:PORT` link. Panel appears in the sidebar or as a collapsible section when a remote session is active.
**REFACTOR**: None needed
**Files**: `src/renderer/components/sidebar/PortsPanel.tsx`, `src/renderer/components/sidebar/Sidebar.tsx`
**Commit**: `feat(remote): add Ports panel for port forwarding UI`

### Step 22: End-to-end integration and cleanup

**Complexity**: complex
**RED**: Write integration test that starts a server, connects a client, verifies state flow, sends a command, verifies PTY data round-trip (mocked tmux).
**GREEN**: Fix any integration issues discovered. Ensure graceful shutdown: server stop tears down cleanly, client disconnect tears down tunnels and PTY.
**REFACTOR**: Clean up any duplication between handlers.ts and command-dispatcher.ts. Ensure consistent error handling across all remote code paths.
**Files**: `src/main/remote/__tests__/integration.test.ts`, various
**Commit**: `feat(remote): add integration tests and cleanup`

## Complexity Classification

| Rating | Criteria | Review depth |
|--------|----------|--------------|
| `trivial` | Single-file rename, config change, typo fix, documentation-only | Skip inline review; covered by final `/code-review --changed` |
| `standard` | New function, test, module, or behavioral change within existing patterns | Spec-compliance + relevant quality agents |
| `complex` | Architectural change, security-sensitive, cross-cutting concern, new abstraction | Full agent suite including opus-tier agents |

## Pre-PR Quality Gate

- [ ] All tests pass (`vitest run`)
- [ ] Type check passes (`tsc --noEmit`)
- [ ] Build succeeds (`electron-vite build`)
- [ ] `/code-review --changed` passes
- [ ] Spec acceptance criteria all checked off

## Dependency Graph

```
Step 1 (protocol) ─────┬──► Step 3 (server adapter) ──► Step 9 (remote service) ──► Step 10 (server IPC) ──► Step 11 (server UI)
                        │        ▲                            ▲
Step 2 (crypto) ────────┤        │                            │
                        ├──► Step 4 (auth service) ───────────┤
                        │                                     │
                        ├──► Step 5 (command dispatcher) ─────┤
                        │                                     │
                        ├──► Step 6 (PTY manager) ────────────┤
                        │                                     │
                        ├──► Step 7 (port scanner) ───────────┤
                        │                                     │
                        └──► Step 8 (tunnel manager) ─────────┘

Step 12 (ws dep) ── before Step 3

Step 1 (protocol) ─────┬──► Step 13 (client adapter) ──► Step 15 (client service) ──► Step 16 (client IPC)
Step 2 (crypto) ────────┘        ▲                                                          │
                                 │                                                          ▼
                           Step 14 (client tunnel) ──► Step 15                    Step 17 (store)
                                                                                       │
                                                                          ┌────────────┼────────────┐
                                                                          ▼            ▼            ▼
                                                                    Step 18       Step 19      Step 20
                                                                    (dialog)      (sidebar)    (terminal)
                                                                                       │
                                                                                       ▼
                                                                                  Step 21 (ports)
                                                                                       │
                                                                                       ▼
                                                                                  Step 22 (integration)
```

## Risks & Open Questions

- **`ws` bundling**: Mark `ws` as external in `electron.vite.config.ts` so Vite doesn't try to inline it. Standard Electron pattern — low risk, just do it in Step 12.
- **Self-signed TLS cert rotation**: If the server regenerates its cert (e.g., reinstall), the client must re-pair. This is acceptable — the "Pair" flow handles it naturally.
- **Network**: Tailscale is the assumed network layer. Each machine gets a stable `100.x.y.z` IP on the free tier — no port forwarding, no NAT traversal needed. Server listens on its Tailscale IP + port 7777.
