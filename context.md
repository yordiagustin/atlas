## Business Logic Overview

### Core Entities
- **Shift (DayShift)**  
  - Identified by `date (yyyy-MM-dd)` + `name` (`morning`, `afternoon`, `night`).  
  - Represents the manual selection the supervisor makes at the beginning of every working period.  
  - Stores aggregated counters (small/medium/large/total), current status (`IN_PROGRESS` / `COMPLETED`) and an ordered list of **sessions**.

- **Session**  
  - Created each time an operator presses **Start** for the active shift.  
  - Tracks `sessionId`, `startedAt`, optional `stoppedAt`, live production counters and control events (`START`, `STOP`, `RESTART`).  
  - A shift may have multiple sessions in the same day; sessions are appended sequentially.

- **Telemetry Event**  
  - Produced by the ESP32 → IoT Hub → Azure Function pipeline.  
  - Contains live box counts and machine status, always associated with the active shift + session.


### End-to-End Flow
1. **Shift activation (Start button in SPA)**
   - User selects `morning | afternoon | night` and presses **Start**.
   - The API creates (or loads) the shift document for `date + shiftName`.
   - A new session object is appended with zeroed counters, `status = RUNNING`.
   - API sends `START` command to IoT Hub (`atlas-esp32`) so the conveyor begins and the ESP32 starts streaming telemetry.  
   - The SPA opens the websocket/SignalR channel (future work) to receive real-time increments.

2. **Live telemetry ingestion**
   - ESP32 publishes production data to IoT Hub.
   - Azure Function `ProcessIoTTelemetry` consumes the event, looks up the active shift/session (`classifier-db / shifts` container) and increments the counters inside the latest session and the aggregated shift totals.
   - The `ShiftDocument` is upserted after each telemetry batch so the API can expose current numbers (e.g., `/api/production/current`).

3. **Stop button**
   - Operator presses **Stop** when the shift must pause.  
   - API sends `STOP` to IoT Hub (machine pauses) and marks `stoppedAt` plus final counters for the current session.  
   - Shift `status` becomes `COMPLETED` if no future session is pending; otherwise it stays `IN_PROGRESS` waiting for the next Start.

4. **Restart button (last-resort)**
   - Sends `RESTART` command and resets the active session counters to zero while keeping the session open.  
   - Also logged as a control event in the session history.

5. **Shift reactivation (same day)**
   - If the user presses **Start** again on the same shift/day, a **new session** is appended, restarting counts from zero but preserving the previous sessions in the document.  
   - Control history therefore reflects: Start → Stop → Start → Stop, etc., all under the same shift document.

6. **Reporting**
   - `/api/production/current` reads the latest session of today’s shift to populate the dashboard.
   - `/api/production/daily?date=YYYY-MM-DD` aggregates the sessions for each shift in that date for reporting.
   - `/api/events` exposes the control events (START/STOP/RESTART) stored per session.


### Cosmos DB Shape (`classifier-db / shifts`)
```jsonc
{
  "id": "shift-2025-11-26-morning",
  "partitionKey": "2025-11-26",
  "type": "shift",
  "name": "morning",
  "date": "2025-11-26",
  "status": "IN_PROGRESS",
  "aggregates": {
    "smallBoxes": 120,
    "mediumBoxes": 45,
    "largeBoxes": 18,
    "total": 183
  },
  "sessions": [
    {
      "sessionId": "session-01",
      "startedAt": "2025-11-26T06:05:00Z",
      "stoppedAt": "2025-11-26T08:10:00Z",
      "smallBoxes": 60,
      "mediumBoxes": 20,
      "largeBoxes": 5,
      "events": [
        {"type": "START", "timestamp": "..."},
        {"type": "STOP", "timestamp": "..."}
      ]
    },
    {
      "sessionId": "session-02",
      "startedAt": "2025-11-26T09:00:00Z",
      "stoppedAt": null,
      "smallBoxes": 60,
      "mediumBoxes": 25,
      "largeBoxes": 13,
      "events": [
        {"type": "START", "timestamp": "..."},
        {"type": "RESTART", "timestamp": "..."}
      ]
    }
  ]
}
```


### Responsibilities per Component
- **Azure Functions (`src/server/functions`)**
  - Translate IoT telemetry into Cosmos updates (increments per active session).
  - Ensure shift/session documents are created when telemetry arrives for a brand-new shift.

- **.NET API (`src/server/api`)**
  - Control plane for the operators (Start/Stop/Restart/Shift select).  
  - Serves dashboard data (`status`, `current production`, `daily production`, `events`).  
  - Sends commands to IoT Hub and orchestrates session lifecycle in Cosmos.

- **React SPA (`src/client`)**
  - UI for operators to select shift, start/stop sessions, visualize live counts and review events/reports.
  - Polls `/api/status` + `/api/production/current` and will subscribe to websocket updates in future iterations.

Use this context to keep backend/services aligned whenever we extend data models or endpoints.

