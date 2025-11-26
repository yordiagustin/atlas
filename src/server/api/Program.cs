using System.Collections.Concurrent;
using System.Linq;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Atlas.Domain;
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
        policy.AllowAnyOrigin()
              .AllowAnyMethod()
              .AllowAnyHeader();
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

builder.Services.AddSingleton<ProductionBroadcaster>();
builder.Services.Configure<BroadcastOptions>(builder.Configuration.GetSection("Broadcast"));

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseWebSockets();
app.UseCors("AllowReactSPA");

app.MapGet("/ws/production", async (HttpContext context, ProductionBroadcaster broadcaster) =>
{
    if (!context.WebSockets.IsWebSocketRequest)
    {
        return Results.StatusCode((int)HttpStatusCode.BadRequest);
    }

    using var socket = await context.WebSockets.AcceptWebSocketAsync();
    await broadcaster.HandleClientAsync(socket, context.RequestAborted);
    return Results.Empty;
});

app.MapPost("/api/internal/production/broadcast", async (
    ProductionResponse snapshot,
    HttpContext context,
    ProductionBroadcaster broadcaster,
    IOptions<BroadcastOptions> options) =>
{
    if (!IsAuthorized(context, options.Value))
    {
        return Results.StatusCode((int)HttpStatusCode.Unauthorized);
    }

    await broadcaster.BroadcastAsync(snapshot);
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

    return Results.Ok(doc.Events);
}).WithName("GetEvents");

app.MapPost("/api/control/start", async (
    ControlRequest request,
    ShiftStore store,
    ServiceClient serviceClient,
    ProductionBroadcaster broadcaster) =>
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
    shift.AddEvent("START", session.SessionId);
    session.AddEvent("START");

    await store.SaveAsync(shift);
    await SendCommandAsync(serviceClient, "START", metadata.ControlValue);
    await broadcaster.BroadcastAsync(ProductionResponse.FromShift(shift));

    return Results.Ok(new { message = "START command sent successfully" });
}).WithName("SendStart");

app.MapPost("/api/control/stop", async (
    ControlRequest request,
    ShiftStore store,
    ServiceClient serviceClient,
    ProductionBroadcaster broadcaster) =>
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
    shift.AddEvent("STOP", session.SessionId);
    session.AddEvent("STOP");

    await store.SaveAsync(shift);
    await SendCommandAsync(serviceClient, "STOP", metadata.ControlValue);
    await broadcaster.BroadcastAsync(ProductionResponse.FromShift(shift));

    return Results.Ok(new { message = "STOP command sent successfully" });
}).WithName("SendStop");

app.MapPost("/api/control/restart", async (
    ControlRequest request,
    ShiftStore store,
    ServiceClient serviceClient,
    ProductionBroadcaster broadcaster) =>
{
    if (!ShiftMetadataRegistry.TryResolve(request.Shift, out var metadata))
    {
        return Results.BadRequest(new { error = "Invalid shift name" });
    }

    var date = ResolveDate(request.Date);
    var shift = await store.GetOrCreateShiftAsync(date, metadata);
    var session = shift.GetActiveSession() ?? shift.StartNewSession();

    session.ResetCounters();
    shift.AddEvent("RESTART", session.SessionId);
    session.AddEvent("RESTART");

    await store.SaveAsync(shift);
    await SendCommandAsync(serviceClient, "RESTART", metadata.ControlValue);
    await broadcaster.BroadcastAsync(ProductionResponse.FromShift(shift));

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

public class ProductionBroadcaster
{
    private readonly ConcurrentDictionary<string, WebSocket> _clients = new();

    public async Task HandleClientAsync(WebSocket socket, CancellationToken cancellationToken)
    {
        var id = Guid.NewGuid().ToString();
        _clients.TryAdd(id, socket);

        var buffer = new byte[4];
        try
        {
            while (socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
            {
                var result = await socket.ReceiveAsync(buffer, cancellationToken);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    break;
                }
            }
        }
        finally
        {
            _clients.TryRemove(id, out _);
            if (socket.State != WebSocketState.Closed)
            {
                await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Closing", CancellationToken.None);
            }
        }
    }

    public async Task BroadcastAsync(ProductionResponse snapshot)
    {
        var payload = JsonSerializer.SerializeToUtf8Bytes(snapshot);
        var tasks = _clients.ToList().Select(async pair =>
        {
            try
            {
                if (pair.Value.State == WebSocketState.Open)
                {
                    await pair.Value.SendAsync(payload, WebSocketMessageType.Text, true, CancellationToken.None);
                }
                else
                {
                    _clients.TryRemove(pair.Key, out _);
                }
            }
            catch
            {
                _clients.TryRemove(pair.Key, out _);
            }
        });

        await Task.WhenAll(tasks);
    }
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

