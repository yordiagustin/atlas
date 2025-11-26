namespace Atlas.Domain;

public class TelemetryPayload
{
    public string DeviceId { get; set; } = string.Empty;
    public string Fecha { get; set; } = string.Empty;
    public string Turno { get; set; } = string.Empty;
    public string? SessionId { get; set; }
    public int CountersSmall { get; set; }
    public int CountersMedium { get; set; }
    public int CountersLarge { get; set; }
    public bool IsRunning { get; set; }
    public string? Evento { get; set; }
    public DateTime Timestamp { get; set; }
}

