namespace Atlas.Domain;

public class ProductionResponse
{
    public string ShiftKey { get; set; } = "none";
    public string ShiftName { get; set; } = "None";
    public string? SessionId { get; set; }
    public DateTime? SessionStartedAt { get; set; }
    public DateTime? SessionStoppedAt { get; set; }
    public bool IsRunning { get; set; }
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;

    public int SmallBoxes { get; set; }
    public int MediumBoxes { get; set; }
    public int LargeBoxes { get; set; }
    public int Total { get; set; }

    public static ProductionResponse FromShift(ShiftDocument? shift)
    {
        if (shift == null)
        {
            return new ProductionResponse();
        }

        var session = shift.GetActiveSession() ?? shift.Sessions.LastOrDefault();
        return new ProductionResponse
        {
            ShiftKey = shift.ShiftKey,
            ShiftName = shift.Name,
            SessionId = session?.SessionId,
            SessionStartedAt = session?.StartedAt,
            SessionStoppedAt = session?.StoppedAt,
            IsRunning = shift.Status == ShiftStatus.InProgress,
            Timestamp = DateTime.UtcNow,
            SmallBoxes = session?.SmallBoxes ?? 0,
            MediumBoxes = session?.MediumBoxes ?? 0,
            LargeBoxes = session?.LargeBoxes ?? 0,
            Total = session?.Total ?? 0
        };
    }
}

public class ShiftReportDto
{
    public string Name { get; set; } = string.Empty;
    public string ShiftKey { get; set; } = string.Empty;
    public int SmallBoxes { get; set; }
    public int MediumBoxes { get; set; }
    public int LargeBoxes { get; set; }
    public int Total { get; set; }
    public List<ShiftSession> Sessions { get; set; } = new();

    public static ShiftReportDto FromDocument(ShiftDocument doc) => new()
    {
        Name = doc.Name,
        ShiftKey = doc.ShiftKey,
        SmallBoxes = doc.Aggregates.SmallBoxes,
        MediumBoxes = doc.Aggregates.MediumBoxes,
        LargeBoxes = doc.Aggregates.LargeBoxes,
        Total = doc.Aggregates.Total,
        Sessions = doc.Sessions
    };
}

