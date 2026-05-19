# WhatsApp-Pi Fix v1.0.59 — Share & Install Guide

**Branch:** `fix/connection-architecture-and-status`  
**Commit:** `4c9a48e`  
**Based on:** `a8c3153` (HEAD of main)

---

## What This Fix Contains

| Fix | Description |
|-----|-------------|
| `--whatsapp-verbose` flag | Renamed from `--verbose` to avoid Pi built-in flag collision |
| `pi.events` i18n dead code | Replaced with `pi.registerFlag("whatsapp-pi-locale")` |
| SIGINT/SIGTERM handlers | Removed — Pi's `session_shutdown` covers all exit paths |
| `shutdownState` global | Removed — dead code |
| Verbose flag detection | `process.argv` → `pi.getFlag()` (proper Pi flag system) |
| Package migration | `@mariozechner/pi-coding-agent` → `@earendil-works/pi-coding-agent` |
| Skill documentation | Rewritten — removed fixed bugs, added diagnostic architecture |
| Stale config | Deleted `.pi/extensions/whatsapp/config.json` |

**Verification:** 138/138 tests pass, TypeScript zero errors, live WhatsApp connection confirmed.

---

## How to Share

### Option A: Share the git commit (RECOMMENDED)

```bash
# In the whatsapp-pi-fix directory:
cd C:\Users\johan\Pi_Code\PI_Project\whatsapp-pi-fix

# Push to a remote (fork or shared branch)
git remote add origin git@github.com:JohannBVB89/whatsapp-pi-fix.git
git push origin fix/connection-architecture-and-status

# Or create a patch file for sharing:
git format-patch a8c3153..4c9a48e -o patches/
# → patches/0001-fix-Pi-API-harmonization....patch
```

### Option B: Share as a tarball

```bash
cd C:\Users\johan\Pi_Code\PI_Project\whatsapp-pi-fix
tar -czf whatsapp-pi-fix-v1.0.59.tar.gz \
  whatsapp-pi.ts \
  src/ \
  .pi/skills/whatsapp-status.md \
  package.json \
  package-lock.json \
  tsconfig.json
# → whatsapp-pi-fix-v1.0.59.tar.gz (~25KB)
```

---

## How to Install (on any machine)

### Step 1: Clone or extract the project

```bash
git clone <repo-url> whatsapp-pi-fix
cd whatsapp-pi-fix
git checkout fix/connection-architecture-and-status
npm install
```

### Step 2: Verify

```bash
npm test              # Should pass 138/138
npx tsc --noEmit      # Should be zero errors
```

### Step 3: Install into Pi

```bash
# Register the local directory as Pi extension package
pi install .

# Remove old npm:whatsapp-pi if present
# Edit ~/.pi/agent/settings.json → remove "npm:whatsapp-pi" from packages array
```

### Step 4: Run

```bash
pi --whatsapp-pi-online --whatsapp-verbose
```

**Flags:**
- `--whatsapp-pi-online` — Auto-connect WhatsApp on startup
- `--whatsapp-verbose` — Show Baileys debug logs
- `--whatsapp-pi-locale=pt-BR` — Portuguese locale (pt-BR, es, fr)
- `--whatsapp-group=120363012345@g.us` — Bind to specific group

---

## Persistence Guarantee

### How it survives Pi updates

The extension is installed from the **local project directory** via `pi install .`. Pi stores the path in `~/.pi/agent/settings.json`:

```json
"packages": [
  "...",
  "..\\..\\Pi_Code\\PI_Project\\whatsapp-pi-fix"
]
```

- ✅ `pi update` does NOT overwrite local path installations
- ✅ `npm:whatsapp-pi` is NOT in packages (removed)
- ✅ Local source files are the single source of truth
- ✅ Changes to local source take effect on next Pi restart
- ✅ Git version control protects against accidental changes

### How it survives new Pi sessions

- `session_start` handler initializes on every session (startup, /new, /resume, /fork)
- `isRegistered()` checks `creds.json` directly (no config race)
- Auto-connect retries 4 times with 3s backoff
- `session_shutdown` calls `flushPendingSave()` to persist config
- `getEffectiveStatus()` cross-checks socket reality

---

## Test Commands (in Pi)

| Command | What it verifies |
|---------|-----------------|
| `/whatsapp-status` | Connection state, socket status, uptime |
| `/whatsapp` | Full TUI menu (Recents, Contacts, Groups) |
| `/whatsapp-connect` (via menu) | Manual QR pairing |
| Send message from phone | Incoming message → LLM response → WhatsApp reply |
| Send `/compact` from phone | Session compaction via WhatsApp |
| Send `/abort` from phone | Agent abort via WhatsApp |
| `Ctrl+C` | Graceful shutdown → `session_shutdown` |

---

## Rollback

```bash
# Revert Pi to use npm whatsapp-pi again
# Edit ~/.pi/agent/settings.json:
# 1. Add "npm:whatsapp-pi" to packages array
# 2. Remove "..\\..\\Pi_Code\\PI_Project\\whatsapp-pi-fix" from packages array
# Restart Pi

# Or restore from backup:
cp ~/.pi/agent/npm/node_modules/whatsapp-pi/.backup/* \
   ~/.pi/agent/npm/node_modules/whatsapp-pi/
```
