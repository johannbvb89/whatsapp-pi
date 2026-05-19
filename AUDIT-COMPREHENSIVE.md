# WhatsApp-Pi Comprehensive Audit & Fix Plan

**Date:** 2026-05-19  
**Branch:** whatsapp-pi-fix (local)  
**State:** All 138 tests pass, typecheck clean, but config overwrite issues exist at runtime.

---

## Audit Summary

| Area | Files | Issues Found |
|------|-------|--------------|
| Config Persistence | `session.manager.ts` | 🔴 4 critical overwrite paths |
| Status Display | `whatsapp.service.ts`, `whatsapp-pi.ts` | 🟡 2 misleading states |
| Session Lifecycle | `whatsapp-pi.ts` | 🟡 3 race conditions |
| i18n | `i18n.ts` | 🟡 Dead code (pi.events) |
| Test Coverage | `tests/unit/*` | 🟡 Tests mock too much, miss integration paths |
| Windows Support | `session.manager.ts` | 🟡 Atomic rename fails on Windows |

---

## 🔴 CATEGORY 1: Config Overwrite Paths (CRITICAL)

### Issue 1.1 — Double `ensureInitialized()` resets in-memory state

**File:** `src/services/session.manager.ts:60-76`

```typescript
public async ensureInitialized() {
    if (this._initPromise) {
        return this._initPromise;  // Guard active during first call
    }
    this._initPromise = (async () => {
        await this.ensureStorageDirectories();
        await this.loadConfig();      // ← READS FROM DISK, overwrites this.allowList
        await this.syncAuthStateFromDisk();
    })();
    try {
        await this._initPromise;
    } finally {
        this._initPromise = null;     // ← GUARD REMOVED after completion!
    }
}
```

**Race scenario:**
1. `ensureInitialized()` #1 loads config → `this.allowList = [{number: "+5511..."}]`
2. User adds contact "+5521..." → `this.allowList.push(...)` → `saveConfig()` starts 200ms timer
3. Some Pi lifecycle event calls `ensureInitialized()` #2 → `_initPromise` is null → starts new load → `this.allowList = [{number: "+5511..."}]` (CONTACT +5521 LOST from memory!)
4. 200ms timer fires → `flushConfig()` → writes `allowList: [{number: "+5511..."}]` to disk
5. Contact +5521 is permanently lost

**VERDICT:** Pi fires `session_start` once per session, so the current flow may not trigger this, but if Pi ever adds session replacement/resume hooks that re-trigger `session_start`, this is catastrophic.

**Fix:** Add `_initialized` boolean that is NEVER reset. Second call should be a no-op, not a reload.

### Issue 1.2 — `setConnectionState()` calls `void this.saveConfig()` which can race with debounce

**File:** `src/services/session.manager.ts:515-516`

```typescript
async setConnectionState(partial: Partial<ConnectionState>) {
    this.connectionState = { ...this.connectionState, ...partial };
    void this.saveConfig();  // FIRE AND FORGET — errors silenced, race with debounce
}
```

**Problem:** `void` swallows errors. If the write fails (disk full, permission error, file locked), the error is silently lost. The connection state says "connected" in memory but the config on disk shows "disconnected" on next load.

**Fix:** `await this.saveConfig()` or at minimum log the error.

### Issue 1.3 — `saveConfig()` debounce loses last write on shutdown

**File:** `src/services/session.manager.ts:191-199`

```typescript
public async saveConfig() {
    this._savePending = true;
    if (this._saveTimer) {
        return;  // Coalesces — subsequent calls dropped
    }
    this._saveTimer = setTimeout(() => {
        this._saveTimer = null;
        void this.flushConfig();
    }, 200);
}
```

**Scenario:**
1. User adds contact → `saveConfig()` starts 200ms timer (t=0)
2. User immediately presses Ctrl+C at t=50ms
3. `session_shutdown` calls `flushPendingSave()`:
   ```typescript
   async flushPendingSave(): Promise<void> {
       if (this._savePending) {
           await this.flushConfig();  // This flushes!
       }
   }
   ```
   
   WAIT — this works correctly! `flushPendingSave()` checks `_savePending` and flushes. The contact IS saved.

   **BUT:** If `flushPendingSave()` is called AFTER the timer already fired and set `_savePending = false`, AND the flush itself failed (e.g., Windows file lock), the final state is lost.

**Verdict:** The current implementation is actually correct for the happy path. The risk is in edge cases where `flushPendingSave()` is never called (crash, kill -9, process.exit).

### Issue 1.4 — Windows atomic rename failure (CONFIRMED)

**Evidence:** Zero-byte temp file at `~/.pi/whatsapp-pi/config.json.3468.1779163006848.tmp`

**Code path:**
```typescript
await writeFile(tempPath, serialized);
try {
    await rename(tempPath, this.configPath);  // ← FAILS on Windows
} catch {
    await writeFile(this.configPath, serialized);  // Fallback
    await rm(tempPath, { force: true }).catch(() => {});
}
```

**Problem:** The temp file is 0 bytes, meaning `writeFile(tempPath, serialized)` either wrote 0 bytes or the file was created but never written to. This could happen if:
- `JSON.stringify(config, null, 2)` threw an exception mid-write
- Node.js `writeFile` was interrupted
- The file was locked by another process

The cleanup `rm(tempPath)` also failed, leaving the zombie file.

**Fix:** Add retry logic, verify file size after write, use a `.lock` file for mutual exclusion.

### Issue 1.5 — Pi session state stores empty allowList, then restores it

**File:** `whatsapp-pi.ts` (session_start handler, ~line 130-160)

```typescript
// SAVE (in /whatsapp command handler):
pi.appendEntry("whatsapp-state", {
    status: sessionManager.getStatus(),
    allowList: sessionManager.getAllowList(),  // ← Reference to in-memory array
    allowedGroups: sessionManager.getAllowedGroups()
});

// RESTORE (in session_start):
const savedStateEntry = [...ctx.sessionManager.getEntries()]
    .reverse()
    .find(entry => entry.type === "custom" && entry.customType === "whatsapp-state");

if (Array.isArray(data.allowList)) {
    for (const n of data.allowList) {
        await sessionManager.addNumber(num, name);  // ADDS (doesn't replace)
    }
}
```

**OBSERVATION:** Only ONE `whatsapp-state` entry exists across all 4 session files, and it has `allowList: []`. This means the restore path adds nothing, which is correct — it doesn't overwrite.

**BUT:** If a contact was added in session A and `pi.appendEntry("whatsapp-state", ...)` stored it with `allowList: [{number: "+55..."}]`, and then session B starts, it would re-add that contact. This is additive, not destructive.

**Risk:** If `sessionManager.getAllowList()` returns a reference and Pi serializes it LATER (lazy serialization), the stored data could differ from what was intended at save time. Need to verify Pi's `appendEntry` behavior.

---

## 🟡 CATEGORY 2: Misleading Status Display (HIGH)

### Issue 2.1 — `Readiness: Ready ✅` shown when 0 contacts exist

**File:** `src/services/whatsapp.service.ts:155-170`

```typescript
public getReadinessStatus(): ReadinessStatus {
    const hasContacts = this.sessionManager.getAllowList().length > 0;
    const hasGroups = this.sessionManager.getAllowedGroups().length > 0;
    const hasBoundGroup = !!this.boundGroupJid;

    if (hasContacts || hasGroups || hasBoundGroup) {
        return 'ready';  // ← 1 group (even placeholder JID!) = "ready"
    }
    return 'no-contacts';
}
```

**Problem:** The config has `allowedGroups: [{number: "120363012345@g.us"}]` — this is the **placeholder JID from specs**, not a real group. But `getReadinessStatus()` returns `'ready'` because `hasGroups = true`.

**The user sees:**
- Footer: `WhatsApp: Connected ✅`
- Status report: `Readiness: Ready ✅`
- But: `Allowed Contacts: 0`

This is confusing: "Ready for what?" — No contacts, no real group, but status says "Ready".

**Fix:** The footer should show `Readiness: no-contacts` when `hasContacts = false` and the only group is the placeholder JID, or better yet, show readiness per-category.

### Issue 2.2 — Footer shows "Connected ✅" even with 0 contacts

**File:** `whatsapp-pi.ts:263-272` (in `handleConnectionOpen`)

```typescript
const readiness = this.getReadinessStatus();
if (readiness === 'ready') {
    this.onStatusUpdate?.(t('service.whatsapp.connected'));
} else if (readiness === 'no-contacts') {
    this.onStatusUpdate?.(t('service.whatsapp.connectedNoContacts'));
} else {
    this.onStatusUpdate?.(t('service.whatsapp.connected'));
}
```

If `readiness === 'ready'` (because of the placeholder group), the footer shows "Connected" instead of "Connected (no contacts)". This hides the fact that no contacts are authorized.

---

## 🟡 CATEGORY 3: Code Quality & Architecture (MEDIUM)

### Issue 3.1 — Verbose flag: README says `--verbose`, code uses `--whatsapp-verbose`

**README:**
```bash
pi -e whatsapp-pi.ts --verbose
```

**Code:** registers `whatsapp-verbose` and checks `pi.getFlag("whatsapp-verbose")`

**Impact:** Following the README, users would pass `--verbose` which is Pi's built-in verbose flag, NOT the WhatsApp-specific one. The WhatsApp-Pi extension would stay in silent mode.

### Issue 3.2 — `pi.events` dead code in i18n

**File:** `src/i18n.ts:294-323`

```typescript
pi.events?.emit?.("pi-core/i18n/registerBundle", { ... });
pi.events?.on?.("pi-core/i18n/localeChanged", (event) => { ... });
```

`@earendil-works/pi-coding-agent` v0.75.3 has **zero references to `events`**. These calls silently do nothing. The entire locale switching mechanism is dead code.

### Issue 3.3 — README documents `Reaction Mode` but code doesn't have it anymore

**README says:** "Choose reaction mode per group: **Active** or **Passive**"

**Code:** `src/ui/menu.handler.ts:manageAllowedGroup()` does NOT have a Reaction Mode option. The `reactionMode` field was removed in spec 033.

**The `loadConfig()` test still tests for it:** `tests/unit/session.manager.test.ts:150` tests "should ignore legacy passive reaction mode when loading groups" — confirms it was removed from the code but remains in README.

---

## 🟡 CATEGORY 4: Test Coverage Gaps (MEDIUM)

### Issue 4.1 — Tests mock EVERYTHING, never test the real SessionManager

`tests/unit/whatsapp-pi.extension.test.ts` uses `vi.mock()` for SessionManager, WhatsAppService, RecentsService, MenuHandler, IncomingMediaService, IncomingMessageResolver. The entire extension test is testing mocks against mocks.

**Missing tests:**
- ❌ `ensureInitialized()` called twice → second call should be no-op
- ❌ `saveConfig()` debounce → verify final state after rapid mutations
- ❌ `loadConfig()` then `setConnectionState()` then `loadConfig()` again → state preserved
- ❌ `flushConfig()` on Windows with locked file → fallback works
- ❌ `addNumber()` immediately followed by `Ctrl+C` → data persisted
- ❌ `addNumber()` then crash (no session_shutdown) → data persisted (debounce already fired)
- ❌ `setConnectionState()` error propagation → not silently swallowed
- ❌ `flushPendingSave()` drains the debounce buffer correctly

### Issue 4.2 — SessionManager tests are good but don't test edge cases

`tests/unit/session.manager.test.ts` has 12 tests covering:
- ✅ Initialization, status, auth state, config recovery, group management, aliases

But missing:
- ❌ Double initialization (reload race)
- ❌ Concurrent saveConfig + loadConfig
- ❌ Rapid addNumber + removeNumber + addNumber (debounce coalescing)
- ❌ saveConfig error handling (disk full, permission denied)
- ❌ Windows rename failure fallback

---

## 📋 COMPLETE FIX PLAN

### Phase A: Instrumentation (IMMEDIATE — no behavioral changes)

**Goal:** Add diagnostic logging to trace every config write, identify the exact overwrite source.

#### A1. Add audit log to `flushConfig()`

Add to `src/services/session.manager.ts`:

```typescript
private async flushConfig() {
    // ... existing code ...
    
    // AUDIT LOG (append-only, never cleared)
    const auditPath = join(this.baseDir, 'config-audit.log');
    const auditEntry = JSON.stringify({
        ts: new Date().toISOString(),
        pid: process.pid,
        allowListLen: this.allowList.length,
        allowedGroupsLen: this.allowedGroups.length,
        status: this.connectionState.status,
        stack: new Error().stack?.split('\n').slice(2, 6).join(' | ')
    });
    await appendFile(auditPath, auditEntry + '\n').catch(() => {});
}
```

#### A2. Add double-init guard to `ensureInitialized()`

```typescript
private _initialized = false;

public async ensureInitialized() {
    if (this._initialized) {
        console.warn('[SessionManager] ensureInitialized called AGAIN — skipping reload');
        return;
    }
    // ... existing guard logic ...
    this._initialized = true;  // Never reset
}
```

#### A3. Log session_start restore data

Add to `whatsapp-pi.ts` session_start handler:

```typescript
console.log(`[WhatsApp-Pi] Session state restore: ${savedStateEntry ? 
    `allowList=${data.allowList?.length || 0} groups=${data.allowedGroups?.length || 0}` : 
    'NO ENTRY FOUND'}`);
```

### Phase B: Config Persistence Fixes (HIGH PRIORITY)

#### B1. Fix `setConnectionState()` fire-and-forget
- Change `void this.saveConfig()` → `await this.saveConfig()`
- Add try/catch with error logging

#### B2. Make `flushConfig()` robust on Windows
- Add retry (3 attempts with 100ms backoff)
- Verify file size after write
- Use `fsync` if available
- Clean up temp files more aggressively

#### B3. Remove debounce for critical paths
- `addNumber()`, `removeNumber()`, `addAllowedGroup()`, `removeAllowedGroup()` should call `flushConfig()` directly (not debounced)
- Keep debounce only for `setConnectionState()` which changes frequently during connection lifecycle

#### B4. Add file locking for multi-process safety
- Use a `.lock` file with PID, check staleness

### Phase C: Status Display Fixes

#### C1. Fix `getReadinessStatus()` to require real contacts
- If `hasGroups` but the only group is the placeholder JID, return `'no-contacts'`
- OR: add a `hasRealContacts = hasContacts || (hasGroups && !isPlaceholderJid)` check

#### C2. Footer should show "Connected (no contacts)" when appropriate
- Already implemented via `t('service.whatsapp.connectedNoContacts')` — just need C1 to work

### Phase D: Documentation Fixes

#### D1. README: Fix `--verbose` → `--whatsapp-verbose`
#### D2. README: Remove "Reaction Mode" section (removed in spec 033)
#### D3. README: Clarify that auto-connect needs `--whatsapp-pi-online`

### Phase E: Test Rewrite (CRITICAL)

#### E1. Add SessionManager integration tests for config persistence:
```
□ ensureInitialized() called twice is a no-op (state preserved)
□ addNumber() → saveConfig() → loadConfig() → number preserved
□ addNumber() → removeNumber() → loadConfig() → number removed
□ addNumber() + crash (no flushPendingSave) → debounce may save it
□ addNumber() + immediate shutdown (flushPendingSave) → number preserved
□ Rapid addNumber() x3 → single flushConfig() → all 3 preserved
□ setConnectionState() error is logged, not swallowed
□ flushConfig() on locked file → retry succeeds
□ Double ensureInitialized() during active mutation → state NOT reset
```

#### E2. Add WhatsAppService integration tests for readiness:
```
□ getReadinessStatus() with 0 contacts + 0 groups → 'no-contacts'
□ getReadinessStatus() with 0 contacts + 1 placeholder group → 'no-contacts'
□ getReadinessStatus() with 1 contact + 0 groups → 'ready'
□ getReadinessStatus() with 0 contacts + 1 real group → 'ready'
□ getEffectiveStatus() when config=connected but socket=null → 'disconnected'
```

#### E3. Fix existing tests to use LESS mocking:
- `whatsapp-pi.extension.test.ts`: Instead of mocking SessionManager, create a real one with temp dir
- Test the full session_start → addNumber → appendEntry → session_start again → data restored cycle

---

## Priority Matrix

| # | What | Impact | Effort | Priority |
|---|------|--------|--------|----------|
| A1 | Audit logging | Diagnostic | 30min | 🔴 NOW |
| A2 | Double-init guard | Preventive | 15min | 🔴 NOW |
| B1 | Fix fire-and-forget | Data loss | 15min | 🔴 HIGH |
| B3 | Remove debounce for mutations | Data loss | 30min | 🔴 HIGH |
| C1 | Fix readiness check | UX | 15min | 🟡 MED |
| E1 | Add persistence tests | Quality | 2h | 🟡 MED |
| D1-3 | Fix README | Docs | 20min | 🟢 LOW |
| B4 | File locking | Edge case | 1h | 🟢 LOW |

---

## Files Affected

| File | Issues | Changes |
|------|--------|---------|
| `src/services/session.manager.ts` | 1.1, 1.2, 1.3, 1.4 | Add audit log, double-init guard, retry logic, flush on mutations |
| `src/services/whatsapp.service.ts` | 2.1 | Fix readiness check for placeholder groups |
| `whatsapp-pi.ts` | 1.5, 3.1, 3.2 | Add restore logging, fix verbose flag check |
| `README.md` | 3.1, 3.3 | Fix verbose flag, remove reaction mode |
| `tests/unit/session.manager.test.ts` | 4.1, 4.2 | Add persistence cycle tests |
| `tests/unit/whatsapp-pi.extension.test.ts` | 4.1 | Reduce mocking, add integration tests |
