namespace Atlas.Domain;

public class TelemetryPayload
{
    public string DeviceId { get; set; } = string.Empty;
    public string Fecha { get; set; } = string.Empty;
    public string Turno { get; set; } = string.Empty;
    public string? SessionId { get; set; }
    public string BoxSize { get; set; } = string.Empty; // "small" | "medium" | "large"
    public bool IsRunning { get; set; }
    public string? Evento { get; set; }
    public DateTime Timestamp { get; set; }
}

