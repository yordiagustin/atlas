namespace functions;

using Newtonsoft.Json;

public class ShiftDocument
{
    [JsonProperty("id")]
    public string Id { get; set; } = string.Empty;              // "shift-2025-11-25-manana"
    [JsonProperty("type")]
    public string Type { get; set; } = "shift";
    public string Name { get; set; } = string.Empty;            // "Morning" | "Afternoon" | "Night"
    public string Date { get; set; } = string.Empty;            // "2025-11-25"
    public string StartTime { get; set; } = string.Empty;       // "06:00:00"
    public string EndTime { get; set; } = string.Empty;         // "14:00:00"
    public int SmallBoxes { get; set; }
    public int MediumBoxes { get; set; }
    public int LargeBoxes { get; set; }
    public int Total { get; set; }
    public string Status { get; set; } = "IN_PROGRESS";         // "IN_PROGRESS" | "COMPLETED"
    public List<ShiftEvent> Events { get; set; } = new();
    public DateTime CreatedAt { get; set; }
    public DateTime LastUpdated { get; set; }

    [JsonProperty("_partitionKey")]
    public string PartitionKey { get; set; } = string.Empty;    // Date for efficient queries
}

public class ShiftEvent
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Type { get; set; } = string.Empty;            // "START" | "STOP" | "RESTART"
    public DateTime Timestamp { get; set; }
}
