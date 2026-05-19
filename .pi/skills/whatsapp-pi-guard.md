# WhatsApp-Pi Guard Skill — Current State

## Status: ALL CRITICAL BUGS RESOLVED ✅

**Date:** 2026-05-19 | **Tests:** 155 passing | **SDK:** `@earendil-works/pi-coding-agent@0.75.3`

---

## Resolved Bug Landscape (2026-05-19 Audit)

| # | Bug | Status | Fix |
|---|-----|--------|-----|
| P0.1 | Double `ensureInitialized()` resets state | ✅ FIXED | `_initialized` flag — second call is skipped |
| P0.2 | `setConnectionState()` fire-and-forget | ✅ FIXED | `await` with try/catch error logging |
| P0.3 | Debounce loses writes on crash | ✅ FIXED | `addNumber`/`removeNumber`/`addAllowedGroup`/`removeAllowedGroup` use `flushConfig()` directly |
| P0.4 | Windows rename leaves zombie .tmp | ✅ FIXED | 3 retries + zero-byte detection + audit logging |
| P0.5 | Contacts not persisted across restart | ✅ FIXED | Persistence cycle test added + immediate flush |
| P1.1 | `getReadinessStatus()` returns 'ready' with placeholder group | ✅ FIXED | New `groups-only` state — groups alone without contacts is NOT 'ready' |
| P1.2 | Footer shows "Connected" with 0 contacts | ✅ FIXED | Shows `Connected ⚠️ Groups only — 0 contacts` when groups-only |
| P2.1 | i18n `pi.events` dead code | ✅ ALREADY FIXED | Removed in baseline |
| P2.2 | `sendUserMessage` image format | ✅ CORRECT | `{ type: "image", data: base64, mimeType }` matches SDK |
| P2.3 | `session_before_switch` not handled | ✅ FIXED | Flushes `flushPendingSave()` on session switch |
| P3.1 | README says `--verbose`, code uses `--whatsapp-verbose` | ⚠️ TODO | Docs phase |
| P3.2 | README documents removed "Reaction Mode" | ⚠️ TODO | Docs phase |

---

## Guard Rules (Enforced by Tests)

### Double-Init Protection
```typescript
// session.manager.ts — ensureInitialized()
if (this._initialized) {
    console.warn(`[SessionManager] ensureInitialized called AGAIN — skipping reload`);
    return;
}
// Test: "should not lose contacts when ensureInitialized() is called twice" ✅
```

### Immediate Flush for Contact Mutations
```typescript
// addNumber, removeNumber, addAllowedGroup, removeAllowedGroup use flushConfig()
await this.flushConfig();  // NOT saveConfig()
// Test: "should persist contacts across save → reload cycle" ✅
```

### No Fire-and-Forget
```typescript
// setConnectionState()
try {
    await this.saveConfig();  // NOT void
} catch (error) {
    console.error(`setConnectionState save failed: ...`);
}
// Test: "should persist connection state across set → reload cycle" ✅
```

### Windows Retry
```typescript
// flushConfig() — 3 retries with 100ms backoff + zero-byte check
for (let attempt = 0; attempt < 3 && !written; attempt++) {
    await writeFile(tempPath, serialized);
    const stat = await readFile(tempPath);
    if (stat.length === 0) throw new Error('zero-byte file');
    written = true;
}
```

### Readiness Accuracy
```typescript
// getReadinessStatus()
if (hasContacts || hasBoundGroup) return 'ready';
if (hasGroups) return 'groups-only';  // ← NEW state
return 'no-contacts';
// Test: "should return groups-only when connected with groups but no contacts" ✅
```

### Session Lifecycle
```typescript
// session_before_switch — flush config before Pi changes sessions
pi.on("session_before_switch", async () => {
    await sessionManager.flushPendingSave();
});
```

---

## Audit Log

Every `flushConfig()` writes to `~/.pi/whatsapp-pi/config-audit.log`:
```json
{"ts":"2026-05-19T...","pid":12345,"allowListLen":2,"allowedGroupsLen":1,"status":"connected",
 "stack":"at SessionManager.flushConfig ← at addNumber ← ..."}
```

---

## Mandatory Verification

Before ANY code change in this project:

```bash
npm test              # 155 tests must pass
npx tsc --noEmit      # zero type errors
npx eslint whatsapp-pi.ts "src/**/*.ts"  # zero lint errors
```

## Related Documents
- `REVIEW-CHECKLIST.md` — 7-gate pre-review checklist
- `AUDIT-COMPREHENSIVE.md` — Full audit report
- `TEST-GAP-ANALYSIS.md` — Original test gaps (all resolved)
- `STRATEGY-v2-rebase.md` — SDK rebase strategy
- `AGENTS.md` — Project guidelines