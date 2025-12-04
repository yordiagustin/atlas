/*
 * ATLAS ESP32 Device - Azure IoT Hub Integration
 * Using: Azure SDK for C (Official Microsoft Library)
 * 
 * Libraries required:
 * - azure-sdk-for-c (by Microsoft)
 * - ArduinoJson
 */

#include <WiFi.h>
#include <mqtt_client.h>
#include <ArduinoJson.h>
#include <time.h>
#include <az_core.h>
#include <az_iot.h>

// ==================== CONFIG ====================

const char* WIFI_SSID = "iPhone de Yordi";
const char* WIFI_PASS = "76223642.";

const char* AZURE_HOST = "atlas-iot-hub.azure-devices.net";
const char* DEVICE_ID = "atlas-esp32";
const char* DEVICE_KEY = "VaobZJ72xUxrR4ASVz8lyYSjzJxXgUb2Z45XUvecZNM=";

const char* DEFAULT_SHIFT = "manana";
const unsigned long SENSOR_POLL_MS = 25;
const unsigned long DETECTION_RESET_MS = 150;

const int SMALL_SENSOR_PIN = 32;
const int MEDIUM_SENSOR_PIN = 33;
const int LARGE_SENSOR_PIN = 25;
const int MOTOR_PIN = 26;

// ==================== STATE ====================

struct State {
  String deviceId;
  String date;
  String shift;
  bool isRunning;
  int smallCount;
  int mediumCount;
  int largeCount;
  
  void reset() {
    smallCount = 0;
    mediumCount = 0;
    largeCount = 0;
  }
  
  void changeShift(String newShift) {
    shift = newShift;
    reset();
  }
  
  String getDate() {
    struct tm timeinfo;
    if (!getLocalTime(&timeinfo)) {
      return "1970-01-01";
    }
    char buf[11];
    strftime(buf, sizeof(buf), "%Y-%m-%d", &timeinfo);
    return String(buf);
  }
  
  String getTimestamp() {
    struct tm timeinfo;
    if (!getLocalTime(&timeinfo)) {
      return "";
    }
    char buf[30];
    strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S.000Z", &timeinfo);
    return String(buf);
  }
};

State state;
esp_mqtt_client_handle_t mqtt_client = NULL;
az_iot_hub_client client;

unsigned long lastSensorPoll = 0;
unsigned long lastDetectionTime = 0;
bool detectionLatched = false;

// ==================== SETUP ====================

void setup() {
  Serial.begin(115200);
  delay(2000);
  
  Serial.println("\n=== ATLAS ESP32 Device ===\n");
  
  state.deviceId = "atlas-esp32";
  state.shift = DEFAULT_SHIFT;
  state.isRunning = false;
  state.smallCount = 0;
  state.mediumCount = 0;
  state.largeCount = 0;
  state.date = state.getDate();
  
  pinMode(SMALL_SENSOR_PIN, INPUT_PULLUP);
  pinMode(MEDIUM_SENSOR_PIN, INPUT_PULLUP);
  pinMode(LARGE_SENSOR_PIN, INPUT_PULLUP);
  pinMode(MOTOR_PIN, OUTPUT);
  digitalWrite(MOTOR_PIN, LOW);
  
  connectWiFi();
  syncTime();
  initializeAzure();
  connectMQTT();
  
  Serial.println("Device ready.\n");
}

// ==================== MAIN LOOP ====================

void loop() {
  // Poll sensors
  unsigned long now = millis();
  if (now - lastSensorPoll >= SENSOR_POLL_MS) {
    lastSensorPoll = now;
    
    bool small = digitalRead(SMALL_SENSOR_PIN) == LOW;
    bool medium = digitalRead(MEDIUM_SENSOR_PIN) == LOW;
    bool large = digitalRead(LARGE_SENSOR_PIN) == LOW;
    
    if (!state.isRunning) {
      detectionLatched = false;
    }
    else if (!detectionLatched && small) {
      String boxSize = classifyBox(small, medium, large);
      if (boxSize != "") {
        sendTelemetry("", boxSize);
        detectionLatched = true;
        lastDetectionTime = now;
      }
    }
    else if (detectionLatched && !small && !medium && !large) {
      if (now - lastDetectionTime >= DETECTION_RESET_MS) {
        detectionLatched = false;
      }
    }
  }
  
  delay(5);
}

// ==================== WiFi ====================

void connectWiFi() {
  Serial.print("[WiFi] Connecting to ");
  Serial.println(WIFI_SSID);
  
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 20) {
    delay(500);
    Serial.print(".");
    tries++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.print("[WiFi] Connected! IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println();
    Serial.println("[WiFi] ERROR!");
    ESP.restart();
  }
}

// ==================== TIME ====================

void syncTime() {
  Serial.print("[Time] Syncing...");
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  
  time_t now = time(nullptr);
  int tries = 0;
  while (now < 24 * 3600 && tries < 20) {
    delay(500);
    Serial.print(".");
    now = time(nullptr);
    tries++;
  }
  
  Serial.println(" Done!");
}

// ==================== AZURE INITIALIZATION ====================

void initializeAzure() {
  Serial.println("[Azure] Initializing...");
  
  az_iot_hub_client_options options = az_iot_hub_client_default_options;
  
  az_iot_hub_client_init(
    &client,
    az_span_create((uint8_t*)AZURE_HOST, strlen(AZURE_HOST)),
    az_span_create((uint8_t*)DEVICE_ID, strlen(DEVICE_ID)),
    &options);
  
  Serial.println("[Azure] Initialized");
}

// ==================== MQTT EVENT HANDLER ====================

static void mqtt_event_handler(void* handler_args, esp_event_base_t base, int32_t event_id, void* event_data) {
  esp_mqtt_event_handle_t event = (esp_mqtt_event_handle_t)event_data;

  switch ((esp_mqtt_event_id_t)event_id) {
    case MQTT_EVENT_CONNECTED:
      Serial.println("[MQTT] Connected!");
      
      char sub_topic[256];
      snprintf(sub_topic, sizeof(sub_topic), "devices/%s/messages/devicebound/#", DEVICE_ID);
      esp_mqtt_client_subscribe(mqtt_client, sub_topic, 1);
      Serial.println("[MQTT] Subscribed to C2D");
      break;

    case MQTT_EVENT_DATA: {
      String topic(event->topic, event->topic_len);
      String payload((const char*)event->data, event->data_len);
      
      Serial.print("[Message] Topic: ");
      Serial.println(topic);
      Serial.print("[Message] Payload: ");
      Serial.println(payload);
      
      StaticJsonDocument<256> doc;
      if (!deserializeJson(doc, payload)) {
        String cmd = doc["command"] | "";
        String shift = doc["shift"] | "";
        handleCommand(cmd, shift);
      }
      break;
    }

    case MQTT_EVENT_DISCONNECTED:
      Serial.println("[MQTT] Disconnected");
      break;

    case MQTT_EVENT_ERROR:
      Serial.println("[MQTT] Error");
      break;

    default:
      break;
  }
}

// ==================== MQTT CONNECTION ====================

void connectMQTT() {
  Serial.println("[MQTT] Connecting...");
  
  // Get username from Azure SDK
  char mqtt_username[256];
  size_t username_size = 0;
  az_iot_hub_client_get_user_name(&client, mqtt_username, sizeof(mqtt_username), &username_size);
  
  // Get client ID from Azure SDK
  char mqtt_clientid[128];
  size_t clientid_size = 0;
  az_iot_hub_client_get_client_id(&client, mqtt_clientid, sizeof(mqtt_clientid), &clientid_size);
  
  // Generate SAS token
  time_t now = time(nullptr);
  unsigned long expiry = now + 3600; // 1 hour
  
  char sas_token[512];
  snprintf(sas_token, sizeof(sas_token),
    "SharedAccessSignature sr=%s/devices/%s&sig=%s&se=%lu",
    AZURE_HOST,
    DEVICE_ID,
    DEVICE_KEY,
    expiry);
  
  // MQTT config
  esp_mqtt_client_config_t mqtt_cfg = {};
  
  // Build URI
  char mqtt_uri[512];
  snprintf(mqtt_uri, sizeof(mqtt_uri), "mqtts://%s:8883", AZURE_HOST);
  
  mqtt_cfg.broker.address.uri = mqtt_uri;
  mqtt_cfg.credentials.client_id = mqtt_clientid;
  mqtt_cfg.credentials.username = mqtt_username;
  mqtt_cfg.credentials.authentication.password = sas_token;
  mqtt_cfg.network.disable_auto_reconnect = false;

  mqtt_client = esp_mqtt_client_init(&mqtt_cfg);
  
  if (mqtt_client == NULL) {
    Serial.println("[MQTT] ERROR: Failed to create client!");
    return;
  }
  
  esp_mqtt_client_register_event(mqtt_client, ESP_EVENT_ANY_ID, mqtt_event_handler, NULL);
  esp_mqtt_client_start(mqtt_client);
  
  Serial.println("[MQTT] Client started");
}

// ==================== COMMANDS ====================

void handleCommand(String command, String shift) {
  command.toUpperCase();
  
  if (command == "START") {
    state.isRunning = true;
    setMotor(true);
    sendTelemetry("START", "");
    Serial.println("[Command] START");
  }
  else if (command == "STOP") {
    state.isRunning = false;
    setMotor(false);
    sendTelemetry("STOP", "");
    Serial.println("[Command] STOP");
  }
  else if (command == "RESTART") {
    state.reset();
    state.isRunning = true;
    setMotor(true);
    sendTelemetry("RESTART", "");
    Serial.println("[Command] RESTART");
  }
  else if (command == "SHIFT_CHANGE" && shift != "") {
    state.changeShift(shift);
    Serial.print("[Command] SHIFT_CHANGE to ");
    Serial.println(shift);
  }
}

// ==================== TELEMETRY ====================

void sendTelemetry(String eventType, String boxSize) {
  if (mqtt_client == NULL) {
    return;
  }
  
  if (eventType == "" && boxSize == "") {
    return;
  }
  
  String currentDate = state.getDate();
  if (currentDate != state.date) {
    state.date = currentDate;
  }
  
  StaticJsonDocument<256> doc;
  doc["deviceId"] = state.deviceId;
  doc["date"] = state.date;
  doc["shift"] = state.shift;
  doc["boxSize"] = boxSize;
  doc["isRunning"] = state.isRunning;
  doc["smallCount"] = state.smallCount;
  doc["mediumCount"] = state.mediumCount;
  doc["largeCount"] = state.largeCount;
  doc["timestamp"] = state.getTimestamp();
  
  if (eventType != "") {
    doc["eventType"] = eventType;
  }
  
  String json;
  serializeJson(doc, json);
  
  char telemetry_topic[256];
  snprintf(telemetry_topic, sizeof(telemetry_topic),
    "devices/%s/messages/events/",
    DEVICE_ID);
  
  esp_mqtt_client_publish(mqtt_client, telemetry_topic, json.c_str(), 0, 1, 0);
  
  String action = eventType != "" ? eventType : ("BOX_" + boxSize);
  Serial.print("[Telemetry] ");
  Serial.println(action);
}

// ==================== BOX CLASSIFICATION ====================

String classifyBox(bool small, bool medium, bool large) {
  if (!small) return "";
  if (!medium && !large) return "small";
  if (medium && !large) return "medium";
  return "large";
}

// ==================== MOTOR CONTROL ====================

void setMotor(bool on) {
  digitalWrite(MOTOR_PIN, on ? HIGH : LOW);
  Serial.print("[Motor] ");
  Serial.println(on ? "ON" : "OFF");
}
