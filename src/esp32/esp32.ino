#include <WiFi.h>
#include <AzureIoTProtocol_MQTT.h>
#include <AzureIoTHub.h>
#include <ArduinoJson.h>
#include <time.h>

// WiFi credentials - configure these
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// Azure IoT Hub Device Connection String
// Format: HostName=<hub-name>.azure-devices.net;DeviceId=<device-id>;SharedAccessKey=<key>
const char* connectionString = "YOUR_DEVICE_CONNECTION_STRING";

// Device configuration
const char* deviceId = "atlas-esp32";
const char* defaultShift = "manana";
const unsigned long telemetryInterval = 2000; // 2 seconds

// IR sensor configuration (Flying Fish modules expose digital outputs)
const int smallSensorPin = 32;
const int mediumSensorPin = 33;
const int largeSensorPin = 25;
const bool sensorActiveState = LOW;          // Flying Fish digital output is LOW when triggered
const unsigned long sensorPollIntervalMs = 25;
const unsigned long detectionResetDelayMs = 150;

// DC motor (TT Motor) control pin - drive via transistor/H-bridge
const int conveyorMotorPin = 26;
const bool motorActiveState = HIGH;          // HIGH drives the motor, LOW stops it

// State management
struct TelemetryState {
  String deviceId;
  String date;
  String shift;
  bool isRunning;
  int smallBoxes;
  int mediumBoxes;
  int largeBoxes;
  
  void reset() {
    smallBoxes = 0;
    mediumBoxes = 0;
    largeBoxes = 0;
  }
  
  void changeShift(String newShift) {
    shift = newShift;
    reset();
  }
  
  String getCurrentDate() {
    struct tm timeinfo;
    if (!getLocalTime(&timeinfo)) {
      return "1970-01-01";
    }
    char dateStr[11];
    strftime(dateStr, sizeof(dateStr), "%Y-%m-%d", &timeinfo);
    return String(dateStr);
  }
  
  String getCurrentTimestamp() {
    struct tm timeinfo;
    if (!getLocalTime(&timeinfo)) {
      return "";
    }
    char timestamp[30];
    strftime(timestamp, sizeof(timestamp), "%Y-%m-%dT%H:%M:%S.000Z", &timeinfo);
    return String(timestamp);
  }
};

TelemetryState state;
IOTHUB_CLIENT_LL_HANDLE iotHubClientHandle = NULL;
unsigned long lastTelemetryTime = 0;
unsigned long lastSensorPoll = 0;
bool detectionLatched = false;

// Function prototypes
void connectWiFi();
void connectIoT();
void sendTelemetry(String eventType = "", String boxSize = "");
void handleCloudCommand(String command, String shift);
void setupTime();
String classifyBoxFromSensors(bool smallActive, bool mediumActive, bool largeActive);
void updateMotorState();

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("=== Atlas ESP32 Device ===");
  Serial.println("Initializing...");
  
  // Initialize state
  state.deviceId = deviceId;
  state.shift = defaultShift;
  state.isRunning = false;
  state.smallBoxes = 0;
  state.mediumBoxes = 0;
  state.largeBoxes = 0;
  state.date = state.getCurrentDate();

  pinMode(smallSensorPin, INPUT_PULLUP);
  pinMode(mediumSensorPin, INPUT_PULLUP);
  pinMode(largeSensorPin, INPUT_PULLUP);
  pinMode(conveyorMotorPin, OUTPUT);
  digitalWrite(conveyorMotorPin, LOW); // Motor stopped by default
  
  // Connect to WiFi
  connectWiFi();
  
  // Setup time (NTP)
  setupTime();
  
  // Connect to IoT Hub
  connectIoT();
  
  Serial.println("Device ready. Waiting for commands...");
  Serial.println("Commands: START, STOP, RESTART, SHIFT_CHANGE");
}

void loop() {
  // Maintain IoT Hub connection
  if (iotHubClientHandle != NULL) {
    IoTHubClient_LL_DoWork(iotHubClientHandle);
  }

  const unsigned long now = millis();
  if (now - lastSensorPoll >= sensorPollIntervalMs) {
    lastSensorPoll = now;

    const bool smallActive = digitalRead(smallSensorPin) == sensorActiveState;
    const bool mediumActive = digitalRead(mediumSensorPin) == sensorActiveState;
    const bool largeActive = digitalRead(largeSensorPin) == sensorActiveState;

    if (!state.isRunning) {
      detectionLatched = false;
    }
    else if (!detectionLatched && smallActive) {
      const String boxSize = classifyBoxFromSensors(smallActive, mediumActive, largeActive);
      if (boxSize.length() > 0) {
        sendTelemetry("", boxSize);
        detectionLatched = true;          // prevent duplicate sends while box remains in sensors
        lastTelemetryTime = now;
      }
    }
    else if (detectionLatched && !smallActive && !mediumActive && !largeActive) {
      if (now - lastTelemetryTime >= detectionResetDelayMs) {
        detectionLatched = false;         // ready for the next box
      }
    }
  }

  delay(5);
}

void connectWiFi() {
  Serial.print("Connecting to WiFi: ");
  Serial.println(ssid);
  
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.print("WiFi connected! IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println();
    Serial.println("WiFi connection failed!");
    ESP.restart();
  }
}

void setupTime() {
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  
  Serial.print("Waiting for time sync...");
  struct tm timeinfo;
  int attempts = 0;
  while (!getLocalTime(&timeinfo) && attempts < 10) {
    delay(1000);
    Serial.print(".");
    attempts++;
  }
  
  if (getLocalTime(&timeinfo)) {
    Serial.println();
    Serial.println("Time synchronized!");
    state.date = state.getCurrentDate();
  } else {
    Serial.println();
    Serial.println("Time sync failed, using default date");
  }
}

void connectIoT() {
  Serial.println("Connecting to Azure IoT Hub...");
  
  if (connectionString == NULL || strlen(connectionString) == 0) {
    Serial.println("ERROR: Device connection string not configured!");
    return;
  }
  
  iotHubClientHandle = IoTHubClient_LL_CreateFromConnectionString(
    connectionString, 
    MQTT_Protocol
  );
  
  if (iotHubClientHandle == NULL) {
    Serial.println("ERROR: Failed to create IoT Hub client!");
    return;
  }
  
  // Set message callback for C2D commands
  IoTHubClient_LL_SetMessageCallback(iotHubClientHandle, messageCallback, NULL);
  
  // Set connection status callback
  IoTHubClient_LL_SetConnectionStatusCallback(iotHubClientHandle, connectionStatusCallback, NULL);
  
  Serial.println("IoT Hub client created. Connecting...");
  
  // Wait for connection
  int attempts = 0;
  while (attempts < 30) {
    IoTHubClient_LL_DoWork(iotHubClientHandle);
    delay(100);
    attempts++;
  }
  
  Serial.println("IoT Hub connection established!");
}

static IOTHUBMESSAGE_DISPOSITION_RESULT messageCallback(IOTHUB_MESSAGE_HANDLE message, void* userContextCallback) {
  const unsigned char* buffer;
  size_t size;
  
  if (IoTHubMessage_GetByteArray(message, &buffer, &size) != IOTHUB_MESSAGE_OK) {
    return IOTHUBMESSAGE_REJECTED;
  }
  
  String commandJson = String((const char*)buffer);
  Serial.print("[C2D] Received: ");
  Serial.println(commandJson);
  
  // Parse JSON command
  StaticJsonDocument<256> doc;
  DeserializationError error = deserializeJson(doc, commandJson);
  
  if (error) {
    Serial.print("[C2D] JSON parse error: ");
    Serial.println(error.c_str());
    return IOTHUBMESSAGE_REJECTED;
  }
  
  String command = doc["command"] | "";
  String shift = doc["shift"] | "";
  
  if (command.length() > 0) {
    handleCloudCommand(command, shift);
  }
  
  return IOTHUBMESSAGE_ACCEPTED;
}

static void connectionStatusCallback(IOTHUB_CLIENT_CONNECTION_STATUS result, IOTHUB_CLIENT_CONNECTION_STATUS_REASON reason, void* userContextCallback) {
  if (result == IOTHUB_CLIENT_CONNECTION_AUTHENTICATED) {
    Serial.println("IoT Hub: Connected");
  } else {
    Serial.println("IoT Hub: Disconnected");
  }
}

void handleCloudCommand(String command, String shift) {
  command.toUpperCase();
  
  if (command == "START") {
    state.isRunning = true;
    updateMotorState();
    Serial.print("[C2D] START received for shift: ");
    Serial.println(state.shift);
    sendTelemetry("START", "");
  }
  else if (command == "STOP") {
    state.isRunning = false;
    updateMotorState();
    Serial.println("[C2D] STOP received. Stopping count.");
    sendTelemetry("STOP", "");
    lastTelemetryTime = 0;
  }
  else if (command == "RESTART") {
    state.reset();
    state.isRunning = true;
    updateMotorState();
    Serial.println("[C2D] RESTART received. Resetting session and counters.");
    sendTelemetry("RESTART", "");
  }
  else if (command == "SHIFT_CHANGE") {
    if (shift.length() > 0) {
      state.changeShift(shift);
      Serial.print("[C2D] SHIFT_CHANGE to: ");
      Serial.println(state.shift);
      Serial.println("Waiting for START command...");
    } else {
      Serial.println("[C2D] SHIFT_CHANGE without valid shift.");
    }
  }
  else {
    Serial.print("[C2D] Unknown command: ");
    Serial.println(command);
  }
}

String classifyBoxFromSensors(bool smallActive, bool mediumActive, bool largeActive) {
  if (!smallActive) {
    return "";
  }

  if (!mediumActive && !largeActive) {
    return "small";
  }

  if (mediumActive && !largeActive) {
    return "medium";
  }

  if (mediumActive && largeActive) {
    return "large";
  }

  // Fallback: if upper sensor triggers without middle, treat as large to avoid undercounting
  if (!mediumActive && largeActive) {
    return "large";
  }

  return "";
}

void updateMotorState() {
  digitalWrite(conveyorMotorPin, state.isRunning ? motorActiveState : !motorActiveState);
}

void sendTelemetry(String eventType, String boxSize) {
  if (iotHubClientHandle == NULL) {
    return;
  }
  
  // Only send if there's a control event or a box was detected
  if (eventType.length() == 0 && boxSize.length() == 0) {
    return; // Nothing to send
  }
  
  // Update date if needed
  String currentDate = state.getCurrentDate();
  if (currentDate != state.date) {
    state.date = currentDate;
  }
  
  // Create JSON payload
  StaticJsonDocument<256> doc;
  doc["deviceId"] = state.deviceId;
  doc["date"] = state.date;
  doc["shift"] = state.shift;
  doc["boxSize"] = boxSize;
  doc["isRunning"] = state.isRunning;
  
  if (eventType.length() > 0) {
    doc["eventType"] = eventType;
  } else {
    doc["eventType"] = (const char*)NULL;
  }
  
  doc["timestamp"] = state.getCurrentTimestamp();
  
  String jsonPayload;
  serializeJson(doc, jsonPayload);
  
  // Create and send message
  IOTHUB_MESSAGE_HANDLE messageHandle = IoTHubMessage_CreateFromString(jsonPayload.c_str());
  
  if (messageHandle == NULL) {
    Serial.println("ERROR: Failed to create message!");
    return;
  }
  
  IOTHUB_CLIENT_RESULT result = IoTHubClient_LL_SendEventAsync(
    iotHubClientHandle,
    messageHandle,
    sendConfirmationCallback,
    NULL
  );
  
  IoTHubMessage_Destroy(messageHandle);
  
  if (result != IOTHUB_CLIENT_OK) {
    Serial.print("ERROR: Failed to send message. Code: ");
    Serial.println(result);
  } else {
    String action = eventType.length() > 0 ? eventType : 
                   (boxSize.length() > 0 ? "BOX_" + boxSize : "TELEMETRY");
    action.toUpperCase();
    Serial.print("[Telemetry] ");
    Serial.println(action);
  }
}

static void sendConfirmationCallback(IOTHUB_CLIENT_CONFIRMATION_RESULT result, void* userContextCallback) {
  if (result == IOTHUB_CLIENT_CONFIRMATION_OK) {
    // Message sent successfully
  } else {
    Serial.print("Message send failed. Result: ");
    Serial.println(result);
  }
}
