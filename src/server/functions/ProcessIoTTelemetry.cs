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

                var payload = JsonSerializer.Deserialize<TelemetryPayload>(eventData);
                if (payload == null)
                {
                    _logger.LogWarning("Failed to deserialize payload");
                    continue;
                }

                if (!ShiftMetadataRegistry.TryResolve(payload.Turno, out var metadata))
                {
                    _logger.LogWarning("Unknown shift received: {turno}", payload.Turno);
                    continue;
                }

                var shiftId = $"shift-{payload.Fecha}-{metadata.Key}";
                var shiftDocument = await _cosmos.GetShiftAsync(shiftId, payload.Fecha)
                    ?? ShiftDocument.Create(payload.Fecha, metadata);
                shiftDocument.EnsureMetadata(metadata);

                var session = shiftDocument.GetActiveSession();
                if (session == null)
                {
                    session = shiftDocument.EnsureActiveSession();
                    shiftDocument.Status = ShiftStatus.InProgress;
                }

                session.SmallBoxes = payload.CountersSmall;
                session.MediumBoxes = payload.CountersMedium;
                session.LargeBoxes = payload.CountersLarge;

                if (!string.IsNullOrEmpty(payload.Evento))
                {
                    session.Events.Add(ShiftEvent.Create(payload.Evento, session.SessionId));
                    shiftDocument.Events.Add(ShiftEvent.Create(payload.Evento, session.SessionId));

                    if (payload.Evento == "STOP")
                    {
                        session.StoppedAt = payload.Timestamp;
                        shiftDocument.Status = ShiftStatus.Completed;
                        shiftDocument.ActiveSessionId = null;
                    }
                    else if (payload.Evento == "START")
                    {
                        session.StartedAt = payload.Timestamp;
                        shiftDocument.Status = ShiftStatus.InProgress;
                    }
                    else if (payload.Evento == "RESTART")
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

                await _cosmos.UpsertShiftAsync(shiftDocument, payload.Fecha);
                await _broadcastRelay.BroadcastAsync(ProductionResponse.FromShift(shiftDocument));

                _logger.LogInformation("Shift processed successfully: {shiftId}", shiftId);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error processing IoT message: {message}", eventData);
            }
        }
    }
}
