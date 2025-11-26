# ATLAS - Azure Functions (Phase 1)

## Project Structure

```
functions/
├── TelemetryPayload.cs        # ESP32 telemetry model
├── ShiftDocument.cs           # Cosmos DB shift document
├── CosmosService.cs           # Cosmos DB operations
├── ProcessIoTTelemetry.cs     # IoT Hub telemetry processor
├── Program.cs                 # Configuration and DI
├── functions.csproj           # Project dependencies
├── host.json                  # Host configuration
└── local.settings.json        # Local environment variables
```

## Installed Dependencies

- `Microsoft.Azure.Functions.Worker.Extensions.EventHubs` (6.3.6) - Event Hub trigger
- `Microsoft.Azure.Cosmos` (3.42.0) - Cosmos DB client
- `Newtonsoft.Json` (13.0.3) - JSON serialization

## Required Configuration

### Environment Variables (local.settings.json)

Update `local.settings.json` with your actual credentials:

```json
{
  "CosmosDbConnectionString": "AccountEndpoint=https://atlas-cosmos.documents.azure.com:443/;AccountKey=YOUR-KEY;",
  "IoTHubEventHubConnectionString": "Endpoint=sb://ihsuprodblres042dednamespace.servicebus.windows.net/;SharedAccessKeyName=iothubowner;SharedAccessKey=YOUR-KEY;EntityPath=atlas-iot-hub"
}
```

### Getting Connection Strings

**Cosmos DB:**
```bash
az cosmosdb keys list --name atlas-cosmos --resource-group <your-rg> --type connection-strings
```

**IoT Hub (Event Hub compatible):**
```bash
az iot hub connection-string show --hub-name atlas-iot-hub --policy-name iothubowner
```

### Azure Portal Configuration

To deploy to Azure, add these Application Settings in your Function App:

1. `CosmosDbConnectionString` = [your Cosmos connection string]
2. `IoTHubEventHubConnectionString` = [your IoT Hub connection string]

## How It Works

### ProcessIoTTelemetry Function

This function:

1. **Listens** to IoT Hub messages via Event Hub trigger
2. **Deserializes** JSON payload from ESP32
3. **Gets or creates** the shift in Cosmos DB
4. **Updates** box counters (Small, Medium, Large)
5. **Records events** (START, STOP, RESTART) if present
6. **Persists** data to Cosmos DB

### Data Models

**TelemetryPayload (ESP32 → IoT Hub):**
```json
{
  "deviceId": "atlas-esp32",
  "fecha": "2025-11-25",
  "turno": "manana",
  "countersSmall": 45,
  "countersMedium": 32,
  "countersLarge": 18,
  "isRunning": true,
  "evento": "START",
  "timestamp": "2025-11-25T06:05:30Z"
}
```

**ShiftDocument (Cosmos DB):**
```json
{
  "id": "shift-2025-11-25-manana",
  "type": "shift",
  "name": "Morning",
  "date": "2025-11-25",
  "startTime": "06:00:00",
  "endTime": "14:00:00",
  "smallBoxes": 45,
  "mediumBoxes": 32,
  "largeBoxes": 18,
  "total": 95,
  "status": "IN_PROGRESS",
  "events": [
    {
      "id": "uuid",
      "type": "START",
      "timestamp": "2025-11-25T06:05:30Z"
    }
  ],
  "createdAt": "2025-11-25T06:05:30Z",
  "lastUpdated": "2025-11-25T06:10:30Z",
  "_partitionKey": "2025-11-25"
}
```

## Useful Commands

### Build
```bash
dotnet build
```

### Run locally
```bash
func start
```

### Publish to Azure
```bash
func azure functionapp publish atlas-function
```

## Cosmos DB Setup

Make sure you have created:

- **Database:** `classifier-db`
- **Container:** `shifts`
- **Partition Key:** `/_partitionKey`

```bash
# Create database
az cosmosdb sql database create \
  --account-name atlas-cosmos \
  --resource-group <your-rg> \
  --name classifier-db

# Create container
az cosmosdb sql container create \
  --account-name atlas-cosmos \
  --resource-group <your-rg> \
  --database-name classifier-db \
  --name shifts \
  --partition-key-path "/_partitionKey" \
  --throughput 400
```

## Testing

To test the function without ESP32, send test messages to IoT Hub:

```bash
az iot device send-d2c-message \
  --device-id atlas-esp32 \
  --hub-name atlas-iot-hub \
  --data '{"deviceId":"atlas-esp32","fecha":"2025-11-25","turno":"manana","countersSmall":10,"countersMedium":5,"countersLarge":3,"isRunning":true,"evento":"START","timestamp":"2025-11-25T10:00:00Z"}'
```

## Next Steps (Week 2)

- [ ] Configure Cosmos DB in Azure
- [ ] Test function with real IoT Hub data
- [ ] Implement ESP32 MQTT client
- [ ] Monitor logs in Application Insights

## Important Notes

- **Partition Key:** Always use `date` for efficient queries
- **Events:** Stored inside shift document (denormalization)
- **Idempotency:** Function uses `UpsertItemAsync`, safe to reprocess messages
