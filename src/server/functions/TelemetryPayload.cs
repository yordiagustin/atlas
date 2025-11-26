namespace functions;

public class TelemetryPayload
{
    public string DeviceId { get; set; } = string.Empty;
    public string Fecha { get; set; } = string.Empty;           // Date in format "2025-11-25"
    public string Turno { get; set; } = string.Empty;           // Shift: "manana" | "tarde" | "noche"
    public int CountersSmall { get; set; }
    public int CountersMedium { get; set; }
    public int CountersLarge { get; set; }
    public bool IsRunning { get; set; }
    public string? Evento { get; set; }                         // Event: null, "START", "STOP", "RESTART"
    public DateTime Timestamp { get; set; }
}
