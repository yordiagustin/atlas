namespace functions;

using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using System.Text.Json;

public class ProcessIoTTelemetry
{
    private readonly ILogger<ProcessIoTTelemetry> _logger;
    private readonly CosmosService _cosmosService;

    public ProcessIoTTelemetry(
        ILogger<ProcessIoTTelemetry> logger,
        CosmosService cosmosService)
    {
        _logger = logger;
        _cosmosService = cosmosService;
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

                // Deserialize telemetry payload
                var payload = JsonSerializer.Deserialize<TelemetryPayload>(eventData);
                if (payload == null)
                {
                    _logger.LogWarning("Failed to deserialize payload");
                    continue;
                }

                // Build shift ID: "shift-{date}-{shift}"
                var shiftId = $"shift-{payload.Fecha}-{payload.Turno}";

                // Try to get existing shift from Cosmos
                var shiftDocument = await _cosmosService.GetShiftAsync(shiftId, payload.Fecha);

                if (shiftDocument == null)
                {
                    // Create new shift document
                    shiftDocument = CreateNewShift(payload, shiftId);

                    // Add START event if present
                    if (!string.IsNullOrEmpty(payload.Evento) && payload.Evento == "START")
                    {
                        shiftDocument.Events.Add(new ShiftEvent
                        {
                            Id = Guid.NewGuid().ToString(),
                            Type = payload.Evento,
                            Timestamp = payload.Timestamp
                        });
                    }

                    _logger.LogInformation("Creating new shift: {shiftId}", shiftId);
                }
                else
                {
                    // Update counters
                    shiftDocument.SmallBoxes = payload.CountersSmall;
                    shiftDocument.MediumBoxes = payload.CountersMedium;
                    shiftDocument.LargeBoxes = payload.CountersLarge;
                    shiftDocument.Total = payload.CountersSmall + payload.CountersMedium + payload.CountersLarge;
                    shiftDocument.LastUpdated = DateTime.UtcNow;

                    // Add event if present
                    if (!string.IsNullOrEmpty(payload.Evento))
                    {
                        shiftDocument.Events.Add(new ShiftEvent
                        {
                            Id = Guid.NewGuid().ToString(),
                            Type = payload.Evento,
                            Timestamp = payload.Timestamp
                        });
                    }

                    _logger.LogInformation("Updating shift: {shiftId}", shiftId);
                }

                // Update status based on IsRunning
                shiftDocument.Status = payload.IsRunning ? "IN_PROGRESS" : "COMPLETED";

                // Save to Cosmos
                await _cosmosService.UpsertShiftAsync(shiftDocument, payload.Fecha);

                _logger.LogInformation(
                    "Shift processed successfully: {shiftId}, Total boxes: {total}",
                    shiftId,
                    shiftDocument.Total);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error processing IoT message: {message}", eventData);
            }
        }
    }

    private ShiftDocument CreateNewShift(TelemetryPayload payload, string shiftId)
    {
        var (shiftName, startTime, endTime) = GetShiftInfo(payload.Turno);

        return new ShiftDocument
        {
            Id = shiftId,
            Type = "shift",
            Name = shiftName,
            Date = payload.Fecha,
            StartTime = startTime,
            EndTime = endTime,
            SmallBoxes = payload.CountersSmall,
            MediumBoxes = payload.CountersMedium,
            LargeBoxes = payload.CountersLarge,
            Total = payload.CountersSmall + payload.CountersMedium + payload.CountersLarge,
            Status = payload.IsRunning ? "IN_PROGRESS" : "COMPLETED",
            Events = new List<ShiftEvent>(),
            CreatedAt = DateTime.UtcNow,
            LastUpdated = DateTime.UtcNow,
            PartitionKey = payload.Fecha
        };
    }

    private (string name, string startTime, string endTime) GetShiftInfo(string turno)
    {
        return turno.ToLower() switch
        {
            "manana" => ("Morning", "06:00:00", "14:00:00"),
            "tarde" => ("Afternoon", "14:00:00", "22:00:00"),
            "noche" => ("Night", "22:00:00", "06:00:00"),
            _ => ("Unknown", "00:00:00", "00:00:00")
        };
    }
}
