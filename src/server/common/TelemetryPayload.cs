namespace Atlas.Domain;

/// <summary>
/// Telemetry payload coming from the device / simulator.
/// All property names are English; JSON will use the same names (case-insensitive).
/// </summary>
public class TelemetryPayload
{
    public string DeviceId { get; set; } = string.Empty;
    public string Date { get; set; } = string.Empty;
    public string Shift { get; set; } = string.Empty;
    public string? SessionId { get; set; }
    public string BoxSize { get; set; } = string.Empty; // "small" | "medium" | "large"
    public bool IsRunning { get; set; }
    public string? EventType { get; set; }
    public DateTime Timestamp { get; set; }
}

