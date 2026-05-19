# WhatsApp-Pi Review Checklist

> **STATUS: All P0 bugs RESOLVED (2026-05-19). Test suite: 155 tests.**
>
> **Use this before every commit / PR / code review.**
> Complete all checks. Mark failures with ❌ and fix before proceeding.

---

## 🔴 GATE 1: Build & Tests

```
[ ] npm test — all 155 tests pass
[ ] npx tsc --noEmit — zero type errors
[ ] npx eslint whatsapp-pi.ts "src/**/*.ts" — zero lint errors
```

---

## 🔴 GATE 2: Config Persistence (data loss prevention)

```
[ ] P0.1 Double init guard: ensureInitialized() called twice → second is no-op, state NOT reset
     Test: session.manager.test.ts "should not reload config when ensureInitialized() is called twice"
     
[ ] P0.2 No fire-and-forget: setConnectionState() uses `await`, not `void`
     Search: grep -n "void.*saveConfig" src/services/session.manager.ts → must return 0 matches
     
[ ] P0.3 Critical mutations flush directly: addNumber/removeNumber/addAllowedGroup/removeAllowedGroup 
     use flushConfig() directly (not debounced saveConfig)
     Search: check these 4 methods call flushConfig() not saveConfig()
     
[ ] P0.4 Windows rename robustness: flushConfig() has retry + file size verification
     Search: grep -n "rename\|writeFile" src/services/session.manager.ts → verify retry logic
     
[ ] P0.5 Persistence cycle test: addNumber → flush → new SessionManager → load → number survives
     Test: session.manager.test.ts "should persist added number across save → reload"
```

---

## 🟡 GATE 3: Status Display Accuracy

```
[ ] P1.1 Readiness status: getReadinessStatus() returns 'no-contacts' when only placeholder groups exist
     Test: whatsapp.service.test.ts "should return no-contacts when connected but allow list is empty"
     
[ ] P1.2 Footer: shows "Connected (no contacts)" when readiness is no-contacts
     Test: whatsapp-pi.extension.test.ts "footer shows no-contacts readiness when allow list empty"
```

---

## 🟡 GATE 4: SDK Alignment

```
[ ] P2.1 No pi.events dead code: search for pi.events?.emit or pi.events?.on in i18n.ts
     If found → replace with registerFlag or real EventBus pattern
     
[ ] P2.2 Image format: sendUserMessage uses correct ImageContent type from @earendil-works/pi-ai
     Verify: ContentPart format matches { type: "image", source: { type: "base64", mediaType, data } }
     
[ ] P2.3 Session lifecycle: session_shutdown handler calls flushPendingSave()
     Search: grep -n "session_shutdown" whatsapp-pi.ts → verify flushPendingSave is called
```

---

## 🟢 GATE 5: Docs & Imports

```
[ ] P3.1 README: no reference to --verbose for WhatsApp mode (use --whatsapp-verbose)
     Search: grep -n "\-\-verbose" README.md → must reference --whatsapp-verbose
     
[ ] P3.2 README: no "Reaction Mode" section (removed in spec 033)
     Search: grep -in "reaction mode" README.md → must return 0 matches
     
[ ] Import check: zero references to @mariozechner/pi-coding-agent in source files
     Search: grep -rn "@mariozechner/pi-coding-agent" src/ whatsapp-pi.ts → must return 0 matches
```

---

## 🟢 GATE 6: Test Coverage (new tests required for new code)

```
[ ] New session.manager.ts code → must add persistence cycle test
[ ] New whatsapp.service.ts code → must add readiness status test
[ ] New whatsapp-pi.ts code → must add lifecycle event test
[ ] New i18n.ts code → must add locale/translation test
[ ] Any shared state mutation → must test save → reload cycle
```

---

## 🟢 GATE 7: Manual Verification (if touching these paths)

```
[ ] Config persistence: start Pi, add contact, Ctrl+C, restart, contact still present
[ ] Double init: start Pi, trigger some lifecycle event, contacts preserved
[ ] Debounce: add 3 contacts rapidly, restart, all 3 present
[ ] Readiness: /whatsapp-status shows correct readiness for current state
[ ] Auto-connect: --whatsapp-pi-online connects without QR when creds exist
```

---

## Signature

```
Reviewer: __________________
Date: __________________
Result: ☐ PASS ☐ FAIL (items marked with ❌ above)
```
