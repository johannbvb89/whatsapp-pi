# WhatsApp-Pi Status & Connection Debugging

## Quick Reference

| Problem | Check | Fix |
|---------|-------|-----|
| WhatsApp not connecting | `isRegistered()` returns false? | Check `~/.pi/whatsapp-pi/auth/creds.json` exists |
| Status shows connected but no messages | `getEffectiveStatus()` matches socket? | Socket may be null — effective status returns `disconnected` |
| Auto-connect not working | `--whatsapp-pi-online` flag set? | Restart Pi with flag |
| Status flickers | Config write race? | Debounce already applied (200ms) — check for external config writers |
| isRegistered() unreliable | Fixed in a8c3153 | Now checks `creds.json` directly — no config load race |

## Architecture

```
whatsapp-pi.ts (entry point)
├── SessionManager (auth state, config, allow-lists)
│   ├── ~/.pi/whatsapp-pi/config.json        (persistent config)
│   ├── ~/.pi/whatsapp-pi/auth/creds.json    (Baileys credentials)
│   ├── isRegistered()                       → direct file check (NOT config-based)
│   ├── saveConfig()                         → debounced (200ms)
│   ├── flushConfig()                        → immediate write for critical paths
│   ├── flushPendingSave()                   → drain buffer on shutdown
│   └── _initPromise                         → concurrency guard (prevents double-init)
├── WhatsAppService (socket lifecycle, reconnect, health check)
│   ├── socket (Baileys makeWASocket)
│   ├── handleConnectionUpdate()             → open/close/QR
│   ├── scheduleReconnect()                  → exponential backoff (5s-120s)
│   ├── startHealthCheck()                   → 30s interval, triggers reconnect
│   ├── getEffectiveStatus()                 → DUAL-SOURCE: config status ∩ socket nullity
│   └── setStatusCallback()                  → pushes status labels to TUI
├── MenuHandler (TUI /whatsapp command)
├── RecentsService (message history)
├── IncomingMediaService (image/audio/document processing)
└── AudioService
```

## Diagnostic Architecture (Post a8c3153)

### Dual-Source Status: `getEffectiveStatus()`

The extension uses **two sources of truth** for connection status:

| Source | Method | What it checks |
|--------|--------|----------------|
| Config state | `sessionManager.getStatus()` | `connectionState.status` in `config.json` |
| Socket reality | `this.socket` reference | Actual Baileys socket object (null → not connected) |

`WhatsAppService.getEffectiveStatus()` cross-checks:
```typescript
if (status === 'connected' && !this.socket) {
    return 'disconnected'; // Config says connected but socket is gone
}
```

This prevents the TUI from showing "Connected" when the socket has been garbage-collected or never created. The TUI status callback pushes the **effective** status via `whatsappService.getEffectiveStatus()`.

### `setConnectionState()` vs deprecated `setStatus()`

| Method | Status | Persistence | Usage |
|--------|--------|-------------|-------|
| `setConnectionState(partial)` | ✅ Current | Debounced (200ms) | `whatsapp-pi.ts` entry point |
| `setStatus(status)` | ⚠️ Deprecated | Immediate (`flushConfig`) | Legacy fallback only |

`ConnectionState` includes diagnostics beyond status: `lastError`, `lastErrorTime`, `connectedSince`, `lastMessageReceived`, `reconnectAttempts`, `uptimeMs`.

### Debounced Config Writes

- `saveConfig()` — coalesces writes within 200ms. Callers that don't need immediate persistence use this.
- `flushConfig()` — immediate atomic write (tempfile + rename). Used by `syncAuthStateFromDisk()` and critical paths.
- `flushPendingSave()` — called on `session_shutdown` to drain any pending debounced write.

### Concurrency Guard: `ensureInitialized()`

First call starts async init; concurrent calls await the same `_initPromise`. Errors are logged (not swallowed). Prevents:
- Parallel `loadConfig()` races
- Config state corruption from double-initialization

## Connection Flow

### Auto-Connect (startup with --whatsapp-pi-online)
```
session_start
  → ensureInitialized() → loadConfig() → syncAuthStateFromDisk()
  → isRegistered() → hasCredentialsFile() checks creds.json directly
  → if (isWhatsappPiOn && registered) → auto-connect with 4 retries
  → else → notify user to connect manually
```

### Manual Connect (TUI /whatsapp → "Connect WhatsApp")
```
MenuHandler.handleCommand()
  → whatsappService.start()
    → createSocket() → getAuthState() → makeWASocket()
    → registerSocketListeners()
      → connection.update
        → qr → handlePairingQr() → show QR
        → open → handleConnectionOpen() → set status=connected
        → close → handleConnectionClosed() → reconnect or logout
```

### Shutdown Flow
```
Pi emits "session_shutdown"
  → whatsappService.stop()
  → sessionManager.flushPendingSave() // drain debounce buffer
```

## Key Files

| File | Purpose |
|------|---------|
| `whatsapp-pi.ts` | Entry point, flag registration, session_start handler, tool/command registration |
| `src/services/session.manager.ts` | Auth state persistence, config, allow-lists |
| `src/services/whatsapp.service.ts` | Baileys socket, reconnect, health check, effective status |
| `src/ui/menu.handler.ts` | /whatsapp TUI menu |
| `src/models/whatsapp.types.ts` | SessionStatus, ConnectionState types |
| `~/.pi/whatsapp-pi/config.json` | Persistent config |
| `~/.pi/whatsapp-pi/auth/creds.json` | Baileys credentials |
| `~/.pi/whatsapp-pi/whatsapp-pi.log` | File-based log |

## SessionStatus States
```
logged-out    → No credentials at all
disconnected  → Credentials exist but not connected
connecting    → Connection attempt in progress
connected     → Socket open, messages flowing
reconnecting  → Connection lost, reconnect scheduled
pairing       → QR code displayed for pairing
error         → Connection error (check lastError)
```

## Resolved Bugs (post a8c3153)

### ✅ `isRegistered()` now checks creds.json directly
- **Before:** Depended on `hasAuthState` being pre-loaded from config — config load race could leave it `false`
- **After:** `hasCredentialsFile()` reads `creds.json` from disk — independent of config loading
- `ensureInitialized()` has concurrency guard + error logging (no more silent catch)

### ✅ `saveConfig()` debounced at 200ms
- **Before:** Every state change fired a config write — rapid changes interleaved
- **After:** `saveConfig()` debounces, `flushConfig()` for critical paths, `flushPendingSave()` on shutdown

### ⚠️ `loadConfig()` resets connected→disconnected (expected behavior)
- Intentional — connection is not inherited across restarts
- `isTransientStatus` = [connected, connecting, reconnecting] → forced to 'disconnected'
- The effective status check (`getEffectiveStatus()`) provides the real socket state

## Testing Connection
```bash
# Check if creds exist
ls -la ~/.pi/whatsapp-pi/auth/creds.json

# Check config state
cat ~/.pi/whatsapp-pi/config.json | grep -E 'status|hasAuthState'

# View recent logs
tail -50 ~/.pi/whatsapp-pi/whatsapp-pi.log

# In Pi TUI: /whatsapp-status
```

## Running with Auto-Connect
```bash
pi --whatsapp-pi-online
# Verbose mode for debugging:
pi --whatsapp-pi-online --whatsapp-verbose
```
