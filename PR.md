## Title

```
fix: resolve 12 critical bugs — config persistence, readiness states, connection reliability
```

---

## Description

### Summary

This PR resolves **12 bugs** across the WhatsApp-Pi extension, fixing data-loss risks, inaccurate status reporting, and SDK misalignment. All fixes are verified with expanded test coverage (155/155 passing) and live end-to-end WhatsApp testing.

### Fixes by Category

#### 🔴 P0 — Data Loss / Config Corruption

| Bug | Problem | Fix |
|-----|---------|-----|
| **Double-init resets state** | `ensureInitialized()` reloaded config from disk, overwriting in-memory allow-lists on every /whatsapp menu open | Added `_initialized` flag — second call is a no-op |
| **Fire-and-forget saves** | `setConnectionState()` called `saveConfig()` without `await`, silent write failures | Proper `try/catch` with `await` + error logging |
| **Debounce loses writes on crash** | Debounced `saveConfig()` skipped pending mutations on hard exit | Contact/group mutations now call `flushConfig()` directly |
| **Windows .tmp zombie** | `rename()` on Windows leaves orphaned `.tmp` file | 3-retry loop with zero-byte detection + audit logging |
| **Contacts lost on restart** | Config not flushed before process exit | `session_before_switch` + `session_shutdown` handlers ensure persistence |

#### 🟡 P1 — Status UX

| Bug | Problem | Fix |
|-----|---------|-----|
| **False "Ready" status** | `getReadinessStatus()` returned "ready" when only groups existed, no contacts | New `groups-only` state — groups alone without contacts is NOT "ready" |
| **Misleading footer** | Footer showed "Connected" with 0 contacts, implying functionality | Now shows `Connected ⚠️ Groups only — 0 contacts` or `Connected ⚠️ No Contacts` |

#### 🟡 P2 — SDK Alignment

| Bug | Problem | Fix |
|-----|---------|-----|
| **`pi.events` dead code** | i18n file referenced removed API | Cleaned up, replaced with `pi.registerFlag()` |
| **`--verbose` flag collision** | Clashed with Pi's builtin `--verbose` | Renamed to `--whatsapp-verbose` using `pi.getFlag()` |
| **Missing `session_before_switch`** | No config flush on session change | Added handler to flush pending saves |

#### 🟢 P3 — Docs / Hygiene

| Bug | Problem | Fix |
|-----|---------|-----|
| **Stale docs** | README referenced removed features + wrong flag names | Updated to reflect current state |
| **Orphaned config** | Stale `.pi/extensions/whatsapp/config.json` in repo | Deleted |

### Test Coverage

- **155 tests passing** (up from 138)
- New tests added for: double-init guard, debounce coalescing, persistence cycle, readiness states, connection lifecycle
- All test numbers are synthetic/placeholder — **zero real phone numbers**

### Verification

- ✅ `npm test` — 155/155 passing
- ✅ `npx tsc --noEmit` — zero errors
- ✅ Live WhatsApp round-trip verified (send → phone receives → phone replies → Pi processes)
- ✅ Config survives graceful shutdown, hard kill, and restart

### Key Files Changed

| File | Changes |
|------|---------|
| `src/services/session.manager.ts` | Double-init guard, immediate flush, Windows retry, audit logging |
| `src/services/whatsapp.service.ts` | Connection lifecycle, readiness states, operator JID persistence |
| `whatsapp-pi.ts` | Flag rename (`--whatsapp-verbose`), SDK alignment, session handlers |
| `src/i18n.ts` | Dead code removal, flag registration |
| `tests/unit/` | +17 test cases across session manager and WhatsApp service |

### Additional Documentation

The PR includes comprehensive audit documentation:

- `AUDIT-COMPREHENSIVE.md` — full bug-by-bug audit with root cause analysis
- `TEST-GAP-ANALYSIS.md` — original test gaps (all resolved)
- `REVIEW-CHECKLIST.md` — 7-gate pre-review verification checklist
- `STRATEGY-v2-rebase.md` — SDK rebase strategy and migration notes
- `.pi/skills/whatsapp-pi-guard.md` — auto-loaded guard skill preventing regressions

### SDK Compatibility

Aligned with `@earendil-works/pi-coding-agent@0.75.3` — no breaking changes.

---

**Ready for review.** All 12 bugs resolved, test suite green, live verified.