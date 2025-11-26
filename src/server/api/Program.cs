using System.Collections.Concurrent;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.Json;
using Atlas.Domain;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Azure.Cosmos;
using Microsoft.Azure.Devices;
using Microsoft.Extensions.Options;
using Newtonsoft.Json;
using JsonSerializer = System.Text.Json.JsonSerializer;

var builder = WebApplication.CreateBuilder(args);

const string DatabaseName = "classifier-db";
const string ContainerName = "shifts";

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowReactSPA", policy =>
    {
        // Academic/demo setup: allow any origin + credentials so SignalR can negotiate
        policy
            .SetIsOriginAllowed(_ => true)
            .AllowAnyMethod()
            .AllowAnyHeader()
            .AllowCredentials();
    });
});

builder.Services.AddSingleton(sp =>
{
    var connectionString = builder.Configuration["CosmosDbConnectionString"];
    if (string.IsNullOrEmpty(connectionString))
        throw new InvalidOperationException("CosmosDbConnectionString is not configured");

    return new CosmosClient(connectionString);
});

builder.Services.AddSingleton(sp =>
{
    var connectionString = builder.Configuration["IoTHubConnectionString"];
    if (string.IsNullOrEmpty(connectionString))
        throw new InvalidOperationException("IoTHubConnectionString is not configured");

    return ServiceClient.CreateFromConnectionString(connectionString);
});

builder.Services.AddSingleton<ShiftStore>(sp =>
{
    var cosmosClient = sp.GetRequiredService<CosmosClient>();
    return new ShiftStore(cosmosClient, DatabaseName, ContainerName);
});

builder.Services.AddSignalR();
builder.Services.Configure<BroadcastOptions>(builder.Configuration.GetSection("Broadcast"));

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors("AllowReactSPA");

app.MapHub<DashboardHub>("/hubs/dashboard");

app.MapPost("/api/internal/production/broadcast", async (
    BroadcastNotification notification,
    HttpContext context,
    ShiftStore store,
    IHubContext<DashboardHub> hub,
    IOptions<BroadcastOptions> options) =>
{
    if (!IsAuthorized(context, options.Value))
    {
        return Results.StatusCode((int)HttpStatusCode.Unauthorized);
    }

    var shift = await store.GetShiftAsync(notification.Date, notification.ShiftKey);
    var snapshot = ProductionResponse.FromShift(shift);

    await hub.Clients.All.SendAsync("snapshot", snapshot);
    if (notification.Log is not null)
    {
        await hub.Clients.All.SendAsync("log", notification.Log);
    }

    return Results.Accepted();
});

app.MapGet("/api/status", async (ShiftStore store) =>
{
    var today = DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd");
    var shift = await store.GetLatestShiftAsync(today);
    var snapshot = ProductionResponse.FromShift(shift);
    return Results.Ok(new StatusResponse
    {
        IsRunning = snapshot.IsRunning,
        ActiveShift = snapshot.ShiftName,
        ShiftKey = snapshot.ShiftKey,
        Timestamp = snapshot.Timestamp
    });
}).WithName("GetStatus");

app.MapGet("/api/production/current", async (ShiftStore store) =>
{
    var today = DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd");
    var shift = await store.GetLatestShiftAsync(today);
    var snapshot = ProductionResponse.FromShift(shift);
    return Results.Ok(snapshot);
}).WithName("GetCurrentProduction");

app.MapGet("/api/production/daily", async (string date, ShiftStore store) =>
{
    var shifts = await store.GetShiftsByDateAsync(date);
    var reports = shifts.Select(ShiftReportDto.FromDocument);
    return Results.Ok(reports);
}).WithName("GetDailyProduction");

app.MapGet("/api/events", async (string date, string shift, ShiftStore store) =>
{
    var doc = await store.GetShiftAsync(date, shift);
    if (doc == null)
    {
        return Results.NotFound(new { error = "Shift not found" });
    }

    var events = doc.Sessions
        .SelectMany(s => s.Events.Select(e => new
        {
            e.Id,
            e.Type,
            e.Timestamp,
            SessionId = s.SessionId
        }));

    return Results.Ok(events);
}).WithName("GetEvents");

app.MapGet("/api/logs", async (string date, string shift, ShiftStore store) =>
{
    var doc = await store.GetShiftAsync(date, shift);
    if (doc == null)
    {
        return Results.NotFound(new { error = "Shift not found" });
    }

    var logs = doc.Sessions
        .SelectMany(s => s.Logs.Select(l => new
        {
            l.Id,
            l.Timestamp,
            l.IsRunning,
            l.EventType,
            l.DeviceId,
            SessionId = s.SessionId
        }))
        .OrderBy(l => l.Timestamp);

    return Results.Ok(logs);
}).WithName("GetLogs");

app.MapPost("/api/control/start", async (
    ControlRequest request,
    ShiftStore store,
    ServiceClient serviceClient,
    IHubContext<DashboardHub> hub) =>
{
    if (!ShiftMetadataRegistry.TryResolve(request.Shift, out var metadata))
    {
        return Results.BadRequest(new { error = "Invalid shift name" });
    }

    var date = ResolveDate(request.Date);
    var shift = await store.GetOrCreateShiftAsync(date, metadata);
    var session = shift.StartNewSession();
    shift.ActiveSessionId = session.SessionId;
    shift.Status = ShiftStatus.InProgress;
    session.AddEvent("START");

    await store.SaveAsync(shift);
    await SendCommandAsync(serviceClient, "START", metadata.ControlValue);
    await hub.Clients.All.SendAsync("snapshot", ProductionResponse.FromShift(shift));

    return Results.Ok(new { message = "START command sent successfully" });
}).WithName("SendStart");

app.MapPost("/api/control/stop", async (
    ControlRequest request,
    ShiftStore store,
    ServiceClient serviceClient,
    IHubContext<DashboardHub> hub) =>
{
    if (!ShiftMetadataRegistry.TryResolve(request.Shift, out var metadata))
    {
        return Results.BadRequest(new { error = "Invalid shift name" });
    }

    var date = ResolveDate(request.Date);
    var shift = await store.GetOrCreateShiftAsync(date, metadata);
    var session = shift.GetActiveSession();
    if (session == null)
    {
        return Results.BadRequest(new { error = "No active session" });
    }

    session.StoppedAt = DateTime.UtcNow;
    shift.Status = ShiftStatus.Completed;
    shift.ActiveSessionId = null;
    session.AddEvent("STOP");

    await store.SaveAsync(shift);
    await SendCommandAsync(serviceClient, "STOP", metadata.ControlValue);
    await hub.Clients.All.SendAsync("snapshot", ProductionResponse.FromShift(shift));

    return Results.Ok(new { message = "STOP command sent successfully" });
}).WithName("SendStop");

app.MapPost("/api/control/restart", async (
    ControlRequest request,
    ShiftStore store,
    ServiceClient serviceClient,
    IHubContext<DashboardHub> hub) =>
{
    if (!ShiftMetadataRegistry.TryResolve(request.Shift, out var metadata))
    {
        return Results.BadRequest(new { error = "Invalid shift name" });
    }

    var date = ResolveDate(request.Date);
    var shift = await store.GetOrCreateShiftAsync(date, metadata);
    var session = shift.GetActiveSession() ?? shift.StartNewSession();

    session.ResetCounters();
    session.AddEvent("RESTART");

    await store.SaveAsync(shift);
    await SendCommandAsync(serviceClient, "RESTART", metadata.ControlValue);
    await hub.Clients.All.SendAsync("snapshot", ProductionResponse.FromShift(shift));

    return Results.Ok(new { message = "RESTART command sent successfully" });
}).WithName("SendRestart");

app.MapPost("/api/control/shift-select", async (
    ControlRequest request,
    ServiceClient serviceClient) =>
{
    if (!ShiftMetadataRegistry.TryResolve(request.Shift, out var metadata))
    {
        return Results.BadRequest(new { error = "Invalid shift name" });
    }

    await SendCommandAsync(serviceClient, "SHIFT_CHANGE", metadata.ControlValue);
    return Results.Ok(new { message = "SHIFT_CHANGE command sent successfully" });
}).WithName("SendShiftChange");

app.Run();

static string ResolveDate(string? date) =>
    string.IsNullOrWhiteSpace(date)
        ? DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd")
        : DateOnly.Parse(date).ToString("yyyy-MM-dd");

static async Task SendCommandAsync(ServiceClient client, string command, string shift) =>
    await client.SendAsync("atlas-esp32", new Message(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
    {
        command,
        shift,
        timestamp = DateTime.UtcNow
    }))));

static bool IsAuthorized(HttpContext context, BroadcastOptions options)
{
    if (string.IsNullOrWhiteSpace(options.ApiKey))
    {
        return false;
    }

    if (context.Request.Headers.TryGetValue("X-Api-Key", out var header))
    {
        return string.Equals(header.ToString(), options.ApiKey, StringComparison.Ordinal);
    }

    return false;
}

public record BroadcastOptions
{
    public string ApiKey { get; init; } = string.Empty;
}

public class ShiftStore
{
    private readonly Container _container;

    public ShiftStore(CosmosClient cosmosClient, string databaseName, string containerName)
    {
        _container = cosmosClient.GetContainer(databaseName, containerName);
    }

    public async Task<ShiftDocument> GetOrCreateShiftAsync(string date, ShiftMetadata metadata)
    {
        var shiftId = BuildShiftId(date, metadata.Key);
        var existing = await GetShiftAsync(date, metadata.Key);
        if (existing != null)
        {
            existing.EnsureMetadata(metadata);
            return existing;
        }

        var doc = ShiftDocument.Create(date, metadata);
        await SaveAsync(doc);
        return doc;
    }

    public async Task<ShiftDocument?> GetShiftAsync(string date, string shiftKey)
    {
        var shiftId = BuildShiftId(date, shiftKey);
        try
        {
            var response = await _container.ReadItemAsync<ShiftDocument>(shiftId, new PartitionKey(date));
            return response.Resource;
        }
        catch (CosmosException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    public async Task<ShiftDocument?> GetLatestShiftAsync(string date)
    {
        var query = new QueryDefinition("SELECT * FROM c WHERE c.Date = @date ORDER BY c.LastUpdated DESC")
            .WithParameter("@date", date);
        var iterator = _container.GetItemQueryIterator<ShiftDocument>(query);
        if (iterator.HasMoreResults)
        {
            var response = await iterator.ReadNextAsync();
            return response.FirstOrDefault();
        }

        return null;
    }

    public async Task<List<ShiftDocument>> GetShiftsByDateAsync(string date)
    {
        var query = new QueryDefinition("SELECT * FROM c WHERE c.Date = @date").WithParameter("@date", date);
        var iterator = _container.GetItemQueryIterator<ShiftDocument>(query);
        var result = new List<ShiftDocument>();

        while (iterator.HasMoreResults)
        {
            var response = await iterator.ReadNextAsync();
            result.AddRange(response);
        }

        return result;
    }

    public async Task SaveAsync(ShiftDocument shift)
    {
        shift.UpdateAggregates();
        shift.LastUpdated = DateTime.UtcNow;
        await _container.UpsertItemAsync(shift, new PartitionKey(shift.PartitionKey));
    }

    public static string BuildShiftId(string date, string shiftKey) => $"shift-{date}-{shiftKey}";
}

public class DashboardHub : Hub
{
}

public class BroadcastNotification
{
    public string Date { get; set; } = string.Empty;
    public string ShiftKey { get; set; } = string.Empty;
    public ShiftLog? Log { get; set; }
}

public class ControlRequest
{
    public string Shift { get; set; } = string.Empty;
    public string? Date { get; set; }
}

public class StatusResponse
{
    public bool IsRunning { get; set; }
    public string ShiftKey { get; set; } = string.Empty;
    public string ActiveShift { get; set; } = string.Empty;
    public DateTime Timestamp { get; set; }
}

