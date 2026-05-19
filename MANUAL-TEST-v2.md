# WhatsApp-Pi Manual Test Protocol v2.0

**Date:** 2026-05-19  
**Purpose:** End-to-end verification of all 12 resolved bugs across real WhatsApp usage  
**Prerequisites:** Pi running with `--whatsapp-pi-online`, WhatsApp credentials valid

---

## Pre-Flight Checks

```bash
# 1. Confirm clean state
cat ~/.pi/whatsapp-pi/config.json | grep -E "allowList|allowedGroups|status"
# Expect: allowList: [], allowedGroups: [...], status: connected/disconnected

# 2. Check audit log is writing
cat ~/.pi/whatsapp-pi/config-audit.log | tail -3
# Expect: JSON entries with ts, pid, allowListLen, allowedGroupsLen, status, stack

# 3. Start Pi
cd C:\Users\johan\Pi_Code\PI_Project\whatsapp-pi-fix
pi --whatsapp-pi-online
```

---

## TEST SUITE A: Readiness States (P1.1, P1.2)

### A1: No Contacts + No Groups = "Connected ⚠️ No Contacts"

```
SETUP: Remove ALL contacts and ALL groups from allowed lists
       (/whatsapp → Allowed Contacts → select each → Remove)
       (/whatsapp → Allowed Groups → select each → Remove)

EXPECT in Pi footer:
  | WhatsApp: Connected ⚠️ No Contacts — add via /whatsapp

EXPECT in /whatsapp-status:
  Readiness: Connected ⚠️ No Contacts — add via /whatsapp
  Allowed Contacts: 0
  Allowed Groups: 0

[ ] FOOTER shows "No Contacts" warning    ☐ PASS / ☐ FAIL
[ ] /whatsapp-status shows correct counts ☐ PASS / ☐ FAIL
```

### A2: 1 Contact + 0 Groups = "Connected ✅"

```
SETUP: Add exactly 1 contact
       /whatsapp → Allowed Contacts → Add Contact → +5511999998888

EXPECT in Pi footer:
  | WhatsApp: Ready ✅

EXPECT in /whatsapp-status:
  Readiness: Ready ✅
  Allowed Contacts: 1
  Allowed Groups: 0

[ ] FOOTER shows "Ready ✅"              ☐ PASS / ☐ FAIL
[ ] /whatsapp-status shows 1 contact     ☐ PASS / ☐ FAIL
```

### A3: 0 Contacts + 1 Group (no binding) = "Connected ⚠️ Groups only"

```
SETUP: Remove all contacts, add 1 group
       (/whatsapp → Allowed Groups → Add Group → 120363012345@g.us)

EXPECT in Pi footer:
  | WhatsApp: Connected ⚠️ Groups only — 0 contacts

EXPECT in /whatsapp-status:
  Readiness: Connected ⚠️ Groups only — 0 contacts
  Allowed Contacts: 0
  Allowed Groups: 1

[ ] FOOTER shows "Groups only" warning   ☐ PASS / ☐ FAIL
[ ] /whatsapp-status shows groups-only   ☐ PASS / ☐ FAIL
```

### A4: 0 Contacts + Bound Group = "Connected ✅"

```
SETUP: Restart Pi with group binding
       pi --whatsapp-pi-online --whatsapp-group=120363012345@g.us

EXPECT in Pi footer:
  | WhatsApp: Ready ✅

EXPECT in /whatsapp-status:
  Readiness: Ready ✅
  Bound Group: 120363012345@g.us

[ ] FOOTER shows "Ready ✅" with binding  ☐ PASS / ☐ FAIL
```

### A5: Disconnected = No Readiness

```
SETUP: /whatsapp → Disconnect WhatsApp

EXPECT in Pi footer:
  | WhatsApp: Disconnected

EXPECT in /whatsapp-status:
  Readiness: Not Connected

[ ] FOOTER shows "Disconnected"          ☐ PASS / ☐ FAIL
[ ] Readiness shows "Not Connected"      ☐ PASS / ☐ FAIL
```

---

## TEST SUITE B: Config Persistence (P0.3, P0.5)

### B1: Contact Survives Graceful Restart

```
SETUP: 
  1. Add contact +5511999998888 via /whatsapp
  2. Wait 1 second (ensure flush)
  3. Press Ctrl+C to gracefully exit Pi

VERIFY:
  1. cat ~/.pi/whatsapp-pi/config.json | grep allowList
  → Must contain +5511999998888

  2. Start Pi again: pi --whatsapp-pi-online
  3. /whatsapp-status
  → Allowed Contacts: 1

[ ] Contact in config.json after exit   ☐ PASS / ☐ FAIL
[ ] Contact visible after restart        ☐ PASS / ☐ FAIL
```

### B2: Contact Survives Kill (Hard Exit)

```
SETUP:
  1. Add contact +5521999998888 via /whatsapp
  2. IMMEDIATELY kill the Pi process (Terminal: Ctrl+C twice or kill)

VERIFY:
  1. cat ~/.pi/whatsapp-pi/config.json | grep allowList
  → Must contain +5521999998888 (immediate flush now)
  
  2. Start Pi again
  3. /whatsapp-status → Allowed Contacts: 1+ (both contacts)

[ ] Contact survives immediate kill      ☐ PASS / ☐ FAIL
```

### B3: Rapid Additions All Survive

```
SETUP:
  1. Add 3 contacts rapidly (within 2 seconds):
     +5531999998888, +5532999998888, +5533999998888

VERIFY:
  /whatsapp-status → Allowed Contacts: 4+ (all visible)
  cat ~/.pi/whatsapp-pi/config.json | grep allowList
  → All 3 new numbers present

[ ] All 3 rapid additions present         ☐ PASS / ☐ FAIL
```

### B4: Remove Survives Restart

```
SETUP:
  1. Remove one contact via /whatsapp
  2. Restart Pi

VERIFY:
  /whatsapp-status → contact count decreased by 1, removed contact gone

[ ] Removal persists across restart       ☐ PASS / ☐ FAIL
```

### B5: Groups Persist Too

```
SETUP:
  1. Add group 120363099999@g.us
  2. Restart Pi

VERIFY:
  /whatsapp-status → Allowed Groups includes the new group

[ ] Group survives restart                ☐ PASS / ☐ FAIL
```

---

## TEST SUITE C: Double-Init Guard (P0.1)

### C1: Menu Operations Don't Trigger State Reset

```
SETUP:
  1. Add a contact
  2. Open /whatsapp menu multiple times rapidly (just navigate around)
  3. /whatsapp-status

VERIFY:
  Contact still present, count unchanged

[ ] Contacts survive menu navigation spam  ☐ PASS / ☐ FAIL
```

### C2: Session Reload Doesn't Lose Contacts

```
SETUP:
  1. Add a contact
  2. /reload (reload Pi extensions)
  3. /whatsapp-status

VERIFY:
  Contact still present

[ ] Contacts survive /reload              ☐ PASS / ☐ FAIL
```

---

## TEST SUITE D: Audit Log (Phase 1)

### D1: Audit Log Records Every Write

```
VERIFY:
  tail -20 ~/.pi/whatsapp-pi/config-audit.log

  Every entry should have:
  - ts (ISO timestamp)
  - pid (process ID)
  - allowListLen (number)
  - allowedGroupsLen (number)
  - status (string)
  - stack (call stack trace)

[ ] Audit log has valid JSON entries       ☐ PASS / ☐ FAIL
[ ] Stack traces show calling code         ☐ PASS / ☐ FAIL
```

### D2: Audit Log Shows Contact Changes

```
SETUP:
  1. tail -f ~/.pi/whatsapp-pi/config-audit.log &
  2. Add a contact via /whatsapp
  3. Watch audit log

VERIFY:
  New entry appears with allowListLen increased by 1

[ ] Audit log reflects contact addition     ☐ PASS / ☐ FAIL
```

---

## TEST SUITE E: Connection Lifecycle (P2.3)

### E1: Auto-Connect Works

```
SETUP:
  1. Ensure creds.json exists: ls ~/.pi/whatsapp-pi/auth/creds.json
  2. Start Pi with: pi --whatsapp-pi-online

VERIFY:
  Footer changes: Disconnected → Auto-connecting → Connected ✅
  Time: < 10 seconds

[ ] Auto-connect within 10 seconds         ☐ PASS / ☐ FAIL
[ ] Footer sequence correct                ☐ PASS / ☐ FAIL
```

### E2: Manual Connect After Disconnect

```
SETUP:
  1. /whatsapp → Disconnect WhatsApp
  2. /whatsapp → Connect / Reconnect WhatsApp

VERIFY:
  Footer: Disconnected → Connecting... → Connected
  No QR code appears (credentials exist)

[ ] Reconnect without QR                   ☐ PASS / ☐ FAIL
[ ] Footer sequence correct                ☐ PASS / ☐ FAIL
```

### E3: Logoff + Re-Pair

```
SETUP:
  1. /whatsapp → Logoff (Delete Session)
  2. /whatsapp → Connect / Reconnect WhatsApp
  3. QR code appears → scan with WhatsApp

VERIFY:
  After scanning, footer shows Connected ✅
  creds.json recreated

[ ] Logoff clears credentials              ☐ PASS / ☐ FAIL
[ ] QR appears for re-pair                ☐ PASS / ☐ FAIL
[ ] New session connects successfully      ☐ PASS / ☐ FAIL
```

---

## TEST SUITE F: Message Flow

### F1: Incoming Message from Allowed Contact

```
SETUP:
  1. Add contact to allowed list
  2. Send WhatsApp message from that contact's phone

VERIFY:
  Message appears in Pi TUI: "Message from [Name] (+55...): [text]"
  Pi generates response
  Response arrives on WhatsApp

[ ] Message appears in Pi TUI              ☐ PASS / ☐ FAIL
[ ] Response delivered to WhatsApp         ☐ PASS / ☐ FAIL
```

### F2: Incoming Message from Non-Allowed Contact (BLOCKED)

```
SETUP:
  1. Ensure sender is NOT in allow list
  2. Send WhatsApp message from that sender

VERIFY:
  Message does NOT appear in Pi TUI
  Sender appears in ignored numbers
  No response sent

[ ] Non-allowed message is blocked         ☐ PASS / ☐ FAIL
[ ] Sender appears in ignored list         ☐ PASS / ☐ FAIL
```

### F3: /compact and /abort from WhatsApp

```
SETUP:
  1. From allowed contact, send: /compact
  2. Then send: /abort

VERIFY:
  Pi replies: "Session compacted successfully! ✅"
  Pi replies: "Aborted! ✅"

[ ] /compact works from WhatsApp           ☐ PASS / ☐ FAIL
[ ] /abort works from WhatsApp             ☐ PASS / ☐ FAIL
```

---

## TEST SUITE G: Edge Cases

### G1: Config Recovery from Corruption

```
SETUP:
  1. Stop Pi
  2. Corrupt config.json: echo "garbage" >> ~/.pi/whatsapp-pi/config.json
  3. Start Pi

VERIFY:
  Pi starts normally (config recovered or defaulted)
  /whatsapp-status shows reasonable state

[ ] Pi starts after config corruption      ☐ PASS / ☐ FAIL
```

### G2: Missing Config File

```
SETUP:
  1. Stop Pi
  2. Delete config: rm ~/.pi/whatsapp-pi/config.json
  3. Start Pi

VERIFY:
  Pi starts normally
  /whatsapp-status shows logged-out/disconnected
  New config.json created on first save

[ ] Pi starts without config file          ☐ PASS / ☐ FAIL
[ ] New config created automatically       ☐ PASS / ☐ FAIL
```

### G3: Verbose Mode

```
SETUP:
  1. Start Pi with: pi --whatsapp-pi-online --whatsapp-verbose

VERIFY:
  Baileys debug logs visible in terminal
  /whatsapp-status → Verbose Mode: ON

[ ] Verbose logs visible                   ☐ PASS / ☐ FAIL
[ ] Status shows Verbose: ON               ☐ PASS / ☐ FAIL
```

---

## RESULTS SUMMARY

| Suite | Test | Result |
|-------|------|--------|
| A1 | No contacts = warning | ☐ PASS / ☐ FAIL |
| A2 | 1 contact = Ready ✅ | ☐ PASS / ☐ FAIL |
| A3 | Groups only = warning | ☐ PASS / ☐ FAIL |
| A4 | Bound group = Ready ✅ | ☐ PASS / ☐ FAIL |
| A5 | Disconnected = not ready | ☐ PASS / ☐ FAIL |
| B1 | Contact survives graceful restart | ☐ PASS / ☐ FAIL |
| B2 | Contact survives hard kill | ☐ PASS / ☐ FAIL |
| B3 | 3 rapid additions survive | ☐ PASS / ☐ FAIL |
| B4 | Removal persists | ☐ PASS / ☐ FAIL |
| B5 | Group persists | ☐ PASS / ☐ FAIL |
| C1 | Menu spam doesn't reset | ☐ PASS / ☐ FAIL |
| C2 | /reload safe | ☐ PASS / ☐ FAIL |
| D1 | Audit log writes valid JSON | ☐ PASS / ☐ FAIL |
| D2 | Audit reflects contact changes | ☐ PASS / ☐ FAIL |
| E1 | Auto-connect works | ☐ PASS / ☐ FAIL |
| E2 | Manual reconnect works | ☐ PASS / ☐ FAIL |
| E3 | Logoff + re-pair works | ☐ PASS / ☐ FAIL |
| F1 | Allowed message → response | ☐ PASS / ☐ FAIL |
| F2 | Non-allowed message blocked | ☐ PASS / ☐ FAIL |
| F3 | /compact + /abort from WA | ☐ PASS / ☐ FAIL |
| G1 | Config corruption handling | ☐ PASS / ☐ FAIL |
| G2 | Missing config handling | ☐ PASS / ☐ FAIL |
| G3 | Verbose mode | ☐ PASS / ☐ FAIL |

**Total: 23 manual tests across 7 suites (A-G)**

**Passed: __ / 23**
