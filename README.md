# Atlas – Automated Tagging & Logistics System

Solución mínima que coordina una faja transportadora (ESP32) con:

- **Azure Functions**: procesa telemetría de IoT Hub y persiste shifts/sesiones en Cosmos DB.
- **REST API (.NET 9)**: recibe comandos del operador, expone reportes y empuja snapshots por WebSocket.
- **React SPA**: dashboard en tiempo real para iniciar/detener turnos y visualizar producción.
- **Device Simulator**: app de consola que emula al ESP32 para pruebas locales.

---

## Estructura

```
src/
  client/                React + Vite SPA
  server/
    api/                 Minimal API (.NET 9)
    functions/           Azure Function (.NET 8 isolated)
    common/              Modelos compartidos (shifts, sesiones, telemetría)
  tools/
    device-simulator/    Simulador IoT (console app)
context.md               Detalle del flujo de negocio
```

---

## Flujo (resumen)

1. Operador selecciona turno (mañana/tarde/noche) en la SPA y presiona **Start**.
2. El API crea/actualiza el documento `shift` en Cosmos, abre una sesión y envía un comando Cloud-to-Device al ESP32.
3. El ESP32 envía telemetría (conteos y eventos) a IoT Hub → Function → Cosmos.
4. La Function notifica al API (webhook interno) para que difunda el snapshot vía WebSocket al dashboard.
5. **Stop/Restart** cierran o reinician la sesión actual; el reporte diario muestra todas las sesiones del turno.

(ver `context.md` para casos detallados)

---

## Requisitos

- .NET 9 SDK (API, simulador) y .NET 8 SDK (Functions).
- Node.js ≥ 20.19 (Vite necesita 20.19+ o 22.12+).
- Azure CLI (para crear recursos reales).
- Recursos de Azure:
  - Cosmos DB SQL (serverless). Base `classifier-db`, contenedor `shifts`, PK `/_partitionKey`.
  - IoT Hub con dispositivo `atlas-esp32`.

---

## Configuración

### 1. Variables/API keys

`src/server/api/appsettings.json` (o user-secrets):
```jsonc
{
  "CosmosDbConnectionString": "AccountEndpoint=...;AccountKey=...;",
  "IoTHubConnectionString": "HostName=...;SharedAccessKey=...;",
  "Broadcast": {
    "ApiKey": "CHANGE_ME"
  }
}
```

`src/server/functions/local.settings.json`:
```jsonc
{
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "dotnet-isolated",
    "CosmosDbConnectionString": "...",
    "IoTHubEventHubConnectionString": "...",
    "BroadcastUrl": "https://localhost:5186/api/internal/production/broadcast",
    "BroadcastKey": "CHANGE_ME"
  }
}
```

Usa la misma API key en ambos archivos.

### 2. Restaurar & compilar

```bash
cd src/server
dotnet build atlas.sln

cd ../client
npm install
npm run build   # o npm run dev para modo desarrollo
```

### 3. Ejecutar servicios

En terminales separadas:
```bash
# API
cd src/server/api
dotnet run

# Functions
cd ../functions
func start

# SPA
cd ../../client
npm run dev
```

El dashboard quedará en http://localhost:5173 (a menos que Vite use otro puerto).

---

## Simulador (sin hardware)

1. Configura variables:
   ```bash
   export DEVICE_CONNECTION_STRING="HostName=...;DeviceId=atlas-esp32;SharedAccessKey=..."
   export SIM_SHIFT=manana
   export SIM_DATE=$(date +%F)
   ```
2. Ejecuta:
   ```bash
   cd src/tools/device-simulator
   dotnet run
   ```
3. Comandos disponibles en la consola: `start`, `stop`, `restart`, `exit`.  
   Cada comando envía telemetría a IoT Hub, la Function actualiza Cosmos y el API empuja el snapshot al WebSocket del dashboard.

---

## Entorno real (pendiente)

- Automatizar provisión de recursos (Bicep/Terraform). **[TODO]**
- Guía de despliegue CI/CD (Functions + API + SPA). **[TODO]**
- Integración con el ESP32 físico. **[TODO]**

---

## Recursos útiles

- Cosmos DB serverless: <https://learn.microsoft.com/azure/cosmos-db/serverless>
- IoT Hub C2D / D2C: <https://learn.microsoft.com/azure/iot-hub/iot-hub-devguide>
