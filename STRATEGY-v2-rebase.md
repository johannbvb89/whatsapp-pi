# WhatsApp-Pi v2.0 Strategy: Rebase on Latest Pi SDK

**Date:** 2026-05-19  
**Baseline:** Pi SDK `@earendil-works/pi-coding-agent@0.75.3`  
**Current WhatsApp-Pi:** v1.0.59, partially aligned with legacy `@mariozechner@0.73.1`

---

## 1. SDK Baseline: What Changed (0.73.1 → 0.75.3)

### 1.1 Package Name Migration (DONE ✅ in some files, PARTIAL)

| File | Current Import | Target |
|------|---------------|--------|
| `whatsapp-pi.ts:1` | `@earendil-works/pi-coding-agent` ✅ | No change |
| `src/i18n.ts:1` | `@earendil-works/pi-coding-agent` ✅ | No change |
| `src/ui/menu.handler.ts:7` | `@earendil-works/pi-coding-agent` ✅ | No change |
| **ALL source files use the correct package already** ✅ | | |

### 1.2 `pi.events` — EXISTS in v0.75.3 but with DIFFERENT API

**WRONG (current i18n.ts):**
```typescript
pi.events?.emit?.("pi-core/i18n/registerBundle", { ... });
pi.events?.on?.("pi-core/i18n/localeChanged", (event) => { ... });
```

**CORRECT (v0.75.3):**
```typescript
// ExtensionAPI.events is an EventBus with:
//   emit(event: string, data?: any): void
//   on(event: string, handler: (data: any) => void): () => void
//   off(event: string, handler: (data: any) => void): void

// The i18n event names "pi-core/i18n/..." are NOT part of the EventBus API.
// These are from a custom pub/sub pattern that doesn't exist.
```

**VERDICT:** The i18n.ts `pi.events` code is DEAD CODE. The `?.` optional chaining means it silently does nothing at runtime. The `pi.events` EventBus exists BUT the event names and pattern used in i18n.ts are not part of that API. **This is not an EventBus API change — it's a completely made-up API that was never supported.**

**Fix:** Either:
- (A) Use `pi.registerFlag("whatsapp-pi-locale", ...)` for locale setting — already partially done via env var
- (B) Use the real `pi.events` EventBus to emit custom events for inter-extension communication
- (C) Remove the dead code entirely since locale switching via Pi's UI doesn't apply to WhatsApp-Pi

### 1.3 `sendUserMessage` — CORRECT ✅

**Current code:**
```typescript
pi.sendUserMessage(content, { deliverAs: "followUp" });
```

**SDK signature:**
```typescript
sendUserMessage(content: string | (TextContent | ImageContent)[], options?: {
    deliverAs?: "steer" | "followUp";
}): void;
```

**VERDICT:** Already aligned with v0.75.3. No change needed.

### 1.4 Image format — NEEDS VERIFICATION

**Current code:**
```typescript
{ type: "image", data: imageBuffer.toString('base64'), mimeType: imageMimeType }
```

The SDK exports `ImageContent` from `@earendil-works/pi-ai`. Need to check if the flat format (`data`, `mimeType`) is still valid or if it requires `source: { type: "base64", mediaType: "...", data: "..." }`.

### 1.5 `appendEntry` — CORRECT ✅

**SDK signature:**
```typescript
appendEntry<T = unknown>(customType: string, data?: T): void;
```

**Current code:**
```typescript
pi.appendEntry("whatsapp-state", {
    status: sessionManager.getStatus(),
    allowList: sessionManager.getAllowList(),
    allowedGroups: sessionManager.getAllowedGroups()
});
```

**VERDICT:** Aligned. But the `data` is passed by REFERENCE (the in-memory arrays). If `appendEntry` serializes immediately (JSON.stringify), it captures a snapshot — safe. If it stores a reference and serializes later, the data could be stale. **Need to verify Pi's implementation.**

### 1.6 `registerTool` — ALIGNED ✅

**SDK signature:**
```typescript
registerTool<TParams extends TSchema = TSchema, TDetails = unknown, TState = any>(
    tool: ToolDefinition<TParams, TDetails, TState>
): void;
```

The current `send_wa_message` tool uses `Type.Object(...)` from `@sinclair/typebox` — correct. But the `execute` callback now receives an `ExtensionContext` (v0.75.3) instead of `ExtensionCommandContext` (v0.73.1). The code already destructures `_ctx` from the closure, so this is fine.

### 1.7 New Session Events (v0.75.3 only)

| Event | Available? | Used in WhatsApp-Pi? |
|-------|-----------|---------------------|
| `session_start` | ✅ Both | ✅ YES — main init |
| `session_before_switch` | ❌ v0.73.1 | ❌ Not used |
| `session_before_fork` | ❌ v0.73.1 | ❌ Not used |
| `session_before_compact` | ❌ v0.73.1 | ❌ Not used |
| `session_compact` | ❌ v0.73.1 | ❌ Not used |
| `session_shutdown` | ✅ Both | ✅ YES — stop service |
| `session_before_tree` | ❌ v0.73.1 | ❌ Not used |
| `session_tree` | ❌ v0.73.1 | ❌ Not used |

**New opportunity:** `session_before_switch` could be used to detect session replacement and flush config before Pi switches sessions. This would prevent data loss during `/new` or `/fork`.

### 1.8 `ExtensionContext` new methods (v0.75.3 only)

| Method | Description | Useful? |
|--------|-------------|---------|
| `shutdown()` | Gracefully shutdown Pi | 🟡 Could replace manual SIGINT handlers |
| `getContextUsage()` | Token/context stats | 🟢 Nice for status |
| `compact()` | Trigger compaction | 🟡 Already done via WhatsApp /compact command |
| `getSystemPrompt()` | Read current system prompt | 🟢 Could log for debugging |
| `isIdle()` | Check if agent is streaming | 🟡 Already tracked |
| `hasPendingMessages()` | Check for queued messages | 🟢 Useful for "don't send now" logic |

---

## 2. Issues to Fix (Prioritized by Stability Impact)

### 🔴 P0: Config Persistence (DATA LOSS)
- [ ] **P0.1** Double-init guard in `ensureInitialized()` — prevent state reset
- [ ] **P0.2** Remove debounce for contact/group mutations — call `flushConfig()` directly
- [ ] **P0.3** Fix `setConnectionState()` fire-and-forget — await + error log
- [ ] **P0.4** Add retry + file-size verification to `flushConfig()` on Windows
- [ ] **P0.5** Add audit logging — trace every config write

### 🟡 P1: Status Display Accuracy
- [ ] **P1.1** Fix `getReadinessStatus()` to detect placeholder groups
- [ ] **P1.2** Footer should show "Connected (no contacts)" when appropriate

### 🟡 P2: SDK Alignment
- [ ] **P2.1** Fix/remove dead `pi.events` code in `i18n.ts`
- [ ] **P2.2** Verify image format for `sendUserMessage` (flat vs source wrapper)
- [ ] **P2.3** Handle `session_before_switch` to flush config before session change

### 🟢 P3: Documentation
- [ ] **P3.1** README: fix `--verbose` → `--whatsapp-verbose`
- [ ] **P3.2** README: remove "Reaction Mode" (already removed from code)
- [ ] **P3.3** README: document `--whatsapp-pi-online` clearly

### 🟢 P4: Tests
- [ ] **P4.1** Add `session.manager.test.ts`: persistence cycle tests
- [ ] **P4.2** Add `session.manager.test.ts`: double-init test
- [ ] **P4.3** Add `session.manager.test.ts`: debounce coalescing test
- [ ] **P4.4** Add `whatsapp.service.test.ts`: readiness with placeholder groups
- [ ] **P4.5** Reduce mocking in `whatsapp-pi.extension.test.ts`

---

## 3. Implementation Strategy

### Phase 1: Instrumentation (IMMEDIATE — trace the bug)
Add audit logging + double-init guard. Non-destructive. Lets us see what's happening.

### Phase 2: Fix Config Persistence (CRITICAL)
Implement P0.1-P0.5. These prevent data loss.

### Phase 3: Fix Status Display
Implement P1.1-P1.2. These make the UI truthful.

### Phase 4: SDK Alignment
Implement P2.1-P2.3. These ensure full compatibility.

### Phase 5: Rewrite Tests
Implement P4.1-P4.5. These prevent regression.

### Phase 6: Update Docs
Implement P3.1-P3.3.

---

## 4. File Ownership Map

```
src/services/session.manager.ts   → P0.1-P0.5, P4.1-P4.3
src/services/whatsapp.service.ts  → P1.1
whatsapp-pi.ts                    → P1.2, P2.3, P4.5
src/i18n.ts                       → P2.1
src/services/incoming-media.service.ts → P2.2 (image format)
README.md                         → P3.1-P3.3
tests/unit/session.manager.test.ts → P4.1-P4.3
tests/unit/whatsapp-pi.extension.test.ts → P4.5
```

---

## 5. Verification Protocol (after each phase)

1. `npm test` — all 138 tests must pass
2. `npx tsc --noEmit` — no type errors
3. `npx eslint whatsapp-pi.ts "src/**/*.ts" "tests/**/*.ts"` — no lint errors
4. Manual: Start Pi with `--whatsapp-pi-online`, add a contact, restart, verify contact persists
5. Manual: Start Pi with `--whatsapp-verbose`, verify Baileys logs appear
