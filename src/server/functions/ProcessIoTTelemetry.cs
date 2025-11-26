namespace functions;

using Atlas.Domain;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using System.Text.Json;

public class ProcessIoTTelemetry
{
    private readonly ILogger<ProcessIoTTelemetry> _logger;
    private readonly Cosmos _cosmos;
    private readonly BroadcastRelay _broadcastRelay;

    public ProcessIoTTelemetry(
        ILogger<ProcessIoTTelemetry> logger,
        Cosmos cosmos,
        BroadcastRelay broadcastRelay)
    {
        _logger = logger;
        _cosmos = cosmos;
        _broadcastRelay = broadcastRelay;
    }

    [Function("ProcessIoTTelemetry")]
    public async Task Run(
        [EventHubTrigger("messages/events", Connection = "IoTHubEventHubConnectionString")] string[] events)
    {
        foreach (var eventData in events)
        {
            try
            {
                _logger.LogInformation("Processing IoT message: {message}", eventData);

                var payload = JsonSerializer.Deserialize<TelemetryPayload>(eventData, new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                });
                if (payload == null)
                {
                    _logger.LogWarning("Failed to deserialize payload");
                    continue;
                }

                _logger.LogInformation(
                    "Deserialized payload - DeviceId: {DeviceId}, Date: {Date}, Shift: '{Shift}', SessionId: {SessionId}, BoxSize: '{BoxSize}', EventType: '{EventType}'",
                    payload.DeviceId,
                    payload.Date,
                    payload.Shift,
                    payload.SessionId,
                    payload.BoxSize,
                    payload.EventType);

                if (!ShiftMetadataRegistry.TryResolve(payload.Shift, out var metadata))
                {
                    _logger.LogWarning("Unknown shift received: '{shift}' (length: {length})", payload.Shift, payload.Shift?.Length ?? 0);
                    continue;
                }

                _logger.LogInformation("Resolved shift metadata: Key={Key}, DisplayName={DisplayName}", metadata.Key, metadata.DisplayName);

                var shiftId = $"shift-{payload.Date}-{metadata.Key}";
                _logger.LogInformation("Looking up shift document: {ShiftId}, Date: {Date}", shiftId, payload.Date);

                var shiftDocument = await _cosmos.GetShiftAsync(shiftId, payload.Date);
                if (shiftDocument == null)
                {
                    _logger.LogInformation("Shift document not found, creating new one: {ShiftId}", shiftId);
                    shiftDocument = ShiftDocument.Create(payload.Date, metadata);
                }
                else
                {
                    _logger.LogInformation(
                        "Found existing shift document: {ShiftId}. Current aggregates S:{Small} M:{Medium} L:{Large} T:{Total}, Sessions: {SessionCount}, ActiveSessionId: {ActiveSessionId}",
                        shiftId,
                        shiftDocument.Aggregates.SmallBoxes,
                        shiftDocument.Aggregates.MediumBoxes,
                        shiftDocument.Aggregates.LargeBoxes,
                        shiftDocument.Aggregates.Total,
                        shiftDocument.Sessions.Count,
                        shiftDocument.ActiveSessionId);
                }
                shiftDocument.EnsureMetadata(metadata);

                var session = shiftDocument.GetActiveSession();
                if (session == null)
                {
                    _logger.LogInformation("No active session found, creating new session for shift {ShiftId}", shiftId);
                    session = shiftDocument.EnsureActiveSession();
                    shiftDocument.Status = ShiftStatus.InProgress;
                }
                else
                {
                    _logger.LogInformation(
                        "Using existing active session {SessionId} for shift {ShiftId}. Current session counters S:{Small} M:{Medium} L:{Large} T:{Total}",
                        session.SessionId,
                        shiftId,
                        session.SmallBoxes,
                        session.MediumBoxes,
                        session.LargeBoxes,
                        session.Total);
                }

                // Actualizar contadores solo si vino una caja
                if (!string.IsNullOrWhiteSpace(payload.BoxSize))
                {
                    _logger.LogInformation(
                        "Incrementing counters for shift {ShiftId}, session {SessionId}. Current S:{Small} M:{Medium} L:{Large}, boxSize:{BoxSize}",
                        shiftId,
                        session.SessionId,
                        session.SmallBoxes,
                        session.MediumBoxes,
                        session.LargeBoxes,
                        payload.BoxSize);

                    switch (payload.BoxSize.ToLowerInvariant())
                    {
                        case "small":
                            session.SmallBoxes++;
                            break;
                        case "medium":
                            session.MediumBoxes++;
                            break;
                        case "large":
                            session.LargeBoxes++;
                            break;
                    }

                    _logger.LogInformation(
                        "Updated counters for shift {ShiftId}, session {SessionId}. New S:{Small} M:{Medium} L:{Large}",
                        shiftId,
                        session.SessionId,
                        session.SmallBoxes,
                        session.MediumBoxes,
                        session.LargeBoxes);
                }

                // Heartbeat/log snapshot for this session
                var log = new ShiftLog
                {
                    Timestamp = payload.Timestamp,
                    IsRunning = payload.IsRunning,
                    EventType = payload.EventType,
                    DeviceId = payload.DeviceId
                };
                session.Logs.Add(log);

                if (!string.IsNullOrEmpty(payload.EventType))
                {
                    session.Events.Add(ShiftEvent.Create(payload.EventType, session.SessionId));

                    if (payload.EventType == "STOP")
                    {
                        session.StoppedAt = payload.Timestamp;
                        shiftDocument.Status = ShiftStatus.Completed;
                        shiftDocument.ActiveSessionId = null;
                    }
                    else if (payload.EventType == "START")
                    {
                        session.StartedAt = payload.Timestamp;
                        shiftDocument.Status = ShiftStatus.InProgress;
                    }
                    else if (payload.EventType == "RESTART")
                    {
                        session.ResetCounters();
                        shiftDocument.Status = ShiftStatus.InProgress;
                    }
                }

                if (!payload.IsRunning && shiftDocument.Status == ShiftStatus.InProgress)
                {
                    shiftDocument.Status = ShiftStatus.Completed;
                }

                shiftDocument.LastUpdated = DateTime.UtcNow;
                shiftDocument.UpdateAggregates();

                _logger.LogInformation(
                    "Before persisting - Shift {ShiftId}: Session counters S:{SessionSmall} M:{SessionMedium} L:{SessionLarge} T:{SessionTotal}, Aggregates S:{AggSmall} M:{AggMedium} L:{AggLarge} T:{AggTotal}",
                    shiftId,
                    session.SmallBoxes,
                    session.MediumBoxes,
                    session.LargeBoxes,
                    session.Total,
                    shiftDocument.Aggregates.SmallBoxes,
                    shiftDocument.Aggregates.MediumBoxes,
                    shiftDocument.Aggregates.LargeBoxes,
                    shiftDocument.Aggregates.Total);

                await _cosmos.UpsertShiftAsync(shiftDocument, payload.Date);
                _logger.LogInformation("Successfully persisted shift {ShiftId} to Cosmos DB", shiftId);

                await _broadcastRelay.BroadcastAsync(payload.Date, metadata.Key, log);
                _logger.LogInformation("Shift processed successfully: {shiftId}", shiftId);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error processing IoT message: {message}", eventData);
            }
        }
    }
}
