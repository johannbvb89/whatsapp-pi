# Manual Test Instruction — WhatsApp-Pi v1.0.59

**State:** Pi not running | `creds.json` ✅ valid | `allowList` empty (0 contacts)  
**You need:** A phone with WhatsApp to send/receive test messages

---

## Step 1: Start Pi with Auto-Connect

Open a terminal and run:

```
cd C:\Users\johan\Pi_Code\PI_Project\whatsapp-pi-fix
pi --whatsapp-pi-online
```

**What to watch for in the first 10 seconds:**

The Pi TUI footer should show this sequence:
```
| WhatsApp: Disconnected        ← initial (split second)
| WhatsApp: Connecting...       ← auto-connect starts
| WhatsApp: Connected           ← connection established ✅
```

If it stays on "Disconnected" or shows "Connection Failed":
→ Run `/whatsapp` → Logoff (Delete Session) → Connect WhatsApp → scan QR code

---

## Step 2: Verify Connection

Type this command in Pi:

```
/whatsapp-status
```

**You should see:**

```
📱 WhatsApp-Pi Status Report
================================
Config Status:      connected
Effective Status:   connected
Socket Active:      ✅ YES
Credentials:        ✅ VALID
Connected Since:    [today's date]
Uptime:             Xs (0m Xs)
```

**If Socket Active shows `❌ NO`:** The config says connected but socket is gone — run Step 1 again.

---

## Step 3: Add Test Contact

You need at least one WhatsApp contact in the allowed list.

### Option A: Let them message you first (EASIEST)

1. Have someone send a WhatsApp message to your connected number
2. Pi will show the message but NOT respond (contact not yet allowed)
3. Type `/whatsapp` → **Recents** → select the new conversation
4. Choose **Allow Contact** (or **Allow Group** if it's a group)
5. Now they're authorized

### Option B: Add manually

1. Type `/whatsapp` → **Allowed Contacts** → **Add Contact**
2. Enter the phone number: `+5511999998888` (international format with + and country code)
3. Contact appears in the list

---

## Step 4: Test Incoming Message

1. From the allowed contact's phone, send: `Hello from WhatsApp test`
2. **In Pi TUI you should see:**
   ```
   Message from [Name] (+55XXXXXXXXXXX): Hello from WhatsApp test
   ```
3. Pi's LLM should generate a response
4. **The response should appear on WhatsApp** on the contact's phone
5. Pi footer should briefly show: "Sent reply to WhatsApp contact"

**If the message appears in Pi but no reply is sent:** Wait ~30s for the LLM to respond. Check Pi footer.

---

## Step 5: Test Image Message

1. From the contact's phone, send a photo
2. **In Pi TUI you should see:**
   ```
   Message from [Name] (+55...): [Image description or placeholder]
   ```
3. LLM should analyze/describe the image

---

## Step 6: Test Commands from WhatsApp

From the contact's phone, send:

```
/compact
```

Pi should reply on WhatsApp: `Session compacted successfully! ✅`

Then send:
```
/abort
```

Pi should reply: `Aborted! ✅`

---

## Step 7: Verify Graceful Shutdown

1. Press `Ctrl+C` in the Pi terminal
2. **You should see in terminal:**
   ```
   [WhatsApp-Pi] Session shutdown detected. Stopping WhatsApp service...
   ```
3. Pi exits cleanly — no crash messages
4. Check log: `tail -5 ~/.pi/whatsapp-pi/whatsapp-pi.log`
   - Last entry should show `Session shutdown`

---

## Pass/Fail Checklist

| # | Test | Expected | Your Result |
|---|------|----------|-------------|
| 1 | Pi starts, footer shows "Connected" | `✅` within 10s | ☐ |
| 2 | `/whatsapp-status` shows Socket Active: YES | `✅` | ☐ |
| 3 | `/whatsapp-status` shows Effective Status: connected | `✅` | ☐ |
| 4 | Incoming text message appears in Pi TUI | `✅` | ☐ |
| 5 | LLM responds and reply arrives on WhatsApp | `✅` | ☐ |
| 6 | Image message reaches Pi | `✅` | ☐ |
| 7 | `/compact` from WhatsApp works | `✅` | ☐ |
| 8 | `/abort` from WhatsApp works | `✅` | ☐ |
| 9 | Ctrl+C shuts down cleanly | `✅` | ☐ |

---

## If Something Fails

| Symptom | Fix |
|---------|-----|
| Footer stays "Disconnected" | Run `/whatsapp` → Logoff → Connect → scan QR |
| Status shows connected but socket NO | Restart Pi — socket dropped |
| Messages not appearing in Pi | Verify contact is added to Allowed Contacts (`/whatsapp` → Allowed Contacts) |
| LLM doesn't respond | Check Pi is not paused; wait for LLM to finish thinking |
| Reply not delivered to WhatsApp | Check `~/.pi/whatsapp-pi/whatsapp-pi.log` for errors |
| Extension doesn't load | Check `~/.pi/agent/settings.json` has `whatsapp-pi-fix` in packages |

---

## Current Known State

- **Allowed Contacts:** 0 (empty) → need to add at least one for testing
- **Credentials:** Valid (`creds.json` exists, `hasAuthState: true`)
- **Operator JID:** Empty → will be set when WhatsApp connects
- **Config status:** `disconnected` → resets to disconnected on restart (expected behavior — `isTransientStatus` logic)
- **Extension source:** Loaded from `C:\Users\johan\Pi_Code\PI_Project\whatsapp-pi-fix` (local, not npm)
