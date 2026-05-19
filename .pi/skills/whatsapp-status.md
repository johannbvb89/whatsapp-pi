# WhatsApp-Pi Status & Connection Debugging

## Quick Reference

| Problem | Check | Fix |
|---------|-------|-----|
| WhatsApp not connecting | `isRegistered()` returns false? | Check `~/.pi/whatsapp-pi/auth/creds.json` exists |
| Status shows connected but no messages | `getEffectiveStatus()` matches socket? | Socket may be null — reconnect |
| Auto-connect not working | `--whatsapp-pi-online` flag set? | Restart Pi with flag |
| Status flickers | Config write race? | `saveConfig()` debounce needed |

## Architecture

```
whatsapp-pi.ts (entry point)
├── SessionManager (auth state, config, allow-lists)
│   └── ~/.pi/whatsapp-pi/config.json
│   └── ~/.pi/whatsapp-pi/auth/creds.json (Baileys)
├── WhatsAppService (socket lifecycle, reconnect, health check)
│   ├── socket (Baileys makeWASocket)
│   ├── handleConnectionUpdate() → open/close/QR
│   ├── scheduleReconnect() → exponential backoff (5s-120s)
│   └── startHealthCheck() → 30s interval, triggers reconnect
├── MenuHandler (TUI /whatsapp command)
├── RecentsService (message history)
├── IncomingMediaService (image/audio/document processing)
└── AudioService
```

## Connection Flow

### Auto-Connect (startup with --whatsapp-pi-online)
```
session_start
  → ensureInitialized() → loadConfig() → syncAuthStateFromDisk()
  → isRegistered() → checks hasAuthState
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

## Key Files

| File | Purpose |
|------|---------|
| `whatsapp-pi.ts` | Entry point, flag registration, session_start handler, tool/command registration |
| `src/services/session.manager.ts` | Auth state persistence, config, allow-lists |
| `src/services/whatsapp.service.ts` | Baileys socket, reconnect, health check |
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

## Known Bugs (as of v1.0.58)

### Bug: isRegistered() unreliable
- `ensureInitialized()` silent catch swallows errors
- `hasAuthState` may stay false even with valid `creds.json`
- **Fix pattern:** Directly check file existence in `isRegistered()`, add logging

### Bug: loadConfig() resets connected→disconnected
- Intentional (connection not inherited) but confusing
- `isTransientStatus` = [connected, connecting, reconnecting] → forced to 'disconnected'
- **OK as-is** — connection state should not persist across restarts

### Bug: saveConfig() write race
- `setConnectionState()` calls `void saveConfig()` - fire-and-forget
- Multiple rapid state changes can interleave writes
- **Fix pattern:** Add debounce or serial queue

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
pi --whatsapp-pi-online --verbose
```
