# Data Model: Auto-Reconnect on Unexpected Disconnect

## Runtime State: WhatsAppService

This feature introduces one new ephemeral field on `WhatsAppService`. No persistent storage changes.

### New Field

- **`intentionalStop: boolean`** — Tracks whether the current disconnected state was triggered deliberately by the user. Defaults to `false`.

### State Transitions

| Trigger | `intentionalStop` value |
|---------|------------------------|
| Service starts / instantiated | `false` |
| User calls `start()` (Connect WhatsApp) | `false` (cleared) |
| User calls `stop()` (Disconnect WhatsApp menu) | `true` (set) |
| User calls `logout()` (Logoff / Delete Session menu) | `true` (set) |
| Process restarts | `false` (not persisted) |

### Validation Rules

- When `intentionalStop` is `true`, `handleConnectionClosed` MUST skip scheduling a reconnect.
- When `intentionalStop` is `true`, the reconnect timer callback MUST abort before calling `start()`.
- `intentionalStop` is reset to `false` before any user-initiated connection attempt regardless of previous state.

## No Persistent Storage Changes

- `config.json` — unchanged.
- Auth state files — unchanged.
- `recents.json` — unchanged.

## Conceptual Entities (unchanged)

- **User-Initiated Stop**: now formally modelled via `intentionalStop = true`.
- **Unexpected Disconnect**: any close event where `intentionalStop = false` and the Baileys status code does not indicate auth rejection.
