# Tasks: Auto-Reconnect on Unexpected Disconnect

**Branch**: `029-auto-reconnect` | **Generated**: 2026-05-15  
**Spec**: `specs/029-auto-reconnect/spec.md` | **Plan**: `specs/029-auto-reconnect/plan.md`

## Implementation Strategy

MVP = all three user stories (all P1, single file). Deliver T001–T006 together; tests in T007.

---

## Phase 1: Foundation

> Prerequisite for all user stories. Introduces the `intentionalStop` flag and the `scheduleReconnect` helper that the story-level tasks depend on.

- [x] T001 Add `private intentionalStop = false` field to `WhatsAppService` in `src/services/whatsapp.service.ts` (after the `reconnectTimeout` field declaration)
- [x] T002 Add private method `scheduleReconnect(options: WhatsAppStartOptions)` to `WhatsAppService` in `src/services/whatsapp.service.ts` — increments `reconnectAttempts`, computes backoff delay via `getReconnectDelayMs()`, sets `isReconnecting = true`, fires a `setTimeout` that resets `isReconnecting`, checks `intentionalStop` before calling `start(options)`, and on `start()` failure calls `scheduleReconnect` recursively if `!intentionalStop`

---

## Phase 2: User Story 1 — Automatic Recovery from Unexpected Disconnect

> **Story goal**: Every unexpected connection drop triggers an automatic reconnect with exponential backoff; `start()` failures during reconnect schedule a further retry instead of silently stopping.  
> **Independent test**: Start service, trigger a non-auth close event (e.g. status 408), verify a second socket is created after the backoff delay. Then make `fetchLatestBaileysVersion` fail once and confirm a third socket is created after the next backoff interval.

- [x] T003 [US1] Update `handleConnectionClosed` in `src/services/whatsapp.service.ts` to replace the inline reconnect `setTimeout` block with a call to `this.scheduleReconnect(options)` (keeping the existing `await this.saveCreds?.()` and `this.cleanupSocket()` calls before it)
- [x] T004 [US1] Set `this.intentionalStop = false` at the very top of `start()` in `src/services/whatsapp.service.ts`, before the `isReconnecting` guard, so that a user-initiated connect always clears a prior intentional-stop state

---

## Phase 3: User Story 2 — No Reconnect After Manual Disconnect

> **Story goal**: After the user selects "Disconnect WhatsApp" (`stop()`), no automatic reconnect is triggered — not from a pending timer nor from any close event that may fire concurrently.  
> **Independent test**: Start service, trigger an unexpected close, call `stop()` before the backoff timer fires, advance fake timers past the delay — confirm no second socket is created.

- [x] T005 [US2] Set `this.intentionalStop = true` at the very start of `stop()` in `src/services/whatsapp.service.ts`, before any cleanup
- [x] T006 [US2] Add early-exit guard `if (this.intentionalStop) { return; }` at the top of `handleConnectionClosed` in `src/services/whatsapp.service.ts`, immediately after the variable declarations (`statusCode`, `errorMessage`, etc.) and before the `shouldTreatAsLoggedOut` block

---

## Phase 4: User Story 3 — No Reconnect After Deleting Authentication

> **Story goal**: After the user selects "Logoff / Delete Session" (`logout()`), no automatic reconnect is triggered.  
> **Independent test**: Start service, call `logout()`, advance fake timers — confirm no second socket is created and `deleteAuthState` was called.

- [x] T007 [US3] Set `this.intentionalStop = true` at the very start of `logout()` in `src/services/whatsapp.service.ts`, before `socket?.logout()`

---

## Phase 5: Tests

> All four test cases live in one new file. They reuse the baileys mock pattern from `tests/unit/whatsapp.service.auth-failure.test.ts` (hoisted `vi.mock('baileys', ...)`, fake timers, `createSessionManager()` factory).

- [x] T008 Create `tests/unit/whatsapp.service.reconnect.test.ts` with the following four test cases:
  - **[US1]** `"retries after start() fails during auto-reconnect"`: Start service, make `fetchLatestBaileysVersion` reject once, trigger unexpected close (408), advance past first backoff (5 s) — assert only 1 socket (start failed); advance past second backoff (10 s) — assert 2 sockets.
  - **[US2]** `"stop() cancels a pending reconnect timer"`: Start service, trigger unexpected close (408), call `stop()` immediately, advance 30 s — assert `makeWASocket` called exactly once.
  - **[US2]** `"stop() then start() re-enables auto-reconnect"`: Start service, call `stop()`, call `start()` (second socket), trigger unexpected close on second socket, advance past 5 s — assert third socket created.
  - **[US3]** `"logout() prevents auto-reconnect"`: Start service, call `logout()`, advance 30 s — assert `makeWASocket` called exactly once and `deleteAuthState` was called.

---

## Phase 6: Polish

- [x] T009 Run `npm test` and confirm all existing tests still pass alongside the new `whatsapp.service.reconnect.test.ts` suite in `tests/unit/`

---

## Dependencies

```
T001 ──► T002 ──► T003 (US1)
              │
              ├──► T004 (US1)
              │
              ├──► T005 (US2)
              │
              ├──► T006 (US2)
              │
              └──► T007 (US3)

T003 + T004 + T005 + T006 + T007 ──► T008 (tests)

T008 ──► T009 (verify)
```

All implementation tasks touch the same file (`whatsapp.service.ts`) and must be applied sequentially. T008 and T009 are sequential on the new file.

## Parallel Execution

| Parallel group | Tasks | Condition |
|----------------|-------|-----------|
| Story phases 2–4 can be designed in parallel | T003–T007 | All changes are in distinct methods; can be drafted simultaneously but must be applied sequentially to avoid diff conflicts |
| None during implementation | — | Single-file change; sequential edits required |

## Summary

| Phase | Tasks | User Story |
|-------|-------|------------|
| Foundation | T001–T002 | — |
| Auto-reconnect robustness | T003–T004 | US1 |
| No reconnect after stop | T005–T006 | US2 |
| No reconnect after logout | T007 | US3 |
| Tests | T008 | US1+US2+US3 |
| Polish | T009 | — |

**Total tasks**: 9  
**Parallelizable**: 0 implementation tasks (single file); test cases within T008 are independently writable  
**MVP scope**: T001–T009 (all P1, tightly coupled, small surface area — implement all together)
