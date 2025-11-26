namespace Atlas.Domain;

using System.Diagnostics.CodeAnalysis;
using System.Linq;
using Newtonsoft.Json;

public static class ShiftStatus
{
    public const string NotStarted = "NOT_STARTED";
    public const string InProgress = "IN_PROGRESS";
    public const string Completed = "COMPLETED";
}

public record ShiftMetadata(string Key, string DisplayName, string ControlValue, string StartTime, string EndTime);

public static class ShiftMetadataRegistry
{
    private static readonly Dictionary<string, ShiftMetadata> Definitions = new(StringComparer.OrdinalIgnoreCase)
    {
        ["manana"] = new("manana", "Morning", "manana", "06:00:00", "14:00:00"),
        ["morning"] = new("manana", "Morning", "manana", "06:00:00", "14:00:00"),
        ["tarde"] = new("tarde", "Afternoon", "tarde", "14:00:00", "22:00:00"),
        ["afternoon"] = new("tarde", "Afternoon", "tarde", "14:00:00", "22:00:00"),
        ["noche"] = new("noche", "Night", "noche", "22:00:00", "06:00:00"),
        ["night"] = new("noche", "Night", "noche", "22:00:00", "06:00:00")
    };

    public static bool TryResolve(string? value, [NotNullWhen(true)] out ShiftMetadata? metadata)
    {
        if (!string.IsNullOrWhiteSpace(value) && Definitions.TryGetValue(value.Trim(), out metadata))
        {
            return true;
        }

        metadata = null;
        return false;
    }
}

public class ShiftDocument
{
    [JsonProperty("id")]
    public string Id { get; set; } = string.Empty;

    [JsonProperty("type")]
    public string Type { get; set; } = "shift";

    public string ShiftKey { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Date { get; set; } = string.Empty;
    public string StartTime { get; set; } = string.Empty;
    public string EndTime { get; set; } = string.Empty;
    public string Status { get; set; } = ShiftStatus.NotStarted;
    public string? ActiveSessionId { get; set; }

    public ShiftAggregates Aggregates { get; set; } = new();
    public List<ShiftSession> Sessions { get; set; } = new();
    public DateTime CreatedAt { get; set; }
    public DateTime LastUpdated { get; set; }

    [JsonProperty("_partitionKey")]
    public string PartitionKey { get; set; } = string.Empty;

    public static ShiftDocument Create(string date, ShiftMetadata metadata)
    {
        return new ShiftDocument
        {
            Id = $"shift-{date}-{metadata.Key}",
            ShiftKey = metadata.Key,
            Name = metadata.DisplayName,
            Date = date,
            StartTime = metadata.StartTime,
            EndTime = metadata.EndTime,
            PartitionKey = date,
            Status = ShiftStatus.NotStarted,
            CreatedAt = DateTime.UtcNow,
            LastUpdated = DateTime.UtcNow
        };
    }

    public void EnsureMetadata(ShiftMetadata metadata)
    {
        ShiftKey = metadata.Key;
        Name = metadata.DisplayName;
        StartTime = metadata.StartTime;
        EndTime = metadata.EndTime;
    }

    public ShiftSession StartNewSession()
    {
        var session = new ShiftSession
        {
            SessionId = Guid.NewGuid().ToString("N"),
            StartedAt = DateTime.UtcNow
        };

        Sessions.Add(session);
        ActiveSessionId = session.SessionId;
        return session;
    }

    public ShiftSession EnsureActiveSession()
    {
        var session = GetActiveSession();
        if (session != null)
        {
            return session;
        }

        session = new ShiftSession
        {
            SessionId = Guid.NewGuid().ToString("N"),
            StartedAt = DateTime.UtcNow
        };

        Sessions.Add(session);
        ActiveSessionId = session.SessionId;
        return session;
    }

    public ShiftSession? GetActiveSession()
    {
        if (string.IsNullOrEmpty(ActiveSessionId))
        {
            return null;
        }

        return Sessions.FirstOrDefault(s => s.SessionId == ActiveSessionId);
    }

    public void UpdateAggregates()
    {
        Aggregates.SmallBoxes = Sessions.Sum(s => s.SmallBoxes);
        Aggregates.MediumBoxes = Sessions.Sum(s => s.MediumBoxes);
        Aggregates.LargeBoxes = Sessions.Sum(s => s.LargeBoxes);
        Aggregates.Total = Sessions.Sum(s => s.Total);
    }
}

public class ShiftSession
{
    public string SessionId { get; set; } = Guid.NewGuid().ToString("N");
    public DateTime StartedAt { get; set; }
    public DateTime? StoppedAt { get; set; }

    public int SmallBoxes { get; set; }
    public int MediumBoxes { get; set; }
    public int LargeBoxes { get; set; }
    public int Total => SmallBoxes + MediumBoxes + LargeBoxes;

    public List<ShiftEvent> Events { get; set; } = new();
    public List<ShiftLog> Logs { get; set; } = new();

    public void ResetCounters()
    {
        SmallBoxes = 0;
        MediumBoxes = 0;
        LargeBoxes = 0;
    }

    public void AddEvent(string type)
    {
        Events.Add(ShiftEvent.Create(type, SessionId));
    }
}

public class ShiftEvent
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Type { get; set; } = string.Empty;
    public string? SessionId { get; set; }
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;

    public static ShiftEvent Create(string type, string? sessionId = null) => new()
    {
        Type = type,
        SessionId = sessionId,
        Timestamp = DateTime.UtcNow
    };
}

public class ShiftAggregates
{
    public int SmallBoxes { get; set; }
    public int MediumBoxes { get; set; }
    public int LargeBoxes { get; set; }
    public int Total { get; set; }
}

public class ShiftLog
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
    public bool IsRunning { get; set; }
    public string? EventType { get; set; }
    public string? DeviceId { get; set; }
}

