# Research: Auto-Reconnect on Unexpected Disconnect

## 1) Distinguishing intentional stops from unexpected disconnects

- **Decision**: Introduce an `intentionalStop` boolean flag on `WhatsAppService`. Set it to `true` in `stop()` and `logout()`; clear it to `false` at the start of any user-initiated `start()` call.
- **Rationale**: The existing `handleConnectionClosed` logic already decodes the Baileys status code to detect server-side auth rejections (401, bad session, bad MAC). The only missing piece is signalling when the user itself triggered the disconnect via the menu. A flag on the service is the minimal, in-process solution — no persistence needed since the spec explicitly states this state does not survive restarts.
- **Alternatives considered**: Deriving intent from `SessionStatus` (unreliable — status can be 'disconnected' for multiple reasons); persisting the flag to disk (overkill — on restart, `--whatsapp-pi-online` controls startup behaviour).

## 2) What happens when `start()` throws during an auto-reconnect attempt

- **Decision**: Extract reconnect scheduling into a private `scheduleReconnect(options)` method. The timer callback inside `scheduleReconnect` wraps `start()` in a try/catch; on failure it calls `scheduleReconnect` again (if `intentionalStop` is still false), continuing exponential backoff.
- **Rationale**: The existing timer callback uses `void this.start(options)`, silently swallowing errors. When `fetchLatestBaileysVersion()` or socket creation fails (e.g. network is down), no new attempt is scheduled and the service silently stops retrying. Extracting the scheduling logic into a reusable method avoids duplication and makes the retry-on-failure path explicit.
- **Alternatives considered**: Catching errors directly inside `handleConnectionClosed` (harder to reason about with nested async); letting the caller retry (would require changing the `start()` public contract).

## 3) Where `intentionalStop` lives

- **Decision**: Field on `WhatsAppService` only, not on `SessionManager`.
- **Rationale**: This is ephemeral runtime state — it resets every time `start()` is called. `SessionManager` owns persistent state (auth, config, status). Mixing ephemeral flags there violates separation of concerns.
- **Alternatives considered**: Adding a `SessionStatus` variant like `'intentionally-stopped'` (would affect every status consumer in the codebase and persist across restarts undesirably).

## 4) Interaction with existing `isReconnecting` flag

- **Decision**: `intentionalStop` is checked early in `handleConnectionClosed` (before any `shouldReconnect` logic) and again inside the reconnect timer callback, without changing the existing `isReconnecting` guard.
- **Rationale**: `isReconnecting` prevents duplicate reconnect loops; `intentionalStop` prevents reconnect from starting at all. They serve distinct purposes and should remain separate.
- **Alternatives considered**: Combining them into a single state enum (would complicate the existing backoff logic).

## 5) Auth-rejection disconnect (server-side logout)

- **Decision**: No change required. The existing `isAuthRejected` / `isBadMacError` paths already suppress reconnect for server-side session invalidations.
- **Rationale**: Confirmed by code inspection: `shouldTreatAsLoggedOut = true` → `cleanupSocket()` → no reconnect timer. These cases are already handled correctly without the new flag.
