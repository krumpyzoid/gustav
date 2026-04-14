# Gustav Remote Control — Specification

## 1. Intent

### Vision
Allow a macOS Gustav instance ("client") to connect to a remote Linux Gustav instance ("server") over the internet and operate it as if it were local — browsing workspaces, controlling sessions, typing into terminals, and forwarding development server ports back to the client machine.

### Goals
1. **Seamless remote experience** — Remote workspaces and sessions appear in the sidebar alongside local ones. Switching to a remote session attaches the terminal. It should feel like "my own Gustav, but it's happening on the remote."
2. **Secure by default** — All traffic encrypted. Initial pairing is easy (enter host + code), ongoing auth is key-based with no repeated secrets.
3. **Port forwarding on demand** — When a dev server starts in a remote tmux pane, the user sees the detected port and can forward it with one click, making `localhost:3000` on the remote accessible as `localhost:3000` locally.
4. **Zero external dependencies** — No SSH, no third-party relay, no cloud service. Gustav handles connectivity, encryption, and authentication end-to-end.
5. **Directional, single-client** — One client connects to one server at a time. The server accepts at most one active client connection.

### Non-Goals (out of scope for v1)
- Multi-client simultaneous access
- Peer-to-peer / bidirectional control
- NAT traversal / hole punching (user must ensure the server port is reachable)
- File transfer between machines
- Shared clipboard sync
- Auto-discovery (mDNS/Bonjour)

### Constraints
- Server: Linux (headless or GUI — Gustav main process must run)
- Client: macOS (standard Gustav desktop app)
- Network: Tailscale (free tier) provides stable `100.x.y.z` IPs between machines — no port forwarding or NAT traversal needed
- Single WebSocket connection carries all traffic (control, PTY streams, port tunnels)
- **Shared access** — The server remains fully usable locally while serving a remote client. Both the local user and the remote client can interact with the same tmux sessions simultaneously (tmux natively supports multi-client attachment). No locking or exclusive access.

---

## 2. BDD Scenarios

### Feature: Server Host Info

```gherkin
Scenario: Server displays connection info
  Given Gustav is running on a Linux machine with remote access enabled
  When the user opens the "Remote Host" panel in settings
  Then they see the machine's public-facing IP or hostname
  And they see the listening port (default 7777)
  And they see a 6-character alphanumeric pairing code
  And the pairing code has a visible expiry countdown (5 minutes)

Scenario: Server regenerates pairing code
  Given the server is showing a pairing code
  When the user clicks "Regenerate Code"
  Then a new 6-character code is generated
  And the previous code is immediately invalidated
  And the expiry countdown resets to 5 minutes

Scenario: Server shows no code when already paired
  Given a client has successfully paired with this server
  When the user opens the "Remote Host" panel
  Then the panel shows "Connected: <client name/IP>" instead of a pairing code
  And a "Disconnect" button is available
```

### Feature: Client Connection

```gherkin
Scenario: Client pairs with a remote server
  Given Gustav is running on a macOS machine
  When the user opens "Connect to Remote" and enters host, port, and pairing code
  And clicks "Connect"
  Then the client establishes a TLS-encrypted WebSocket connection
  And sends the pairing code for verification
  And on success, both sides exchange and persist Ed25519 public keys
  And the sidebar shows a "Remote" section with the server's workspaces

Scenario: Client reconnects with saved keys
  Given the client has previously paired with a server
  When the user selects the saved server and clicks "Connect"
  Then the client connects using mutual key authentication (no code needed)
  And the "Remote" section reappears in the sidebar

Scenario: Client enters wrong pairing code
  Given the server has an active pairing code "ABC123"
  When the client connects with code "XYZ999"
  Then the server rejects the connection
  And the client shows "Invalid pairing code" error
  And the server's pairing code remains valid for other attempts

Scenario: Pairing code expires
  Given the server generated a pairing code 5 minutes ago
  When a client attempts to use that code
  Then the server rejects with "Pairing code expired"
  And the server auto-generates a new code

Scenario: Second client rejected while one is connected
  Given a client is already connected to the server
  When another client attempts to connect
  Then the server rejects with "Another client is already connected"
```

### Feature: Remote Workspace & Session Browsing

```gherkin
Scenario: Client sees remote workspaces
  Given the client is connected to a remote server
  Then the sidebar shows a "Remote" section below local workspaces
  And the remote section lists all of the server's workspaces
  And each workspace shows its sessions with status indicators (busy/action/done/none)

Scenario: Remote state updates in real time
  Given the client is viewing remote workspaces
  When a session's Claude status changes on the server (e.g., busy → done)
  Then the client's sidebar reflects the change within 2 seconds
```

### Feature: Remote Session Control

```gherkin
Scenario: Client switches to a remote session
  Given the client sees remote sessions in the sidebar
  When the user clicks a remote session tab
  Then the terminal area attaches to that remote session's PTY stream
  And keystrokes in the terminal are sent to the remote tmux session
  And the terminal displays the remote session's output in real time

Scenario: Client creates a new remote session
  Given the client is viewing a remote workspace
  When the user triggers "New Session" on a remote workspace
  Then the session creation dialog shows the remote's repos and branches
  And on confirm, the session is created on the remote server
  And it appears in the remote sidebar section

Scenario: Client sleeps a remote session
  Given the client is viewing a remote session
  When the user clicks "Sleep" on the session
  Then the remote tmux session is killed and its state persisted on the server
  And the session appears as sleeping in the client's sidebar

Scenario: Client wakes a remote session
  Given a remote session is sleeping
  When the user clicks "Wake"
  Then the remote server restores the tmux session
  And the client can attach to the now-live PTY stream

Scenario: Client destroys a remote session
  Given the client is viewing a remote session
  When the user clicks "Destroy" and confirms
  Then the session is permanently removed on the server
  And it disappears from the client's sidebar
```

### Feature: Remote Terminal Interaction

```gherkin
Scenario: Typing flows to remote terminal
  Given the client is attached to a remote session
  When the user types "ls -la" and presses Enter
  Then the keystrokes are sent to the remote PTY
  And the command output appears in the local terminal within reasonable latency

Scenario: Terminal resize propagates
  Given the client is attached to a remote session
  When the client window is resized
  Then a resize event is sent to the remote PTY
  And the remote tmux pane adjusts its dimensions

Scenario: Client detaches cleanly on disconnect
  Given the client is attached to a remote session
  When the connection drops or the user disconnects
  Then the local terminal shows a "Disconnected" overlay
  And the remote tmux session continues running unaffected
```

### Feature: Port Forwarding

```gherkin
Scenario: Port detected from tmux pane output
  Given the client is attached to a remote session
  And a command like "pnpm run dev" outputs "Local: http://localhost:5173"
  Then a port indicator appears in the session tab or a "Ports" panel
  And it shows "5173 — detected from pane output"

Scenario: User forwards a detected port
  Given port 5173 is detected on the remote
  When the user clicks "Forward" on port 5173
  Then a local TCP listener starts on localhost:5173
  And traffic is tunneled through the WebSocket to the remote's localhost:5173
  And the UI shows "5173 → localhost:5173 (active)"
  And the user can click to open http://localhost:5173 in their browser

Scenario: User forwards to a different local port
  Given port 3000 is detected on the remote
  And local port 3000 is already in use
  When the user clicks "Forward" and changes local port to 3001
  Then the tunnel maps local 3001 → remote 3000
  And the UI reflects "3000 → localhost:3001 (active)"

Scenario: User stops a port forward
  Given port 5173 is actively forwarded
  When the user clicks "Stop" on the forwarded port
  Then the local TCP listener is closed
  And the tunnel is torn down
  And the port returns to "detected, not forwarded" state

Scenario: Port detection via process scanning
  Given the remote server has a process listening on port 8080
  When the server's port scanner detects it (via ss/lsof)
  Then port 8080 appears in the ports panel even if no output matched
```

### Feature: Connection Lifecycle

```gherkin
Scenario: Graceful disconnect
  Given the client is connected to the remote
  When the user clicks "Disconnect"
  Then all port forwards are torn down
  And the terminal detaches from the remote session
  And the "Remote" section disappears from the sidebar
  And the remote server returns to "awaiting connection" state

Scenario: Network interruption with auto-reconnect
  Given the client is connected
  When the network drops temporarily
  Then the client shows "Reconnecting..." in the remote section
  And retries connection with exponential backoff (1s, 2s, 4s, ... max 30s)
  And on reconnect, re-attaches to the previously active session
  And restores active port forwards

Scenario: Server shuts down while client connected
  Given the client is connected
  When the remote Gustav process exits
  Then the client detects the closed WebSocket
  And shows "Remote server disconnected"
  And the remote section becomes grayed out with a "Reconnect" button
```

---

## 3. Architecture Notes

### 3.1 Protocol: WebSocket + TLS

Single WSS (WebSocket Secure) connection carries everything:

```
┌──────────────┐         WSS (port 7777)         ┌──────────────┐
│  Client       │◄──────────────────────────────►│  Server       │
│  (macOS)      │                                 │  (Linux)      │
│               │  Control messages (JSON)        │               │
│  Renderer ◄──►│  PTY data (binary frames)      │◄──► tmux      │
│  Sidebar      │  Port tunnel data (binary)     │◄──► services  │
│  Terminal     │                                 │◄──► ports     │
└──────────────┘                                 └──────────────┘
```

#### Message framing

All messages over WebSocket use a simple envelope:

**Control messages** (text frames):
```json
{
  "type": "state-update" | "session-command" | "port-event" | "auth" | "error",
  "id": "uuid",
  "payload": { ... }
}
```

**Binary frames** (for PTY and port tunnel data):
```
[1 byte: channel type] [4 bytes: channel ID] [N bytes: payload]

Channel types:
  0x01 = PTY data (server → client)
  0x02 = PTY input (client → server)
  0x03 = Port tunnel data (bidirectional)
```

This multiplexes multiple PTY streams and port tunnels over one connection.

### 3.2 Authentication & Encryption

#### Phase 1: TLS
- Server generates a self-signed TLS certificate + Ed25519 keypair on first enable
- Stored in `~/.local/share/gustav/remote/server.key`, `server.cert`, `identity.ed25519`
- Client accepts self-signed cert during pairing, pins the fingerprint for future connections

#### Phase 2: Pairing (first connection)
```
1. Server generates 6-char alphanumeric code, valid 5 min
2. Server displays: hostname:port + code in UI
3. Client connects via WSS, sends: { type: "auth", payload: { method: "pair", code: "ABC123" } }
4. Server verifies code, responds with its Ed25519 public key
5. Client sends its Ed25519 public key
6. Both persist the other's key in ~/.local/share/gustav/remote/known_hosts.json
7. Code is invalidated
```

#### Phase 3: Reconnection (subsequent connections)
```
1. Client connects via WSS (pinned TLS cert)
2. Server sends a random challenge nonce
3. Client signs nonce with its Ed25519 private key, sends signature + its public key
4. Server verifies signature against stored client key
5. Server signs the same nonce, sends back
6. Client verifies server signature
7. Authenticated — session begins
```

### 3.3 Integration with Existing Architecture

Gustav's hexagonal architecture maps cleanly to this feature:

#### Server-side additions

| Layer | New Component | Purpose |
|-------|--------------|---------|
| **Adapter** | `remote-server.adapter.ts` | WSS server, TLS, connection lifecycle |
| **Port** | `remote-server.port.ts` | Interface for remote server operations |
| **Service** | `remote.service.ts` | Auth logic, pairing code management, client session |
| **Service** | `port-scanner.service.ts` | Detect listening ports via `ss -tlnp` + pane output parsing |
| **IPC handler** | Extensions to `handlers.ts` | New channels: `enable-remote`, `get-host-info`, `disconnect-client` |

The server reuses existing services — `StateService`, `SessionService`, `WorkspaceService` — by exposing them over WebSocket instead of IPC. The `remote.service.ts` acts as a bridge: it receives commands from the WebSocket, calls the same service methods the IPC handlers call, and sends results back.

#### Client-side additions

| Layer | New Component | Purpose |
|-------|--------------|---------|
| **Adapter** | `remote-client.adapter.ts` | WSS client, reconnection, auth handshake |
| **Port** | `remote-client.port.ts` | Interface for remote client operations |
| **Service** | `remote-client.service.ts` | Manage connection, proxy commands, tunnel ports |
| **IPC handler** | Extensions to `handlers.ts` | New channels: `connect-remote`, `disconnect-remote`, `forward-port`, `stop-forward` |
| **Renderer** | `RemoteSection` component | Sidebar section for remote workspaces |
| **Renderer** | `PortsPanel` component | Port detection and forwarding UI |
| **Renderer** | `ConnectDialog` component | Host/port/code entry for pairing |
| **Store** | Extensions to Zustand store | `remoteState: WorkspaceAppState | null`, `forwardedPorts: ForwardedPort[]` |

#### PTY streaming

When the client attaches to a remote session:
1. Client sends `{ type: "session-command", payload: { action: "attach-pty", tmuxSession: "..." } }`
2. Server spawns `tmux attach -t <session>` via node-pty (or reuses existing)
3. Server streams PTY output as binary frames (channel type 0x01)
4. Client feeds binary data into xterm.js (same as local PTY, different source)
5. Client sends keystrokes as binary frames (channel type 0x02)
6. Server writes to PTY stdin

The renderer's `Terminal.tsx` doesn't need to know if the PTY source is local or remote — the data path is abstracted behind the preload API.

#### Port forwarding implementation

```
Client                          Server
  │                                │
  │ ── forward-port(5173) ──────► │
  │                                │ Opens TCP connection to localhost:5173
  │ ◄── port-forward-ready ────── │ Assigns tunnel ID
  │                                │
  │ Starts local TCP listener     │
  │ on localhost:5173              │
  │                                │
  │ Browser connects to :5173     │
  │ ── tunnel data (0x03) ──────► │ ── proxies to localhost:5173
  │ ◄── tunnel data (0x03) ────── │ ◄── response from dev server
  │                                │
```

Each forwarded port gets a unique 4-byte channel ID in the binary frame header, allowing multiple simultaneous tunnels.

#### Port detection

Two complementary strategies on the server:

1. **Output parsing** — Extend `StateService`'s pane content polling to regex-match port patterns:
   - `localhost:(\d+)`, `127.0.0.1:(\d+)`, `0.0.0.0:(\d+)`
   - `port (\d+)`, `listening on (\d+)`
   - Common framework outputs: "ready on", "Local:", "Network:", "started server on"

2. **Process scanning** — Periodic `ss -tlnp` on the server to find listening ports owned by processes within tmux sessions. Cross-reference PID with tmux pane PIDs to associate ports with sessions.

Detected ports are included in the state update broadcast, so the client sees them automatically.

### 3.4 Security Considerations

- **TLS everywhere** — Even local-network traffic is encrypted. Self-signed certs are pinned, not blindly trusted.
- **Pairing code is one-time** — Invalidated after use or expiry. Not replayable.
- **Mutual authentication** — Both sides prove identity with Ed25519 signatures. Prevents MITM on reconnect.
- **Single-client lock** — Server rejects additional connections while one is active. No session hijacking.
- **No shell access beyond tmux** — The server only exposes its existing Gustav service API. No arbitrary command execution beyond what tmux sessions already provide.
- **Port tunnels are explicit** — Tunnels only created on user action. No automatic exposure.
- **Rate limiting** — Failed auth attempts rate-limited (max 5 per minute) to prevent brute-force on pairing codes.

### 3.5 Data Flow Summary

```
┌─ Client Gustav (macOS) ─────────────────────────────────┐
│                                                          │
│  Renderer                                                │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐              │
│  │Sidebar  │  │Terminal  │  │PortsPanel │              │
│  │(remote  │  │(xterm.js)│  │           │              │
│  │ section)│  │          │  │           │              │
│  └────┬────┘  └────┬─────┘  └─────┬─────┘              │
│       │            │              │                      │
│  ─────┼────────────┼──────────────┼───── preload API ── │
│       │            │              │                      │
│  Main Process                                            │
│  ┌────────────────────────────────────────┐              │
│  │ remote-client.service.ts               │              │
│  │  • WebSocket client                    │              │
│  │  • Auth handshake                      │              │
│  │  • State subscription                  │              │
│  │  • PTY relay (binary ↔ xterm)         │              │
│  │  • TCP tunnel manager                  │              │
│  └────────────────┬───────────────────────┘              │
│                   │ WSS                                   │
└───────────────────┼──────────────────────────────────────┘
                    │
              ══════╧══════ internet ══════╤══════
                                           │
┌─ Server Gustav (Linux) ─────────────────────────────────┐
│                   │ WSS                                   │
│  Main Process     │                                      │
│  ┌────────────────┴───────────────────────┐              │
│  │ remote.service.ts                      │              │
│  │  • WebSocket server (TLS)              │              │
│  │  • Auth + pairing                      │              │
│  │  • Command dispatcher                  │              │
│  │  • PTY manager (per-session attach)    │              │
│  │  • Port scanner                        │              │
│  │  • TCP tunnel endpoints                │              │
│  └──┬──────────┬──────────┬──────────┬────┘              │
│     │          │          │          │                    │
│  StateService  SessionSvc WorkspaceSvc  node-pty(tmux)   │
│  (existing)    (existing)  (existing)    (new per-client)│
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## 4. Acceptance Criteria

### Connection & Auth
- [ ] Server Gustav has a "Remote Host" settings panel showing IP, port, and pairing code
- [ ] Pairing code is 6 alphanumeric characters, expires after 5 minutes, auto-regenerates
- [ ] Client Gustav has a "Connect to Remote" dialog accepting host, port, and pairing code
- [ ] Initial pairing exchanges Ed25519 keys and persists them for future connections
- [ ] Subsequent connections use mutual key authentication (no code required)
- [ ] All traffic is TLS-encrypted (self-signed cert, pinned on first pairing)
- [ ] Server rejects a second client while one is connected
- [ ] Failed auth attempts are rate-limited (max 5/min)

### Remote Workspace & Session Browsing
- [ ] Connected client shows a "Remote" section in the sidebar
- [ ] Remote workspaces and their sessions are listed with correct status indicators
- [ ] State updates from the server appear on the client within 2 seconds
- [ ] Remote sessions show the same metadata as local (repo name, branch, Claude status)

### Remote Session Control
- [ ] Client can create sessions on the remote (workspace, directory, worktree, standalone)
- [ ] Client can switch between remote sessions (terminal attaches to selected session)
- [ ] Client can sleep, wake, and destroy remote sessions
- [ ] Session creation uses the remote's repos and branches (not local)

### Remote Terminal
- [ ] Attaching to a remote session streams PTY output to the local xterm.js terminal
- [ ] Keystrokes are relayed to the remote PTY with acceptable latency (<100ms on good connection)
- [ ] Terminal resize events propagate to the remote tmux pane
- [ ] Disconnection leaves the remote tmux session running and shows an overlay locally

### Port Forwarding
- [ ] Ports detected from tmux pane output appear in a "Ports" panel per session
- [ ] Ports detected from `ss -tlnp` scanning also appear, associated with the correct session
- [ ] User can forward a detected port with one click, opening a local TCP listener
- [ ] User can choose an alternate local port if the default is occupied
- [ ] Forwarded traffic tunnels through the WebSocket connection
- [ ] User can stop a forward, closing the local listener and tearing down the tunnel
- [ ] Multiple ports can be forwarded simultaneously

### Connection Lifecycle
- [ ] User can gracefully disconnect, tearing down all tunnels and detaching the terminal
- [ ] Client auto-reconnects on network interruption with exponential backoff (max 30s)
- [ ] On reconnect, active session and port forwards are restored
- [ ] If the server shuts down, client shows a clear "disconnected" state with a reconnect option

### Cross-Platform
- [ ] Server runs on Linux (tested on Ubuntu 22.04+)
- [ ] Client runs on macOS (tested on macOS 13+)
- [ ] Both use the same codebase with platform-conditional code paths where needed
