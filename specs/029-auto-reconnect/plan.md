# Implementation Plan: Auto-Reconnect on Unexpected Disconnect

**Branch**: `029-auto-reconnect` | **Date**: 2026-05-15 | **Spec**: `specs/029-auto-reconnect/spec.md`

## Summary

Ensure `WhatsAppService` auto-reconnects after every unexpected connection drop, while staying disconnected when the user explicitly stops or logs out via the `/whatsapp` menu. Fix the silent failure path where a `start()` error during auto-reconnect halted all future retry attempts.

## Technical Context

**Language/Version**: TypeScript 5.x / Node.js 20+  
**Primary Dependencies**: `@whiskeysockets/baileys`, `pino`, `qrcode-terminal`  
**Storage**: No persistent storage changes  
**Testing**: Vitest, fake timers  
**Target Platform**: Desktop Node.js CLI/TUI extension  
**Performance Goals**: Reconnect decision is synchronous and adds no latency to normal message flow  
**Constraints**: Must not change the public API of `WhatsAppService`; must preserve existing backoff logic; must not persist the intentional-stop flag across restarts  
**Scale/Scope**: Single-user runtime state; no new config or persistence layer

## Constitution Check

- [x] **I. OOP**: New flag and new private method are encapsulated inside the existing `WhatsAppService` class.
- [x] **II. Clean Code**: `intentionalStop` is explicit; `scheduleReconnect` isolates reconnect scheduling with a single responsibility.
- [x] **III. SOLID**: Service layer owns runtime connection state; no responsibility leaks into `SessionManager` or `MenuHandler`.
- [x] **IV. TypeScript**: Flag is a typed `boolean`; no `any` additions.
- [x] **V. Simplicity**: Two field additions, one new private method, minor changes to three existing methods. No new subsystem.

## Project Structure

### Documentation (this feature)

```text
specs/029-auto-reconnect/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── checklists/
    └── requirements.md
```

### Source Changes

```text
src/services/whatsapp.service.ts   ← primary change
tests/unit/
└── whatsapp.service.reconnect.test.ts   ← new test file
```

## Phase 1: Implementation

### 1.1 — `WhatsAppService` changes (`src/services/whatsapp.service.ts`)

#### A. New field

Add after the existing `private reconnectTimeout` field:

```typescript
private intentionalStop = false;
```

#### B. `start()` — clear the flag on user-initiated connect

At the very top of `start()`, before the `isReconnecting` guard:

```typescript
this.intentionalStop = false;
```

#### C. `stop()` — set the flag before cleanup

At the very start of `stop()`:

```typescript
this.intentionalStop = true;
```

#### D. `logout()` — set the flag before socket logout

At the very start of `logout()`:

```typescript
this.intentionalStop = true;
```

#### E. New private method `scheduleReconnect`

Extracts and replaces the inline reconnect timer in `handleConnectionClosed`. Adds:
- `intentionalStop` guard before and inside the timer
- try/catch around `start()` with recursive retry on failure

```typescript
private scheduleReconnect(options: WhatsAppStartOptions) {
    if (this.intentionalStop) return;
    this.isReconnecting = true;
    this.reconnectAttempts++;
    const delay = this.getReconnectDelayMs();
    this.onStatusUpdate?.(t('service.whatsapp.reconnecting'));
    this.clearReconnectTimeout();
    this.reconnectTimeout = setTimeout(async () => {
        this.isReconnecting = false;
        if (this.intentionalStop) return;
        try {
            await this.start(options);
        } catch {
            if (!this.intentionalStop) {
                this.scheduleReconnect(options);
            }
        }
    }, delay);
}
```

#### F. `handleConnectionClosed` — add `intentionalStop` early exit and use `scheduleReconnect`

At the top of `handleConnectionClosed`, after the existing variable declarations and before the `shouldTreatAsLoggedOut` block:

```typescript
if (this.intentionalStop) {
    return;
}
```

Replace the existing inline reconnect block:

```typescript
// OLD
if (shouldReconnect && !this.isReconnecting) {
    this.isReconnecting = true;
    this.reconnectAttempts++;
    const reconnectDelayMs = this.getReconnectDelayMs();
    this.onStatusUpdate?.(t('service.whatsapp.reconnecting'));
    this.clearReconnectTimeout();
    await this.saveCreds?.();
    this.cleanupSocket();
    this.reconnectTimeout = setTimeout(() => {
        this.isReconnecting = false;
        void this.start(options);
    }, reconnectDelayMs);
}

// NEW
if (shouldReconnect && !this.isReconnecting) {
    await this.saveCreds?.();
    this.cleanupSocket();
    this.scheduleReconnect(options);
}
```

### 1.2 — New test file (`tests/unit/whatsapp.service.reconnect.test.ts`)

Four tests covering the new scenarios (reuse the baileys mock pattern from `whatsapp.service.auth-failure.test.ts`):

| Test | What it verifies |
|------|-----------------|
| `stop() cancels pending auto-reconnect` | Timer cleared; no new socket after 10s |
| `stop() then start() re-enables auto-reconnect` | Next unexpected drop triggers reconnect |
| `logout() prevents auto-reconnect` | No new socket after logout + timer advance |
| `start() failure during reconnect retries with backoff` | Second timer fires and creates socket after failure |

## Complexity Tracking

No constitution violations. Total change surface: ~25 lines modified/added in `whatsapp.service.ts` plus the new test file.
