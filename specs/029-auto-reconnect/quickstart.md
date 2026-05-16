# Quickstart: Auto-Reconnect on Unexpected Disconnect

## Goal

Validate that the agent automatically reconnects after unexpected WhatsApp drops, and stays disconnected after deliberate user actions.

## Scenario A — Unexpected Disconnect Triggers Auto-Reconnect

1. Connect WhatsApp via the `/whatsapp` menu ("Connect WhatsApp").
2. Confirm the status bar shows `| WhatsApp: Connected`.
3. Simulate a network interruption (disable Wi-Fi or block the process's network access briefly).
4. Observe the status bar updates to `| WhatsApp: Reconnecting...` within seconds.
5. Re-enable network access.
6. Confirm the status bar returns to `| WhatsApp: Connected` automatically, without any user action.

## Scenario B — Manual Disconnect Prevents Auto-Reconnect

1. Connect WhatsApp.
2. Open the `/whatsapp` menu and select "Disconnect WhatsApp".
3. Confirm the status bar shows `| WhatsApp: Disconnected`.
4. Wait at least 30 seconds.
5. Confirm the status bar does NOT change to `| WhatsApp: Reconnecting...`.
6. Confirm no new socket connection appears in verbose logs.

## Scenario C — Logoff / Delete Session Prevents Auto-Reconnect

1. Connect WhatsApp.
2. Open the `/whatsapp` menu and select "Logoff / Delete Session", then confirm.
3. Confirm the status bar shows `| WhatsApp: Disconnected`.
4. Wait at least 30 seconds.
5. Confirm the status bar does NOT change to `| WhatsApp: Reconnecting...`.

## Scenario D — Re-enabling Auto-Reconnect After Manual Disconnect

1. Follow Scenario B to reach a manual disconnect state.
2. Open the `/whatsapp` menu and select "Connect WhatsApp".
3. Confirm the agent connects successfully.
4. Simulate a network interruption.
5. Confirm the agent auto-reconnects (Scenario A behaviour is restored).

## Verification

- Auto-reconnect fires within 5 seconds of an unexpected drop.
- No reconnect attempt occurs after "Disconnect WhatsApp" or "Logoff / Delete Session".
- After manual reconnect, auto-reconnect resumes for future drops.
- Reconnect delays increase on repeated failures (5s → 10s → 20s → …, cap 120s).
