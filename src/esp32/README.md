# Atlas ESP32 Device Code

This is the Arduino code for the ESP32 device that connects to Azure IoT Hub and sends telemetry data.

## Required Libraries

Install the following libraries via Arduino Library Manager:

1. **Azure IoT Hub Device SDK for Arduino**
   - Library: `AzureIoTHub` by Microsoft
   - Also install: `AzureIoTProtocol_MQTT` (dependency)

2. **ArduinoJson**
   - Library: `ArduinoJson` by Benoit Blanchon
   - Version: 6.x or 7.x

3. **WiFi** (built-in with ESP32 board support)

4. **Time** (built-in with ESP32 board support)

## Board Configuration

- **Board**: ESP32 Dev Module (or your specific ESP32 board)
- **Upload Speed**: 115200
- **CPU Frequency**: 240MHz (or 160MHz)
- **Flash Frequency**: 80MHz
- **Flash Size**: 4MB (or your board's size)
- **Partition Scheme**: Default 4MB with spiffs

## Configuration

Before uploading, configure the following in `esp32.ino`:

1. **WiFi Credentials**:
   ```cpp
   const char* ssid = "YOUR_WIFI_SSID";
   const char* password = "YOUR_WIFI_PASSWORD";
   ```

2. **Azure IoT Hub Device Connection String**:
   ```cpp
   const char* connectionString = "HostName=<hub-name>.azure-devices.net;DeviceId=<device-id>;SharedAccessKey=<key>";
   ```
   
   Get this from Azure Portal → IoT Hub → Devices → Your Device → Connection String

3. **Device ID** (optional, defaults to "atlas-esp32"):
   ```cpp
   const char* deviceId = "atlas-esp32";
   ```

4. **Telemetry Interval** (optional, defaults to 2000ms):
   ```cpp
   const unsigned long telemetryInterval = 2000; // milliseconds
   ```

## Functionality

- **WiFi Connection**: Automatically connects to configured WiFi network
- **IoT Hub Connection**: Connects to Azure IoT Hub via MQTT
- **Cloud-to-Device Commands**: Listens for and processes:
  - `START`: Starts the conveyor and begins sending telemetry
  - `STOP`: Stops the conveyor and telemetry
  - `RESTART`: Resets counters and restarts
  - `SHIFT_CHANGE`: Changes the active shift
- **Telemetry**: Sends box detection events periodically when running
- **Time Sync**: Synchronizes time via NTP for accurate timestamps

## Telemetry Format

The device sends JSON messages in this format:
```json
{
  "deviceId": "atlas-esp32",
  "date": "2025-11-26",
  "shift": "manana",
  "sessionId": "abc123...",
  "boxSize": "small|medium|large|",
  "isRunning": true,
  "eventType": "START|STOP|RESTART|null",
  "timestamp": "2025-11-26T18:29:19.821454Z"
}
```

## Serial Monitor

Open Serial Monitor at 115200 baud to see:
- Connection status
- Received commands
- Sent telemetry
- Errors

## Notes

- The code simulates box detection with random values. In production, replace this with actual sensor readings.
- The device automatically reconnects if WiFi or IoT Hub connection is lost.
- Session IDs are generated randomly on device startup and reset.

