# Feature Specification: Auto-Reconnect on Unexpected Disconnect

**Feature Branch**: `029-auto-reconnect`  
**Created**: 2026-05-15  
**Status**: Draft  
**Input**: User description: "I'd like to reconnect if, for some reason, WhatsApp disconnects. Only ignore this when the user disconnects or deletes authentication in the /whatsapp menu."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Automatic Recovery from Unexpected Disconnect (Priority: P1)

As a user with an active WhatsApp session, I want the agent to automatically reconnect when the connection drops unexpectedly so I never have to manually intervene for network or server-side interruptions.

**Why this priority**: This is the core value of the feature and directly affects the agent's reliability during normal use.

**Independent Test**: Simulate an unexpected network interruption while the agent is connected, then verify the agent automatically re-establishes the WhatsApp connection within a reasonable time without user action.

**Acceptance Scenarios**:

1. **Given** the agent is connected, **When** the WhatsApp connection drops due to a network error or server-side issue, **Then** the agent automatically attempts to reconnect without user action.
2. **Given** the agent is attempting to reconnect, **When** the reconnection succeeds, **Then** the agent resumes normal operation and the status reflects a connected state.
3. **Given** the agent is attempting to reconnect, **When** repeated reconnection attempts fail over time, **Then** the agent continues retrying with increasing intervals and does not crash or freeze.

---

### User Story 2 - No Reconnect After Manual Disconnect (Priority: P1)

As a user who has intentionally chosen to disconnect WhatsApp from the `/whatsapp` menu, I want the agent to stay disconnected so my explicit choice is respected.

**Why this priority**: Without this, the auto-reconnect feature would undo the user's intentional action and could be confusing or disruptive.

**Independent Test**: Click "Disconnect WhatsApp" in the `/whatsapp` menu and confirm that the agent does not attempt to reconnect automatically afterward.

**Acceptance Scenarios**:

1. **Given** the agent is connected, **When** the user selects "Disconnect WhatsApp" in the `/whatsapp` menu, **Then** the agent disconnects and does not attempt to reconnect automatically.
2. **Given** the agent was manually disconnected, **When** the user later selects "Connect WhatsApp" in the menu, **Then** the agent connects normally, re-enabling future auto-reconnect behavior for unexpected drops.

---

### User Story 3 - No Reconnect After Deleting Authentication (Priority: P1)

As a user who has deleted their WhatsApp session from the `/whatsapp` menu, I want the agent to stay disconnected and not try to reconnect so the deleted credentials are not reused.

**Why this priority**: Reconnecting after auth deletion would be a security and usability regression — the user's intent is to fully remove the session.

**Independent Test**: Use "Logoff / Delete Session" in the `/whatsapp` menu and verify the agent does not attempt to reconnect automatically.

**Acceptance Scenarios**:

1. **Given** the agent is connected, **When** the user selects "Logoff / Delete Session" and confirms, **Then** the agent logs out, removes authentication, and does not attempt to reconnect automatically.
2. **Given** authentication has been deleted, **When** the agent would otherwise trigger reconnect logic, **Then** it skips reconnection and remains in a disconnected state.

---

### Edge Cases

- Connection drops during an active reconnect attempt: the agent does not spawn duplicate reconnect processes.
- The agent is started with `--whatsapp-pi-online` flag and the connection drops: auto-reconnect still applies as the user has not explicitly disconnected.
- A session is invalidated server-side (e.g., logged out from WhatsApp on another device): the agent detects auth rejection and does not auto-reconnect (treats it as an auth-related stop, not an unexpected drop).
- The agent restarts from scratch while in a manually-stopped state: the stopped state is not persisted across restarts, so the agent does not auto-connect on startup unless the `--whatsapp-pi-online` flag is used.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST automatically attempt to reconnect when the WhatsApp connection closes for any reason other than a user-initiated disconnect or an authentication deletion.
- **FR-002**: The system MUST NOT attempt to reconnect when the user has explicitly disconnected via the "Disconnect WhatsApp" option in the `/whatsapp` menu.
- **FR-003**: The system MUST NOT attempt to reconnect when the user has deleted authentication via the "Logoff / Delete Session" option in the `/whatsapp` menu.
- **FR-004**: The system MUST NOT attempt to reconnect when WhatsApp rejects the session due to authentication failure (e.g., logged out from another device, bad session).
- **FR-005**: When the user manually connects after a prior manual disconnect, the system MUST re-enable auto-reconnect behavior for future unexpected drops.
- **FR-006**: The system MUST ensure that only one reconnect attempt is active at any given time — duplicate reconnect processes are not allowed.
- **FR-007**: The system MUST use increasing retry intervals between consecutive reconnect attempts to avoid excessive reconnect churn.
- **FR-008**: The system MUST update the status indicator to reflect that a reconnect is in progress.

### Key Entities *(include if feature involves data)*

- **User-Initiated Stop**: A deliberate action taken by the user via the `/whatsapp` menu to disconnect or delete authentication.
- **Unexpected Disconnect**: A connection close that was not triggered by the user — caused by network failure, server-side closure, or timeout.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of unexpected disconnects trigger an automatic reconnect attempt without user intervention.
- **SC-002**: 0 automatic reconnect attempts occur after the user explicitly disconnects or deletes authentication via the `/whatsapp` menu.
- **SC-003**: At most one reconnect process is active at any time — no duplicate reconnect loops.
- **SC-004**: After a successful reconnect, the agent processes incoming messages as normal with no manual restart required.
- **SC-005**: After a user manually disconnects and then manually reconnects, the agent correctly resumes auto-reconnect behavior for subsequent unexpected drops.

## Assumptions

- The `/whatsapp` menu is the only surface through which users intentionally disconnect or delete authentication.
- A session invalidated server-side (auth rejection) is treated the same as a user-initiated removal and does not trigger auto-reconnect.
- The existing exponential backoff mechanism for reconnect delays is acceptable and does not need to change.
- Auto-reconnect state does not need to be persisted across process restarts; on restart, the agent follows the existing startup behavior (manual connect or `--whatsapp-pi-online` flag).
