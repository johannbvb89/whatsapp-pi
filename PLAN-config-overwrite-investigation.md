# Plan: Config Overwrite Root Cause Investigation

**Date:** 2026-05-19  
**Symptom:** User sees `WhatsApp: Connected ✅` + `Readiness: Ready ✅` but `Allowed Contacts: 0`.  
**Suspicion:** config.json is being overwritten/lost somewhere, or the status display is misleading.

---

## OBSERVED STATE (from disk)

```json
// ~/.pi/whatsapp-pi/config.json
{
  "allowList": [],                              ← 0 contacts (INTENTIONAL?)
  "allowedGroups": [{                           ← 1 group (placeholder JID)
    "number": "120363012345@g.us"
  }],
  "status": "connected",
  "hasAuthState": true,
  "operatorJid": "",
  "connectedSince": 1779168867166
}
```

**Key fact:** The status report IS accurate — the config really has 0 contacts. The question is whether contacts were added and then lost, or never added at all.

---

## Investigation Points

### POINT 1: Was a contact ever added? Trace the session history

**What to check:**
- Search ALL Pi session JSONL files in `~/.pi/agent/sessions/--C--Users-johan-Pi_Code-PI_Project-whatsapp-pi-fix--/` for any `whatsapp-state` entry that contains a non-empty `allowList`.
- Search for any `/whatsapp` command execution that added a contact.

**Preliminary finding:** Only ONE `whatsapp-state` entry exists across all 4 session files, and it has `allowList: []`. No evidence of contacts ever being persisted through the Pi session state mechanism.

**Conclusion:** If contacts were added, they either (a) were never saved, or (b) were saved to config.json but later overwritten, or (c) were lost on Pi restart.

---

### POINT 2: Can `ensureInitialized()` be called twice and reset in-memory state?

**Code:**
```typescript
// session.manager.ts
public async ensureInitialized() {
    if (this._initPromise) {
        return this._initPromise;  // Guard: prevents concurrent init
    }
    this._initPromise = (async () => {
        await this.ensureStorageDirectories();
        await this.loadConfig();  // ← READS FROM DISK, overwrites this.allowList
        await this.syncAuthStateFromDisk();
    })();
    try {
        await this._initPromise;
    } finally {
        this._initPromise = null;  // ← Guard REMOVED after completion!
    }
}
```

**Race scenario:**
1. `ensureInitialized()` #1 loads config → `this.allowList = [{number: "123"}]`
2. User adds contact "456" → `this.allowList.push({number: "456"})` → `saveConfig()` starts 200ms timer
3. `ensureInitialized()` #2 (from another Pi session lifecycle event) → `_initPromise` is null → starts new load → `this.allowList = [{number: "123"}]` (RESET! Contact "456" lost from memory!)
4. 200ms timer fires → `flushConfig()` → writes `allowList: [{number: "123"}]` to disk
5. Contact "456" is GONE

**Verification:** 
- Check if Pi fires `session_start` more than once per process
- Check if `/whatsapp` command handler or any other path calls `ensureInitialized()`
- Add a counter/logger to detect duplicate `ensureInitialized()` calls

---

### POINT 3: Pi session state restoration — does it overwrite?

**Code in whatsapp-pi.ts:**
```typescript
const savedStateEntry = [...ctx.sessionManager.getEntries()]
    .reverse()
    .find(entry => entry.type === "custom" && entry.customType === "whatsapp-state");

if (savedStateEntry) {
    if (Array.isArray(data.allowList)) {
        for (const n of data.allowList) {
            await sessionManager.addNumber(num, name);
        }
    }
}
```

**This iterates `data.allowList` and ADDS (not replaces).** If `data.allowList` is empty, nothing happens. If it's missing (no `whatsapp-state` entry found), nothing happens. So this path alone does NOT overwrite.

**But:** `addNumber()` calls `saveConfig()` which is debounced. Each call starts a 200ms timer, subsequent calls return early. When the timer fires, `flushConfig()` writes the current state. Since `addNumber()` pushed to `this.allowList`, the final write should include all additions.

**Edge case:** What if between `ensureInitialized()` and session restore, a debounced `flushConfig()` fires and writes the empty state BEFORE the `addNumber()` loop runs?

1. `ensureInitialized()` → `loadConfig()` → `syncAuthStateFromDisk()` → calls `flushConfig()` directly (bypasses debounce) → writes `allowList: []` to disk
2. Session restore: `addNumber("123")` → `this.allowList = [{number:"123"}]` → `saveConfig()` starts 200ms timer
3. Timer fires → writes `allowList: [{number:"123"}]` to disk ✅

Seems OK in this scenario.

---

### POINT 4: Can `isRegistered()` → `hasCredentialsFile()` trigger a cascading load/save cycle?

**Code:**
```typescript
// session.manager.ts
public async isRegistered(): Promise<boolean> {
    const fileExists = await this.hasCredentialsFile();
    if (fileExists !== this.hasAuthState) {
        this.hasAuthState = fileExists;  // Mutates in-memory state
    }
    return fileExists;
}

// In whatsapp-pi.ts session_start:
const registered = await sessionManager.isRegistered();
```

`isRegistered()` mutates `this.hasAuthState` but does NOT call `saveConfig()`. So it doesn't trigger a write. No overwrite risk here.

---

### POINT 5: Multiple Pi instances sharing config.json

**Scenario:** If the user runs Pi in two terminals simultaneously, each creates its own `SessionManager` instance pointing to `~/.pi/whatsapp-pi/config.json`.

**T1:** `loadConfig()` reads `allowList: [{number: "123"}]`  
**T2:** `loadConfig()` reads `allowList: [{number: "123"}]`  

**T1:** User adds "456" → `flushConfig()` writes `allowList: [123, 456]`  
**T2:** User adds "789" → `flushConfig()` writes `allowList: [123, 789]` ← **"456" LOST!**

This is a **LAST-WRITE-WINS** race condition. The config.json has no locking mechanism.

**Verification:**
- Check `ps` or task manager for multiple Pi processes
- Check if Pi opens multiple windows/sessions for the same project

---

### POINT 6: The `saveConfig()` debounce — can rapid mutations lose data?

**Code:**
```typescript
public async saveConfig() {
    this._savePending = true;
    if (this._saveTimer) {
        return;  // Already scheduled — do nothing
    }
    this._saveTimer = setTimeout(() => {
        this._saveTimer = null;
        void this.flushConfig();
    }, 200);
}
```

**Scenario:** The debounce coalesces rapid saves, BUT the final `flushConfig()` writes the current state at flush time. Since mutations happen synchronously (e.g., `this.allowList.push(...)`), the final state should be correct.

**Edge case: Calling `flushConfig()` directly while a debounce is pending:**
```typescript
private async flushConfig() {
    this._savePending = false;
    if (this._saveTimer) {
        clearTimeout(this._saveTimer);  // Kills pending debounce
        this._saveTimer = null;
    }
    // ... writes current state
}
```

Since `flushConfig()` writes current state, the interrupted debounce is not a data loss issue — the direct flush writes the same state the debounce would have.

---

### POINT 7: `loadConfig()` "recovery" mode — can it corrupt data?

**Code:**
```typescript
if (recovered) {
    await this.flushConfig();  // Rewrites config to clean format
}
```

**Scenario:** If config.json has trailing garbage (e.g., from a crash during write), `parseConfig()` recovers by parsing only the first valid JSON object. Then `flushConfig()` rewrites cleanly. This could theoretically TRUNCATE new data that was in the garbage portion.

But the write pattern is `writeFile(tempPath) → rename(tempPath, configPath)`, so partial writes should NOT leave trailing data. The rename is atomic (or falls back to writeFile).

---

### POINT 8: The `loadConfig()` status reset — does it affect allowList?

**Code:**
```typescript
const isTransientStatus = loadedStatus === 'connected' || ...;
this.connectionState = {
    status: isTransientStatus ? 'disconnected' : loadedStatus,
    ...
};
```

This only resets `connectionState.status`, NOT `allowList` or `allowedGroups`. No data loss.

---

### POINT 9: `setConnectionState()` fire-and-forget

**Code:**
```typescript
async setConnectionState(partial: Partial<ConnectionState>) {
    this.connectionState = { ...this.connectionState, ...partial };
    void this.saveConfig();  // Fire and forget!
}
```

If `setConnectionState()` is called rapidly (e.g., during connection lifecycle), multiple `saveConfig()` calls are coalesced by the debounce. But `void` means errors are silently swallowed.

**Does NOT affect allowList** — `setConnectionState()` only updates `connectionState`, not contacts.

---

### POINT 10: Pi session state format mismatch

**The problem:** When the `/whatsapp` command handler saves state:
```typescript
pi.appendEntry("whatsapp-state", {
    status: sessionManager.getStatus(),
    allowList: sessionManager.getAllowList(),
    allowedGroups: sessionManager.getAllowedGroups()
});
```

This stores a REFERENCE to the in-memory arrays. If `pi.appendEntry()` serializes this immediately (JSON.stringify), it captures the snapshot. If it stores a reference, later mutations to `this.allowList` would be reflected in the stored entry.

**On restore:**
```typescript
const data = (savedStateEntry as { data?: any }).data;
if (Array.isArray(data.allowList)) {
    for (const n of data.allowList) {
        await sessionManager.addNumber(num, name);
    }
}
```

This reads `data.allowList` from the stored entry. If Pi serialized the entry at save time, this is a snapshot. If Pi stores a reference, this is the current (maybe mutated) array.

**Verification:** Check how Pi's `appendEntry()` works — does it JSON.parse/JSON.stringify the data, or store a reference?

---

## Root Cause Hypothesis (ordered by likelihood)

### H1 (MOST LIKELY): Contact was never persisted
The user added a contact, but the debounced `saveConfig()` hadn't fired before Pi shutdown. The `flushPendingSave()` in `session_shutdown` should prevent this, but if Pi crashes or the shutdown handler doesn't fire, data is lost.

### H2: Double `ensureInitialized()` resets in-memory state
Some Pi lifecycle event triggers `session_start` again, which calls `ensureInitialized()` (since `_initPromise` is null after first completion), which re-loads config from disk, overwriting in-memory changes made after the first load.

### H3: Multiple Pi instances (last-write-wins)
Two Pi processes write to the same config.json simultaneously. The one that writes last determines the final state.

### H4: Pi session state with empty allowList
A previous session's `whatsapp-state` entry with `allowList: []` gets restored, but since the array is empty, no contacts are removed. This would only matter if the restore code had a REPLACE instead of ADD semantic (it doesn't).

### H5: Atomic rename failure on Windows
The `rename(tempPath, configPath)` fails on Windows (EPERM), and the fallback `writeFile(configPath, serialized)` also fails silently. The original `tempPath` is then deleted. Net result: config.json is gone or corrupted.

---

## Action Plan (Do NOT execute without confirmation)

### Phase A: Instrumentation (add diagnostic logging)

1. **Add a write counter to `flushConfig()`:**
   - Log every write with: timestamp, PID, allowList.length, allowedGroups.length, status, call stack trace
   - Append to a separate audit log: `~/.pi/whatsapp-pi/config-audit.log`

2. **Add guard to prevent double `ensureInitialized()`:**
   - Track `_initialized` boolean, log warning if called again
   - Add call stack trace to identify who triggered the second call

3. **Add save/load instrumentation to whatsapp-pi.ts:**
   - Log the `savedStateEntry` data on every `session_start`
   - Log allowList before/after session state restoration

### Phase B: Reproduce the overwrite scenario

4. **Test H1 (lost on shutdown):**
   - Start Pi → Add contact → Kill Pi with `Ctrl+C` immediately (before 200ms)
   - Check config.json → contact should be missing
   - Start Pi → Add contact → Wait 1s → Kill Pi → Check config.json → contact should persist

5. **Test H2 (double init):**
   - Add logging → Start Pi → Add contact → Trigger some Pi lifecycle event
   - Check if `ensureInitialized()` is called again → check if contact is lost

6. **Test H3 (multiple instances):**
   - Start Pi in two terminals → add different contacts in each
   - Check which contacts survive

7. **Test H5 (Windows rename failure):**
   - Check the `.tmp` file: `~/.pi/whatsapp-pi/config.json.3468.1779163006848.tmp` exists but is 0 bytes!
   - This is evidence of a failed/partial write!

### Phase C: Fixes (only after confirming root cause)

8. **Fix debounce window:** Reduce from 200ms to 50ms or flush synchronously on critical mutations
9. **Fix double-init:** Add `_initialized` flag, never reset `_initPromise` to null
10. **Add file lock:** Use `flock` or a `.lock` file for multi-process safety
11. **Fix Windows rename:** Add retry logic or always use direct `writeFile` on Windows
12. **Fix shutdown race:** Call `await flushConfig()` in `session_shutdown`, not `flushPendingSave()`

---

## Immediate Discovery: Stale Temp File

```
~/.pi/whatsapp-pi/config.json.3468.1779163006848.tmp  ← 0 bytes!
```

This zero-byte temp file is evidence of a failed or interrupted write. It means `flushConfig()` wrote to the temp file (but it's 0 bytes?!), then either the rename or direct write failed, and the cleanup `rm(tempPath)` also failed, leaving this zero-byte artifact.

**This strongly suggests H5 (atomic rename failure on Windows) is a real problem.**

The config.json itself is 494 bytes and looks valid, so the latest write succeeded. But the presence of this zombie temp file means at least one write attempt failed.

---

## Priority Order

1. **🔴 Clean up the zombie temp file** and investigate why it's 0 bytes
2. **🔴 Add audit logging** to `flushConfig()` to trace every write
3. **🟡 Add double-init guard** to `ensureInitialized()`
4. **🟡 Reduce debounce window** and flush on `session_shutdown`
5. **🟢 Add file locking** for multi-process safety
6. **🟢 Consider replacing atomic rename with direct write** on Windows
