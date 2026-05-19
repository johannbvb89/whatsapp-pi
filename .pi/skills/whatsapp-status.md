# WhatsApp-Pi Status & Connection Debugging

## Quick Reference

| Problem | Check | Fix |
|---------|-------|-----|
| WhatsApp not connecting | `isRegistered()` returns false? | Check `~/.pi/whatsapp-pi/auth/creds.json` exists |
| Status shows connected but no messages | `getEffectiveStatus()` matches socket? | Socket may be null — effective status returns `disconnected` |
| Auto-connect not working | `--whatsapp-pi-online` flag set? | Restart Pi with flag |
| Status flickers | Config write race? | Check `config-audit.log` for write conflicts |
| Contacts disappear on restart | Double init or debounce race? | Check `config-audit.log`, verify `_initialized` guard |
| Footer shows "Connected" but no contacts | Placeholder group in allowed groups? | Check `getReadinessStatus()` — 'ready' with fake group |

## Known Bugs (2026-05-19 Audit — ACTIVE)

These bugs have 0 test coverage and are confirmed real:

| Bug | Location | Symptom |
|-----|----------|---------|
| Double `ensureInitialized()` resets state | `session.manager.ts:60-76` | Contacts added then lost on lifecycle event |
| `setConnectionState()` fire-and-forget | `session.manager.ts:516` | Status writes fail silently |
| Debounce loses writes on crash | `session.manager.ts:191-199` | Contact lost if Pi killed <200ms after add |
| Windows rename leaves zombie .tmp | `session.manager.ts:232-239` | Zero-byte .tmp file in config dir |
| Placeholder group counts as "Ready" | `whatsapp.service.ts:155-170` | Footer says Connected ✅ with 0 contacts |
| i18n `pi.events` dead code | `i18n.ts:294-323` | Locale switching never works |

See `AUDIT-COMPREHENSIVE.md` for full details. See `.pi/skills/whatsapp-pi-guard.md` for the guard skill.

## Architecture

```
whatsapp-pi.ts (entry point)
├── SessionManager (auth state, config, allow-lists)
│   ├── ~/.pi/whatsapp-pi/config.json        (persistent config)
│   ├── ~/.pi/whatsapp-pi/config-audit.log   (write trace log)
│   ├── ~/.pi/whatsapp-pi/auth/creds.json    (Baileys credentials)
│   ├── isRegistered()                       → direct file check (NOT config-based)
│   ├── saveConfig()                         → debounced (200ms) — only for non-critical
│   ├── flushConfig()                        → immediate write for critical paths
│   ├── flushPendingSave()                   → drain buffer on shutdown
│   └── _initPromise + _initialized          → concurrency guard (prevents double-init)
├── WhatsAppService (socket lifecycle, reconnect, health check)
│   ├── socket (Baileys makeWASocket)
│   ├── handleConnectionUpdate()             → open/close/QR
│   ├── scheduleReconnect()                  → exponential backoff (5s-120s)
│   ├── startHealthCheck()                   → 30s interval, triggers reconnect
│   ├── getEffectiveStatus()                 → DUAL-SOURCE: config status ∩ socket nullity
│   ├── getReadinessStatus()                 → ready/no-contacts/not-connected/no-credentials
│   └── setStatusCallback()                  → pushes status labels to TUI
├── MenuHandler (TUI /whatsapp command)
├── RecentsService (message history)
├── IncomingMediaService (image/audio/document processing)
└── AudioService
```

## Key Files

| File | Purpose |
|------|---------|
| `whatsapp-pi.ts` | Entry point, flags, tools, commands, lifecycle |
| `src/services/session.manager.ts` | 🔴 Config persistence, auth state, allow-lists |
| `src/services/whatsapp.service.ts` | 🔴 Socket lifecycle, reconnect, readiness |
| `src/ui/menu.handler.ts` | /whatsapp TUI menu |
| `src/models/whatsapp.types.ts` | SessionStatus, ConnectionState, ReadinessStatus |
| `~/.pi/whatsapp-pi/config.json` | Persistent config |
| `~/.pi/whatsapp-pi/config-audit.log` | Write trace log |
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

## ReadinessStatus States
```
ready          → Socket open + at least one contact/group authorized
no-contacts    → Socket open but allowList empty and no bound group
not-connected  → Socket not open
no-credentials → No WhatsApp auth stored
```

## Testing Connection
```bash
# Check if creds exist
ls -la ~/.pi/whatsapp-pi/auth/creds.json

# Check config state
cat ~/.pi/whatsapp-pi/config.json | grep -E 'status|hasAuthState|allowList|allowedGroups'

# Check write audit trail
tail -20 ~/.pi/whatsapp-pi/config-audit.log

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

## Related Documents
- `AGENTS.md` — Project guidelines and guard references
- `REVIEW-CHECKLIST.md` — Pre-review verification checklist
- `AUDIT-COMPREHENSIVE.md` — Full 2026-05-19 audit
- `TEST-GAP-ANALYSIS.md` — Test coverage gaps
- `STRATEGY-v2-rebase.md` — SDK rebase plan
- `.pi/skills/whatsapp-pi-guard.md` — Auto-loaded guard skill
