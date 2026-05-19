# Plan: WhatsApp Connection Status Reliability Overhaul

## Found Bugs

### Bug #1: `isRegistered()` returns false despite valid credentials
**Root Cause:** `ensureInitialized()` wraps `loadConfig()` + `syncAuthStateFromDisk()` in a silent empty `catch {}`. If either throws (file lock, corrupt JSON, I/O error), `hasAuthState` stays at initial default `false`. No error is logged.

Additionally, `isRegistered()` indirectly depends on `hasAuthState` being pre-loaded from `config.json`, not directly on `creds.json` existence. If `ensureInitialized()` is never called (race condition, error), `isRegistered()` will always return `false`.

**Fix:** 
- `isRegistered()` must directly check `creds.json` existence, independent of config loading
- Log errors in `ensureInitialized()` catch block
- Add `ensureInitialized()` concurrency guard (prevent double-init)

### Bug #2: `loadConfig()` forces transient statuses to 'disconnected'
**Root Cause:** `loadConfig()` has this logic:
```typescript
const isTransientStatus = loadedStatus === 'connected' || loadedStatus === 'connecting' || loadedStatus === 'reconnecting';
this.connectionState.status = isTransientStatus ? 'disconnected' : loadedStatus;
```
On every restart, `'connected'` from config is replaced with `'disconnected'`. This means:
- On restart, the status always shows 'disconnected' even if auth exists
- The auto-connect decision (`isWhatsappPiOn && registered`) sees 'disconnected' which is correct for NOT being connected, but `isRegistered()` might be wrong due to Bug #1

**Fix:**
- Keep the transient reset (it's intentional - connection is NOT inherited)
- BUT ensure `isRegistered()` is reliable (Fix Bug #1)
- AND ensure the status callback updates the TUI in real-time

### Bug #3: `saveConfig()` called fire-and-forget can race
**Root Cause:** `setConnectionState()` calls `void this.saveConfig()` - fire and forget. Multiple rapid state changes can cause write races.

**Fix:** Use a serial write queue or debounce.

### Bug #4: Missing real-time status update on multi-connection
**Root Cause:** The `onStatusUpdate` callback updates `ctx.ui.setStatus('whatsapp', status)` but this is only called from `WhatsAppService` connection events. If `getEffectiveStatus()` shows a discrepancy (config says connected but socket is null), this isn't pushed to the UI.

**Fix:** `getEffectiveStatus()` should trigger a status callback when it detects a discrepancy, or the status display should use `getEffectiveStatus()` as its source.

## Implementation Plan

### Phase 1: Fix `isRegistered()` (Critical)
1. Make `isRegistered()` directly check `creds.json` existence
2. Add concurrency guard to `ensureInitialized()`
3. Log all errors in `ensureInitialized()` catch block

### Phase 2: Fix Status Reliability
1. `getEffectiveStatus()` is already correct (checks socket + config status)
2. Add health-check-triggered status updates
3. Ensure TUI status always reflects `getEffectiveStatus()` 

### Phase 3: Fix Write Races
1. Add serial write queue to `saveConfig()`
2. Debounce rapid config saves

### Phase 4: Add `--whatsapp-pi-online` to Pi startup
1. The user must start Pi with `--whatsapp-pi-online` for auto-connect
2. Document this clearly

## Files to Modify
- `src/services/session.manager.ts` — Bug #1, #3
- `whatsapp-pi.ts` — Bug #4 (status callback robustness)
