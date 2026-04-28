# Headless Deployment — Phase 4 Brainstorm

> Status: **Brainstorm (2026-04-28).** Recommendations capture the simplest viable path; the headless build target itself ships in this phase, but the operational decisions below land incrementally as need warrants.
>
> Scope: this doc answers the open Phase 4 questions from `architecture-evolution.md`. It does not replace the design doc; it specifies the surface that needs to exist around `bootHeadless()` for a real VPS deployment to make sense.

## Problem Statement

Phase 4 unblocks the "Gustav as a daemon on a VPS" use case: a single user wants their Gustav reachable from their laptop and phone, without running Electron there and without depending on whatever machine they happen to be holding. Phase 3's supervisor already runs Electron-free; what remains is the boot path, the deployment shape, and the operations envelope around it.

We pick concrete defaults for an initial deployment and document the alternatives so we know what we're trading away. **No alternative below has been benchmarked against Gustav's real workload — the analysis is structural, not empirical.**

## Headless flag (resolved in this phase)

`GUSTAV_HEADLESS=1` (env var) or `--headless` (argv) puts main into the headless boot path. Env var is the recommended deployment surface: it matches `Environment=` in systemd units and survives `Restart=`. The argv flag is a developer convenience.

Implementation: `src/main/headless.ts` exports `isHeadless({ env, argv })` and `bootHeadless(deps)`. `index.ts` branches inside `app.on('ready')`: if headless, never construct a `BrowserWindow`, never call `startPty`, register IPC handlers with a no-op renderer broadcaster, start `RemoteService` automatically, start state polling, print pairing code + cert fingerprint to stdout. SIGTERM/SIGINT trigger graceful shutdown.

The remote port is `GUSTAV_REMOTE_PORT` (env) with default `7777`.

## Open questions

### 1. Bootstrap method

| Option | Pros | Cons |
|---|---|---|
| **A. SSH + one-line installer** (`curl ... \| bash`). | Cheapest first-run. Works the same on any distro. Easy to update. | Pulls a script from the internet — supply-chain surface. Hard to audit on each install. |
| **B. Manual `git clone + npm ci + npm run build`** (recommended). | Auditable. No new tooling. Reuses the build pipeline already in CI. The user already operates this way locally. | Higher friction for non-technical users. |
| **C. Self-installed systemd unit** (a script that drops the unit file). | Same as B for the build, plus declarative process supervision in one shot. | Conflates "install Gustav" with "run Gustav as a service" — couples the two decisions. |
| **D. npm package `@gustav/headless`.** | Discoverable, versioned. | We don't publish to npm today; doing so for one user is overhead for nobody's benefit. Rules out non-Node users (none today). |

**Recommendation: B.** The user is the only operator. `git clone && npm ci && npm run build && npm run start:headless` is three commands. We document this. If we later have more users, A becomes worth automating; for now the audit cost is paid by reading the code, which is the user's job anyway.

### 2. Process supervision

| Option | Pros | Cons |
|---|---|---|
| **A. systemd user-service** (`~/.config/systemd/user/gustav.service` + `loginctl enable-linger`). | No root. Works on any modern Linux VPS. Standard `journalctl --user -u gustav` for logs. | Requires `linger` enabled or the unit dies on logout. One-time setup. |
| **B. systemd system-service** with a dedicated `gustav` user (recommended). | Survives reboots cleanly. No linger gymnastics. Standard ops. The dedicated user contains blast radius. | Requires root once at setup. The `gustav` user needs a home dir with the cloned repo. |
| **C. pm2.** | Friendly UX; built-in log rotation. | Adds a Node-only supervisor on top of systemd, which is already present. Two layers of restart logic to debug. |
| **D. nohup + tmux/screen.** | Zero infra. | No restart on crash. No structured ops. Anti-pattern for a long-lived service. |

**Recommendation: B.** systemd system-service with a dedicated `gustav` user. This is the boring correct answer for a single-tenant VPS daemon. We don't ship the unit file in this phase — it's documented for follow-up.

### 3. Network model

| Option | Pros | Cons |
|---|---|---|
| **A. Tailscale-only** (recommended). The Gustav VPS joins the user's tailnet; only tailnet IPs reach `:7777`. | Authenticated at the network layer. Survives CGNAT (mobile carriers). Works on phones via the Tailscale app. No public exposure of the pairing flow. Mesh-routed; no port forwarding. | Tailscale dependency. Outage-coupling to Tailscale's coordination service (rare but real). |
| **B. Direct internet exposure with Let's Encrypt.** | Pure-internet, no VPN. | Pairing code becomes the only auth on a public surface — small attack window per code, but it's there. Cert renewal requires HTTP-01 (port 80) or DNS-01 (DNS API). The current self-signed cert flow doesn't fit. CGNAT environments need NAT traversal. |
| **C. SSH tunnel.** Laptop SSHs in and forwards a local port. | Strongest isolation; no service publicly reachable. | Phone access is awful (SSH tunnels on iOS/Android are painful). Requires a live SSH session — not a daemon model. |

**Recommendation: A (Tailscale-only).** The existing self-signed cert + pinned fingerprint flow is already correct under this assumption: Tailscale authenticates the device at the network layer, the TLS cert protects the wire, the fingerprint pin survives across reconnects. CGNAT and mobile both work for free. This is the path the existing `RemoteService` was built for; we're aligning deployment with design.

Trade-off: a Tailscale outage means the Gustav VPS is unreachable. Acceptable because the VPS itself is also a single point of failure.

### 4. TLS cert lifecycle

The current `RemoteService.loadOrGenerateCert` writes a self-signed cert to `<dataDir>/remote/server.cert` on first start and reuses it forever. Clients pin the SHA-256 fingerprint on first pair (`remote-client.adapter.ts`).

For VPS deployment under recommendation 3A, this holds up: Tailscale already authenticates the device, and the pinned fingerprint catches any cert swap (TOFU works because the network layer is already trusted). Concerns:

- **Rotation**: cert never rotates today. A 365-day cert (the current openssl invocation's `-days 365`) eventually expires — a stale cert may fail TLS handshake on some clients. Recommendation: extend to `-days 3650` for headless deployments and document a manual rotation procedure (delete `server.cert` + `server.key`, restart, re-pair).
- **Mid-deployment cert change**: any clients with a pinned fingerprint refuse the new cert. They need to re-pair. There is currently no graceful "rotate" handshake. **Open follow-up:** add a server-signed rotation message that lets a previously-paired client accept a new fingerprint without going through pairing again. Out of scope for this phase.
- **Public-CA path (option 3B)**: would require ACME integration. Not building it.

### 5. Auth model

Current pairing flow:
- 6-character alphanumeric code (`PAIRING_CODE_LENGTH = 6`).
- 5-minute TTL (`PAIRING_CODE_TTL_MS = 5 * 60_000`) — note: the architecture-evolution doc says "24h"; the code says 5 minutes. The code is the source of truth.
- Code is randomly generated, only valid for one pair, then invalidated.
- After pairing, ed25519 challenge-response. No further interactive code entry.

For Tailscale-only deployment (3A), this is adequate: pairing happens over an already-authenticated tunnel. The 5-minute TTL is short enough that brute force is implausible (36^6 = ~2.2B at 1Hz over the auth rate-limit).

| Concern | Recommendation |
|---|---|
| **IP allowlist.** | Skip in Phase 4. Tailscale ACLs already gate IPs at the network layer; doubling up adds operational complexity. |
| **Multi-client (laptop + phone).** | Already supported: `AuthService.knownClients` is a map, not a single key. Each device pairs independently and stores its own key. The 1-renderer-at-a-time gate in `RemoteService` is at the **active session** layer, not the **trust** layer; it's safe to pair both. See Q9 for the concurrency caveat. |
| **Pairing TTL.** | Consider extending to 1 hour for headless (operator generates code, then has time to ssh-in, copy it, and pair from another device). Configurable via prefs. |
| **Pairing code source.** | Stays the same: server generates, operator reads from `journalctl`. |

### 6. State directory

Today: `~/.local/share/gustav/` (joined from `homedir()`). Contents: `preferences.json`, `repo-configs/`, `remote/` (cert, keys, known_hosts), workspace registry.

On a VPS with recommendation 2B (dedicated `gustav` user): `/var/lib/gustav/` is the FHS-correct path; `~gustav/.local/share/gustav/` works equally well and matches local-dev. Pick whichever makes the systemd unit simpler.

| What changes | Recommendation |
|---|---|
| **Should `--data-dir` be a flag?** | Yes, eventually. Today the path is hard-coded in `index.ts` as `path.join(homedir(), '.local', 'share', 'gustav')`. A `GUSTAV_DATA_DIR` env var (lowest friction, matches systemd patterns) would let us override without arg parsing. **Not implemented in this phase.** |
| **Backup set.** | `remote/server.key` (cert can be regenerated; key cannot without re-pairing every device). `preferences.json`. `workspaces.json`. Anything in workspace dirs is your usual git workflow. Recommend a simple `tar` of `<dataDir>` minus `remote/server.cert` (regenerable). |
| **Migration.** | If `--data-dir` ships later, existing local installs default to the same path; only headless is affected. |

### 7. Logging & ops

Today: `console.log`/`console.error` to stdout/stderr. Headless inherits this; systemd captures to journal. Adequate for a single-user deployment.

| Concern | Recommendation |
|---|---|
| **Structured logs.** | Skip in Phase 4. Plain text is grep-able and human-readable. Revisit if we ever want centralized log aggregation. |
| **Log rotation.** | systemd journal handles this for `journalctl`. If we ever output to a file, use `logrotate` — not application-level rotation. |
| **Health endpoint.** | The remote server's port already serves a TLS handshake. A liveness probe can `openssl s_client -connect ... < /dev/null` and check exit code. Skip a dedicated `/health` route in this phase. |
| **Banner format.** | Already done: `[gustav-headless] Listening on :7777 / Pairing code: ABCDEF (expires in 4m) / Server cert fingerprint: ...`. Stable prefix `[gustav-headless]` for `journalctl --grep`. |

### 8. Update flow

| Option | Pros | Cons |
|---|---|---|
| **A. SSH + `git pull && npm ci && npm run build && systemctl restart gustav`** (recommended). | Boring, auditable. The user is technical. | Manual. |
| **B. Self-update.** Gustav fetches releases and restarts itself. | Hands-off. | Secure self-update on a single-user system is more code than it's worth; adds an update channel surface and signing infra we don't have. |
| **C. Auto-restart on file change.** systemd `PathChanged=` on the build dir. | Hands-off after `git pull`. | One more moving part. Minor win over A. |

**Recommendation: A.** Self-update is overkill for one operator. We can revisit if Gustav grows users.

### 9. Single-user assumption

Today: `RemoteService` tracks one `clientAddress` and one `authenticated` flag at a time. The `RemoteServerAdapter` accepts one client; `disconnectClient()` boots whatever is connected. **PTY channels are multi-attach** (`PtyManager` keeps a `Map<channelId, ...>`), but only one renderer (one control connection) is active at a time.

For Phase 4 headless: keep this assumption.

| Scenario | Behavior today | Recommendation |
|---|---|---|
| Laptop attached, phone tries to attach. | Phone's connection wins, laptop is kicked. | Ship as-is. The user is on one device at a time anyway. |
| Laptop attached, both want to be attached concurrently. | Not supported. | **Out of scope for Phase 4.** Realistically, this would require a multi-renderer model in `RemoteService` that tracks state subscriptions per client. Defer until there's a real ergonomic need. |

The `PtyManager` already supports multiple PTY channels; the constraint is at the control plane (state subscriptions, command-result routing), not the data plane. Future work, not this phase's.

### 10. Failure modes

| Failure | Today | Recommendation |
|---|---|---|
| **Gustav main crashes mid-session.** | All PTYs die with the process (node-pty children are tied to the parent). | Phase 3 supervisor inherits this. PTY-survival across restart would require the supervisor to spawn detached and reattach on boot — a significant change. **Defer:** systemd's `Restart=on-failure` gets you a fast restart; Claude resume IDs are persisted, so the conversation continues even though the PTY died. Sleep-while-busy = kill is already policy (Decision 5); a crash is a forced version of the same. |
| **Renderer-less Gustav crashes between attaches.** | Same as above; nothing to lose at the moment of crash because no client is attached. | systemd restart. No special handling needed. |
| **Remote port already in use.** | Today `RemoteService.start` rejects. | Already handled in `bootHeadless`: error is logged, process stays alive so the operator can read the error in `journalctl` and the supervisor can trigger a restart loop with backoff. |
| **TLS cert expired.** | Handshake fails; clients can't reach. | Out of scope; mitigation in Q4. |
| **Tailscale offline.** | VPS unreachable. | Operator's problem, not Gustav's. |

## Recommended initial deployment

Put together, the simplest viable path:

1. **VPS** of any flavor (cheap one, 1 GB RAM is plenty).
2. **Tailscale** installed and joined to the user's tailnet. Block 7777 on any non-tailnet interface (`ufw deny 7777` then `ufw allow in on tailscale0 to any port 7777`).
3. **Dedicated user** `gustav`, `git clone` Gustav into `~gustav/gustav`, `npm ci && npm run build`.
4. **systemd system-service** at `/etc/systemd/system/gustav.service`, `Environment=GUSTAV_HEADLESS=1`, `Environment=GUSTAV_REMOTE_PORT=7777`, `User=gustav`, `Restart=on-failure`, `ExecStart=/usr/bin/node /home/gustav/gustav/build/main/index.js` — with the caveat that `node-pty` needs Electron's runtime on first build; the entry point may need to be `electron` until `node-pty` runs in pure node. To verify on first deploy.
5. **First-pair**: `journalctl -u gustav -f`, copy the pairing code, paste it from the laptop's Gustav (Connect to remote → host = `gustav-vps.tail-XXXX.ts.net`, port = 7777, code).
6. **Updates**: `ssh gustav-vps`, `cd gustav && git pull && npm ci && npm run build`, `sudo systemctl restart gustav`.

## Follow-up roadmap

- **`GUSTAV_DATA_DIR` env override** — small, unblocks `/var/lib/gustav` deployments cleanly.
- **systemd unit file in-tree** at `packaging/systemd/gustav.service`. Document `loginctl enable-linger` for the user-service variant.
- **Cert rotation handshake** — server-signed message that lets a paired client accept a new fingerprint. Avoids forced re-pair on cert renewal.
- **`/health` endpoint** if we ever want non-TLS-handshake liveness probes.
- **Multi-client concurrent attach** (laptop + phone simultaneously). Real engineering; only worth it once the use case is concrete.
- **Pairing TTL preference** — let the operator set the TTL; default stays 5 min for local, longer for headless.
- **Detached PTYs that survive restart** — large change in the supervisor; only worth it if mid-task crash recovery becomes a real pain.

The point of the recommended path is to ship a useful deployment with the smallest surface area we can defend. Everything above moves only when a specific operational pain points at it.
