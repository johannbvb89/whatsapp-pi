# whatsapp-pi Development Guidelines

> **STATUS: All 12 critical bugs RESOLVED** ✅
> **Tests:** 155 passing (was 138)
> **SDK:** `@earendil-works/pi-coding-agent@0.75.3`
> **Audit:** 2026-05-19 — see `AUDIT-COMPREHENSIVE.md`

## 🔴 BEFORE ANY CODE CHANGE

Run `.pi/skills/whatsapp-pi-guard.md` — the guard skill documents resolved bugs and MUST NOT regress.

After ANY change: `npm test && npx tsc --noEmit`

Pre-review: complete `REVIEW-CHECKLIST.md`.

## Pi SDK Baseline

```typescript
// CORRECT — Pi SDK v0.75.3 (current)
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// WRONG — Deprecated, do NOT use
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
```

**SDK reference:** `C:\Users\johan\AppData\Roaming\npm\node_modules\@earendil-works\pi-coding-agent\dist\core\extensions\types.d.ts`

## Active Technologies
- TypeScript 5.x / Node.js 20+
- `@earendil-works/pi-coding-agent@^0.75.3` (Pi Extension API)
- `@whiskeysockets/baileys@^6.7.21` (WhatsApp Web)
- `pino@^10.3.1` (logging)
- `qrcode-terminal@^0.12.0` (QR display)
- `@sinclair/typebox@^0.34.49` (tool parameter validation)
- `@llamaindex/liteparse@^1.5.3` (PDF parsing)
- `vitest@^1.2.0` (testing)
- Local file-based persistence in `~/.pi/whatsapp-pi/` (config.json, auth/, recents/)

## Project Structure

```
whatsapp-pi.ts                  # Entry point, flags, tools, commands, lifecycle
src/
  models/whatsapp.types.ts      # Type definitions
  services/
    session.manager.ts          # 🔴 Config persistence, auth state, allow-lists
    whatsapp.service.ts         # 🔴 Socket lifecycle, reconnect, readiness
    message.sender.ts           # Message send with retry logic
    recents.service.ts          # Conversation history
    audio.service.ts            # Audio transcription
    incoming-media.service.ts   # Image/document/audio processing
    incoming-message.resolver.ts # Message text extraction
    baileys-console-filter.ts   # Baileys log suppression
    whatsapp-pi.logger.ts       # File-based logging
  ui/
    menu.handler.ts             # /whatsapp TUI menu
    message-detail.view.ts      # Message detail view
    message-reply.view.ts       # Reply composer
  i18n.ts                       # Locale strings
tests/unit/                     # Unit tests
.pi/skills/                     # Auto-discovered skills
  whatsapp-pi-guard.md          # 🔴 Guard skill (always active)
  whatsapp-status.md            # Status debugging skill
```

## Commands

```bash
npm test              # Run all tests (must pass before commit)
npm run lint          # ESLint check
npm run typecheck     # TypeScript type checking
npx tsc --noEmit      # Full type check
```

## Code Style

TypeScript 5.x / Node.js 20+: Follow standard conventions

## Critical Files (changes here require guard review)

| File | Guard Reference |
|------|----------------|
| `src/services/session.manager.ts` | Bugs P0.1-P0.5 — config persistence |
| `src/services/whatsapp.service.ts` | Bugs P1.1-P1.2 — readiness/status |
| `whatsapp-pi.ts` | Bugs P2.3 — session lifecycle |
| `src/i18n.ts` | Bug P2.1 — dead code |
| `README.md` | Bugs P3.1-P3.2 — stale docs |

## Known Bug Landscape (2026-05-19 Audit)

See `AUDIT-COMPREHENSIVE.md` for full details. Every change must verify against these 12 bugs:

| Severity | Count | Documentation |
|----------|-------|---------------|
| 🔴 P0 (data loss) | 5 | `PLAN-config-overwrite-investigation.md` |
| 🟡 P1 (status/UX) | 2 | `AUDIT-COMPREHENSIVE.md` §Category 2 |
| 🟡 P2 (SDK alignment) | 3 | `STRATEGY-v2-rebase.md` |
| 🟢 P3 (docs/hygiene) | 2 | `AUDIT-COMPREHENSIVE.md` §Category 3 |

## Test Requirements

Any change to `session.manager.ts` MUST include tests for:
- Persistence cycle (save → reload → verify)
- Double-init guard (second `ensureInitialized()` is no-op)
- Debounce coalescing (rapid mutations produce correct final state)
- Error paths (write failures logged, not swallowed)

See `TEST-GAP-ANALYSIS.md` for the full gap report.

## Related Documents

- `STRATEGY-v2-rebase.md` — SDK rebase strategy
- `AUDIT-COMPREHENSIVE.md` — Full audit report
- `TEST-GAP-ANALYSIS.md` — Test coverage gaps
- `REVIEW-CHECKLIST.md` — Pre-review verification checklist
- `.pi/skills/whatsapp-pi-guard.md` — Auto-loaded guard skill

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
