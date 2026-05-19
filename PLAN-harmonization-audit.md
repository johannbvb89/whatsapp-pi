# WhatsApp-Pi Harmonization Audit: Pi Extension API Compliance & Critical Issues

**Date:** 2026-05-19  
**Baseline commit:** a8c3153 (HEAD)  
**Pi version target:** Current (`@earendil-works/pi-coding-agent`)

---

## Executive Summary

This audit compares the WhatsApp-Pi extension against Pi's documented extension API and identifies critical compliance gaps, architectural risks, and documentation drift. Findings are organized by severity with concrete fix plans.

---

## 🔴 Category 1: Pi Extension API Compliance (CRITICAL)

### Issue 1.1 — Package import uses legacy name (FIX NOW)
**Severity:** MEDIUM  
**Location:** `whatsapp-pi.ts:1`, `src/i18n.ts:1`, `src/ui/menu.handler.ts:7`

```typescript
// CURRENT (legacy package name):
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

// DOCUMENTED (current Pi):
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
```

**DEFINITIVE EVIDENCE:**
- Both packages exist globally: `@earendil-works/pi-coding-agent@0.75.3` (current) and `@mariozechner/pi-coding-agent@0.73.1` (legacy)
- Both export the SAME type: `ExtensionAPI`, `ExtensionContext`, `ExtensionCommandContext`
- Pi docs (`extensions.md`) use `@earendil-works/pi-coding-agent` throughout
- The legacy `@mariozechner` is pulled in by other extensions (`feynman`, `pi-memory`, `toolkit`)
- `@earendil-works` is used by newer extensions (`pi-subagents`, `pi-lean-ctx`, `taskplane`, `ralph-wiggum`, `pi-docparser`)

**Impact:** Currently works (both packages co-exist), but `@mariozechner` is deprecated and may be removed.

**Fix:**
1. Change all type imports to `@earendil-works/pi-coding-agent`
2. Update `package.json` devDependencies accordingly

### Issue 1.2 — `pi.events` does NOT exist in Pi SDK (DEAD CODE)
**Severity:** CRITICAL  
**Location:** `src/i18n.ts:294-323`

```typescript
pi.events?.emit?.("pi-core/i18n/registerBundle", { ... });
pi.events?.on?.("pi-core/i18n/localeChanged", (event) => { ... });
pi.events?.emit?.("pi-core/i18n/requestApi", { ... });
```

**DEFINITIVE EVIDENCE:**
- `@earendil-works/pi-coding-agent` (v0.75.3) `index.d.ts` has **zero** references to `events`
- `@earendil-works/pi-coding-agent` (v0.75.3) `index.js` has **zero** references to `events`
- Pi docs (`extensions.md`) document `pi.on()` but NOT `pi.events`
- The optional chaining (`?.`) means these calls **silently do nothing at runtime**

**Impact:**
- The entire i18n locale detection is **dead code** — `currentLocale` is NEVER set at runtime
- `t()` ALWAYS returns fallback (English) strings
- Users cannot switch to pt-BR, es, or fr locales
- The `WHATSAPP_PI_LOCALE` env var and `--whatsapp-pi-locale=` CLI arg work, but they set `currentLocale` independently of Pi's locale system

**Fix:**
1. Replace `pi.events` with a documented locale approach: register `--whatsapp-pi-locale=` as a proper `pi.registerFlag()` with default
2. OR use `pi.on("session_start")` to seed locale from environment/settings
3. Remove the dead `pi.events` calls entirely

### Issue 1.3 — `sendUserMessage` image format mismatch
**Severity:** MEDIUM  
**Location:** `whatsapp-pi.ts:235-238`

```typescript
// CURRENT (flat format):
pi.sendUserMessage([
    { type: "text", text: `${messageHeader} ${text}` },
    { type: "image", data: imageBuffer.toString('base64'), mimeType: imageMimeType }
], { deliverAs: "followUp" });

// DOCUMENTED FORMAT (nested source object):
pi.sendUserMessage([
    { type: "text", text: `${messageHeader} ${text}` },
    { type: "image", source: { type: "base64", mediaType: "image/png", data: "..." } }
], { deliverAs: "followUp" });
```

**Evidence:** Pi docs (`extensions.md` line ~1200) show the `source` wrapper:
```typescript
{ type: "image", source: { type: "base64", mediaType: "image/png", data: "..." } }
```

**Impact:** Images sent via WhatsApp may not render in Pi's UI. The LLM may not see the image content.

**Fix:** Wrap image data in the `source` object as documented. The old flat format may still work via backwards-compat shim but is unreliable.

---

## 🟡 Category 2: Documentation & Skill Drift (HIGH)

### Issue 2.1 — Skill file lists fixed bugs as current
**Severity:** HIGH  
**Location:** `.pi/skills/whatsapp-status.md` "Known Bugs" section

The skill file was **created in commit a8c3153** but documents the **pre-fix** state:

| Skill says (bug) | Code now (fixed) |
|---|---|
| `isRegistered()` unreliable — depends on config load race | `isRegistered()` calls `hasCredentialsFile()` directly — no race |
| `saveConfig()` write race — fire-and-forget | `saveConfig()` is debounced (200ms), `flushConfig()` for critical paths |

**Fix:** Remove both bug entries or replace with "Resolution" notes documenting the fixes.

### Issue 2.2 — Missing architectural patterns in skill
**Severity:** MEDIUM  
**Location:** `.pi/skills/whatsapp-status.md`

Missing from the skill:
1. **`getEffectiveStatus()` dual-source truth** — config status cross-checked with `this.socket` nullity
2. **`setConnectionState()` vs deprecated `setStatus()`** — the new partial-update API
3. **`flushPendingSave()` shutdown flow** — drains debounce buffer
4. **`ensureInitialized()` concurrency guard** — `_initPromise` pattern
5. **Health check interval** — 30s automatic reconnect check

**Fix:** Add "Diagnostic Architecture" section covering all five patterns.

### Issue 2.3 — Skill file placement
**Severity:** LOW  
**Location:** `.pi/skills/whatsapp-status.md`

Skills placed in `.pi/skills/` are auto-discovered by Pi. This is correct placement. However, the extension doesn't register this via `resources_discover`, so if the skill is ever moved, there's no fallback registration.

---

## 🟠 Category 3: Architecture & Runtime Robustness (MEDIUM)

### Issue 3.1 — Manual signal handlers bypass Pi
**Severity:** MEDIUM  
**Location:** `whatsapp-pi.ts:65-78`

```typescript
process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
```

**Evidence:**
- Pi already emits `session_shutdown` on Ctrl+C, SIGINT, SIGTERM
- The extension already handles `pi.on("session_shutdown", ...)` at line ~494
- Manual signal handlers may race with Pi's own signal handling
- The `installGracefulShutdownHandlers()` uses `globalThis` to prevent double-install, but this is fragile

**Impact:** 
- Double-shutdown: WhatsApp service may be stopped twice
- Signal interception: Could prevent Pi from doing its own cleanup

**Fix:** Remove manual signal handlers. `session_shutdown` already covers this case. The `stop()` call in `session_shutdown` is sufficient.

### Issue 3.2 — Global mutable `_ctx` (stale across sessions)
**Severity:** MEDIUM  
**Location:** `whatsapp-pi.ts:54`

```typescript
let _ctx: ExtensionContext | undefined;
```

**Evidence:**
- `_ctx` is assigned on `session_start` (line 79)
- `_ctx` is reassigned in command handlers (line 326)
- Used to call `_ctx.abort()`, `_ctx.compact()` in the incoming message callback
- Pi docs warn about session replacement lifecycle: "Captured old `pi` / old command `ctx` session-bound objects are stale after replacement and will throw if used"

**Impact:** After `/new`, `/resume`, or `/fork`, `_ctx` points to a dead session context. Calls to `_ctx.abort()` or `_ctx.compact()` from WhatsApp message handlers will throw.

**Fix:**
1. Convert `_ctx` from a free variable to a getter function that always returns the latest valid context
2. Or check `_ctx.isIdle()` and `_ctx.sessionManager` for staleness before using
3. Or pass `ctx` explicitly through the callback chain

### Issue 3.3 — Verbose flag detection bypasses Pi's flag system
**Severity:** MEDIUM  
**Location:** `whatsapp-pi.ts:84-85`

```typescript
const isVerboseFlagSet = process.argv.includes("--verbose");
const isVerbose = isVerboseFlagSet;
```

**Evidence:**
- The extension registers `pi.registerFlag("verbose", ...)` at line 28-31
- But then reads it from `process.argv` instead of `pi.getFlag("verbose")`
- `pi.getFlag()` handles flag aliases, validation, and type coercion
- `process.argv` is a raw string array — can't distinguish `--verbose` from `--verbose=false` or flag aliases

**Impact:**
- If Pi normalizes flag names, the raw argv check misses it
- `pi.getFlag("verbose")` is unused despite the flag being registered
- The `isVerbose` variable is just `isVerboseFlagSet` — no value add

**Fix:** Replace with `const isVerbose = pi.getFlag("verbose") === true;`

---

## 🟢 Category 4: Extension Placement & Discovery (MEDIUM)

### Issue 4.1 — Extension not in auto-discovered location
**Severity:** MEDIUM  

**Current state:**
- Extension file: `whatsapp-pi.ts` (project root)
- Project-local auto-discovery: `.pi/extensions/*.ts` — contains only `whatsapp/` subdirectory with a `config.json` (misplaced WhatsApp session file)
- Global auto-discovery: `~/.pi/agent/extensions/` — empty
- Package `pi.extensions` field: `["./whatsapp-pi.ts"]` (correct for package install)

**Impact:** Project-local auto-discovery doesn't work. Users must load with `pi -e ./whatsapp-pi.ts` or install as a package.

**Fix:** Either:
1. Add a symlink or alias: `.pi/extensions/whatsapp/index.ts` → `../../../whatsapp-pi.ts`
2. Or document that the extension requires the `-e` flag or package install
3. Clean up the misplaced `.pi/extensions/whatsapp/config.json` (it's a WhatsApp session config, not a Pi extension config)

### Issue 4.2 — Stale WhatsApp config in Pi extensions directory
**Severity:** LOW  
**Location:** `.pi/extensions/whatsapp/config.json`

```json
{ "allowList": [], "status": "connected" }
```

This is a WhatsApp session config file mistakenly placed in Pi's extension discovery directory. It doesn't contain an `index.ts` so it's not loaded as an extension, but it's confusing and should be removed.

---

## 🔵 Category 5: Minor Code Quality (LOW)

### Issue 5.1 — No `resources_discover` handler
**Severity:** LOW  

The extension doesn't register its skill path via `resources_discover`:
```typescript
pi.on("resources_discover", async (_event, _ctx) => {
  return { skillPaths: [".pi/skills"] };
});
```

This is redundant since `.pi/skills/` is auto-discovered, but would be a good defensive pattern.

### Issue 5.2 — `console.log` used instead of logger
**Severity:** LOW  
**Location:** `whatsapp-pi.ts:291, 301`

The `send_wa_message` tool uses `console.log()` for outgoing message logging instead of the `logger` instance. Inconsistent with the rest of the codebase.

### Issue 5.3 — `pino` imported as `P`
**Severity:** TRIVIAL  
**Location:** `src/services/whatsapp.service.ts:7`

```typescript
import P from 'pino';
```

Variable name `P` is non-descriptive. Convention is `pino`.

---

## Complete Fix Plan

### Phase 1: Critical API Fixes (BLOCKER)
1. ✅ Verify runtime package name (`@mariozechner` vs `@earendil-works`) by checking installed Pi
2. 🔧 Fix `sendUserMessage` image format (add `source` wrapper)
3. 🔧 Test `pi.events` i18n pattern — add fallback

### Phase 2: Skill Documentation Update
4. 🔧 Rewrite `.pi/skills/whatsapp-status.md`:
   - Remove resolved bugs
   - Add `getEffectiveStatus()` architecture
   - Add `setConnectionState()` usage
   - Add `flushPendingSave()` flow
   - Add concurrency guard documentation

### Phase 3: Architecture Hardening
5. 🔧 Remove manual SIGINT/SIGTERM handlers
6. 🔧 Replace global `_ctx` with safe accessor pattern
7. 🔧 Fix verbose flag detection to use `pi.getFlag()`
8. 🔧 Verify and fix `pi.events` i18n pattern

### Phase 4: Cleanup
9. 🧹 Clean up `.pi/extensions/whatsapp/config.json`
10. 🧹 Add extension discovery docs
11. 🧹 Unify console logging

---

## File Checklist

| File | Issues | Action |
|------|--------|--------|
| `whatsapp-pi.ts` | 1.1, 1.3, 3.1, 3.2, 3.3, 5.2 | Major refactor |
| `src/i18n.ts` | 1.2 | Verify + add fallback |
| `src/ui/menu.handler.ts` | 1.1 | Import rename |
| `.pi/skills/whatsapp-status.md` | 2.1, 2.2 | Full rewrite |
| `.pi/extensions/whatsapp/config.json` | 4.2 | Delete |
| `package.json` | 1.1 | Fix dependencies |
