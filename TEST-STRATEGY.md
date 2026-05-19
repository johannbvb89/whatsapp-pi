# WhatsApp-Pi Test Strategy — Live Connection Verification

**Date:** 2026-05-19  
**Fixed code at:** `C:\Users\johan\Pi_Code\PI_Project\whatsapp-pi-fix`  
**Currently loaded version:** `npm:whatsapp-pi` v1.0.58 (OLD — from `~/.pi/agent/npm/node_modules/whatsapp-pi/`)  
**Pi version:** v0.75.3 (via `@earendil-works/pi-coding-agent`)

---

## Environment State

| Item | Status |
|------|--------|
| Pi installed | ✅ `/c/Users/johan/AppData/Roaming/npm/pi` |
| WhatsApp credentials | ✅ `~/.pi/whatsapp-pi/auth/creds.json` exists |
| WhatsApp config | ✅ `~/.pi/whatsapp-pi/config.json` — `hasAuthState: true`, `status: "connected"` (stale) |
| `npm:whatsapp-pi` in Pi packages | ✅ Loaded from `~/.pi/agent/npm/node_modules/whatsapp-pi/` v1.0.58 |
| Our fixed code | ✅ In git working tree at `whatsapp-pi-fix/` |
| `@earendil-works` package | ✅ Installed locally via `npm install --save-dev` |
| Tests | ✅ 138/138 pass, TypeScript compiles clean |

### ⚠️ Version Mismatch
- **Pi loads:** `~/.pi/agent/npm/node_modules/whatsapp-pi/whatsapp-pi.ts` (npm package v1.0.58 — OLD code)
- **We fixed:** `C:\Users\johan\Pi_Code\PI_Project\whatsapp-pi-fix\whatsapp-pi.ts` (NEW code)
- **Impact:** Our fixes to `pi.events`, `shutdownState`, `pi.getFlag()`, `@earendil-works` imports are NOT active in the running instance

---

## Deployment: How to Activate Fixed Code

### Method A: Deploy fixes into npm package directory (RECOMMENDED)
This patches the running instance without changing Pi startup.

```bash
cd /c/Users/johan/Pi_Code/PI_Project/whatsapp-pi-fix

# Copy fixed files into the npm package directory
cp whatsapp-pi.ts ~/.pi/agent/npm/node_modules/whatsapp-pi/whatsapp-pi.ts
cp -r src/i18n.ts ~/.pi/agent/npm/node_modules/whatsapp-pi/src/i18n.ts
cp -r src/ui/menu.handler.ts ~/.pi/agent/npm/node_modules/whatsapp-pi/src/ui/menu.handler.ts
cp -r package.json ~/.pi/agent/npm/node_modules/whatsapp-pi/package.json

# Install updated dependencies in npm package dir
cd ~/.pi/agent/npm/node_modules/whatsapp-pi
npm install

# Restart Pi
```

### Method B: Run with `-e` flag (ALTERNATIVE)
Load the local version directly, bypassing the npm package:

```bash
cd /c/Users/johan/Pi_Code/PI_Project/whatsapp-pi-fix
pi -e ./whatsapp-pi.ts --whatsapp-pi-online --verbose
```

**Risk:** May conflict with the npm package loading the same extension (name collision).

### Method C: Remove npm package, use local only
```bash
# Edit ~/.pi/agent/settings.json → remove "npm:whatsapp-pi" from packages array
# Then run: pi -e ./whatsapp-pi.ts --whatsapp-pi-online
```

---

## Test Scenarios

### Test 1: Extension Loads Without Errors (SMOKE)

**Setup:** Pi started with `--whatsapp-pi-online`

**Expected:**
- [ ] Pi TUI footer shows `| WhatsApp: Disconnected` (initial state)
- [ ] Pi logs show `[WhatsApp-Pi] session_start: initializing...`
- [ ] No crash or error in Pi console
- [ ] `--verbose` flag detected via `pi.getFlag()` (not process.argv)
- [ ] `pi.events` calls do NOT appear in any code path (dead code removed)

**Watch for:** Extension load error messages, `console.error` from extension

---

### Test 2: WhatsApp Auto-Connect (`--whatsapp-pi-online`)

**Setup:** Start Pi with `--whatsapp-pi-online` (credentials exist)

**Expected:**
- [ ] TUI status changes: `Disconnected` → `Connecting...` → `Connected`
- [ ] Logs show: `[WhatsApp-Pi] isRegistered: true`
- [ ] Logs show: `[WhatsApp-Pi] Auto-connect: credentials found, starting connection...`
- [ ] Connection succeeds (up to 4 retries)
- [ ] Logs show: `[WhatsApp-Pi] Connection SUCCESS`
- [ ] Footer shows: `| WhatsApp: Connected`

**If credentials are INVALID (QR needed):**
- [ ] QR code appears in terminal (qrcode-terminal)
- [ ] Pairing screen shown
- [ ] After scanning, status changes to Connected

---

### Test 3: `/whatsapp-status` Command

**Setup:** WhatsApp connected (or not)

**Type in Pi:** `/whatsapp-status`

**Expected (when connected):**
- [ ] Shows `Config Status` and `Effective Status` (both `connected`)
- [ ] Shows `Socket Active: ✅ YES`
- [ ] Shows `Credentials: ✅ VALID`
- [ ] Shows `Connected Since: [timestamp]`
- [ ] Shows `Uptime: Xs (Xm Xs)`
- [ ] Shows `Bound Group: (none)`
- [ ] Shows `Verbose Mode: ON` or `OFF`

**Expected (when disconnected):**
- [ ] Effective Status shows `disconnected` even if config says `connected`
- [ ] Socket Active: `❌ NO`

---

### Test 4: Incoming WhatsApp Message

**Setup:** Have an allowed contact send a message to the WhatsApp number

**Prerequisites:**
- Contact added to Allowed Contacts via `/whatsapp` → Allowed Contacts → Add Contact

**Expected:**
- [ ] Message appears in Pi as a user prompt (injected via `sendUserMessage`)
- [ ] TUI shows the message with sender name/JID
- [ ] Pi's LLM responds to the message
- [ ] Response is sent back via WhatsApp to the sender
- [ ] Footer notification: "Sent reply to WhatsApp contact"

**Image message test:**
- [ ] Send an image via WhatsApp
- [ ] Image is downloaded and forwarded to Pi's LLM
- [ ] LLM can describe/analyze the image

---

### Test 5: `/compact` and `/abort` via WhatsApp

**Setup:** Send `/compact` then `/abort` via WhatsApp

**Expected:**
- [ ] `/compact`: Session compacts, reply "Session compacted successfully! ✅"
- [ ] `/abort`: Agent aborts, reply "Aborted! ✅"
- [ ] Both replies are delivered to the WhatsApp contact

---

### Test 6: Graceful Shutdown (`session_shutdown`)

**Setup:** Exit Pi with Ctrl+C (or `/new`)

**Expected:**
- [ ] `[WhatsApp-Pi] Session shutdown detected. Stopping WhatsApp service...`
- [ ] `flushPendingSave()` called → config state persisted
- [ ] WhatsApp socket closes cleanly
- [ ] No crash or unhandled rejection
- [ ] **No duplicate stop from removed SIGINT/SIGTERM handlers**

---

### Test 7: i18n Locale Switching (Post-Fix)

**Setup:** Start Pi with `--whatsapp-pi-locale=pt-BR`

**Expected:**
- [ ] Menu labels appear in Portuguese: "Contactos permitidos", "Recentes", etc.
- [ ] Status messages in Portuguese: "Conectando...", "Conectado"
- [ ] Error messages in Portuguese

**Setup:** Start Pi with `--whatsapp-pi-locale=es`

**Expected:**
- [ ] Menu labels in Spanish

**Setup:** Start Pi without locale flag

**Expected:**
- [ ] All labels in English (fallback)

---

### Test 8: `--whatsapp-verbose` Flag Detection

**Setup:** Start Pi with `--whatsapp-verbose`

**Expected:**
- [ ] Log shows: `[WhatsApp-Pi] --whatsapp-verbose: true`
- [ ] Verbose mode message appears: "Verbose mode enabled - Baileys trace logs will be shown"
- [ ] This works via `pi.getFlag("whatsapp-verbose")` (not process.argv)

**Setup:** Start Pi WITHOUT `--whatsapp-verbose`

**Expected:**
- [ ] Log shows: `[WhatsApp-Pi] --whatsapp-verbose: false`
- [ ] No "Verbose mode enabled" message

---

### Test 9: `/whatsapp` TUI Menu

**Setup:** Type `/whatsapp` when connected

**Expected:**
- [ ] Menu shows: Recents, Allowed Contacts, Allowed Groups, Disconnect WhatsApp, Logoff
- [ ] "Connect WhatsApp" option NOT shown (already connected)
- [ ] Menu title shows current status

**When disconnected:**
- [ ] Only "Connect WhatsApp" shown (plus Logoff if credentials exist)
- [ ] Connect triggers QR pairing → successful connection

---

### Test 10: `@earendil-works` Import Verification

**Setup:** Start Pi and check that extension loads

**Expected:**
- [ ] Extension loads successfully from `@earendil-works/pi-coding-agent` imports
- [ ] No "Cannot find module '@mariozechner/pi-coding-agent'" errors
- [ ] All TypeScript types resolve correctly

---

## Test Execution Order

1. **Smoke** (Test 1) — verify extension loads
2. **Flags** (Test 8) — verify `pi.getFlag()` works
3. **Import** (Test 10) — verify no package import errors
4. **Connect** (Test 2) — verify WhatsApp connection
5. **Status** (Test 3) — verify `/whatsapp-status` command
6. **Menu** (Test 9) — verify `/whatsapp` TUI
7. **Messages** (Test 4) — verify incoming/outgoing messages
8. **Commands** (Test 5) — verify /compact, /abort
9. **Locale** (Test 7) — verify i18n
10. **Shutdown** (Test 6) — verify graceful stop

---

## Critical Points Still Needing Verification

### 🔴 Before Testing

1. **`@earendil-works/pi-coding-agent` MUST be installed in npm package dir**
   - The npm-installed `whatsapp-pi` has `@mariozechner/pi-coding-agent` in `devDependencies`
   - Our fixed code imports from `@earendil-works/pi-coding-agent`
   - Need to install the new dep: `cd ~/.pi/agent/npm/node_modules/whatsapp-pi && npm install --save-dev @earendil-works/pi-coding-agent`

2. **`package.json` must be updated in npm package dir**
   - Our fixed `package.json` has `@earendil-works/pi-coding-agent` in devDeps
   - Copy it over

3. **`@sinclair/typebox` needed in npm package dir**
   - Already in dependencies of local project, must be present in npm package dir

### 🟡 During Testing

4. **If connection fails with "Session Error (Bad MAC)"**: 
   - Run `/whatsapp` → Logoff (Delete Session) → Connect WhatsApp to re-pair
   
5. **If QR code doesn't appear**: 
   - Check `tail -f ~/.pi/whatsapp-pi/whatsapp-pi.log`
   - Verbose mode (`--verbose`) shows Baileys trace logs

6. **If messages not forwarded to LLM**:
   - Verify contact is in Allowed Contacts (`/whatsapp` → Allowed Contacts)
   - Check `getEffectiveStatus()` returns `connected`

### 🟢 Expected Pass

7. **138 unit tests pass** (already confirmed)
8. **TypeScript compiles with zero errors** (already confirmed)
