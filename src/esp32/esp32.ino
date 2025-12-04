#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <HTTPClient.h> // <--- AGREGADA: Para llamar al API Web
#include <time.h>
#include "mbedtls/md.h"
#include "mbedtls/base64.h"

// ---------------- CREDECIALES WIFI ----------------
const char* ssid = "iPhone de Yordi";
const char* password = "76223642."; 

// ---------------- CONFIGURACIÓN API (WEB) ----------------
const char* api_base_url = "https://atlas-api-hth9gub2gkacdthg.eastus2-01.azurewebsites.net";

// ---------------- CONFIGURACIÓN AZURE IOT HUB ----------------
const char* iothub_hostname = "atlas-iot-hub.azure-devices.net";
const char* device_id = "atlas-esp32";
const char* device_key = "VaobZJ72xUxrR4ASVz8lyYSjzJxXgUb2Z45XUvecZNM=";

// Tópicos MQTT
String publishTopic = "devices/" + String(device_id) + "/messages/events/";
String subscribeTopic = "devices/" + String(device_id) + "/messages/devicebound/#";

// ---------------- PINES DEL HARDWARE ----------------
const int SMALL_SENSOR_PIN = 32;
const int MEDIUM_SENSOR_PIN = 33;
const int LARGE_SENSOR_PIN = 25;

// Pin de Control del Driver L298N (Conectado a IN1)
const int MOTOR_PIN = 26; 

// --- NUEVO: PINES DE BOTONES (Conectar a GND) ---
const int BTN_START_PIN = 27;
const int BTN_STOP_PIN = 14;
const int BTN_RESTART_PIN = 12;

// ---------------- VARIABLES GLOBALES ----------------
bool isRunning = false;
String currentShift = "manana"; 

// --- NUEVO: Variable para lógica de sensores jerárquica ---
bool boxDetected = false; // "Cerrojo" para saber si hay una caja pasando actualmente

// Variables para "Debounce" de botones (evitar múltiples clicks)
unsigned long lastButtonPress = 0;
const int DEBOUNCE_DELAY = 1000; // 1 segundo entre pulsaciones

// ---------------- OBJETOS DE RED ----------------
WiFiClientSecure espClient;
PubSubClient client(espClient);

// ---------------- FUNCIONES AUXILIARES ----------------

void syncTime() {
  Serial.print("Sincronizando reloj NTP");
  configTime(0, 0, "pool.ntp.org", "time.nist.gov"); 
  time_t now = time(nullptr);
  while (now < 1000000000l) {
    delay(500);
    Serial.print(".");
    now = time(nullptr);
  }
  Serial.println("\nReloj sincronizado.");
}

String generateSasToken() {
    time_t now = time(nullptr);
    time_t expiry = now + 3600; 
    String stringToSign = String(iothub_hostname) + "%2Fdevices%2F" + String(device_id) + "\n" + String(expiry);
    
    size_t keyLen = strlen(device_key);
    byte decodedKey[32]; size_t decodedLen;
    mbedtls_base64_decode(decodedKey, 32, &decodedLen, (const unsigned char*)device_key, keyLen);
    
    byte hmac[32];
    mbedtls_md_context_t ctx;
    mbedtls_md_init(&ctx);
    mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1);
    mbedtls_md_hmac_starts(&ctx, decodedKey, decodedLen);
    mbedtls_md_hmac_update(&ctx, (const unsigned char*)stringToSign.c_str(), stringToSign.length());
    mbedtls_md_hmac_finish(&ctx, hmac);
    mbedtls_md_free(&ctx);
    
    char signature[64]; size_t sigLen;
    mbedtls_base64_encode((unsigned char*)signature, 64, &sigLen, hmac, 32);
    String sigStr = String(signature);
    
    String encodedSig = "";
    for (int i = 0; i < sigStr.length(); i++) {
        char c = sigStr.charAt(i);
        if (isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') encodedSig += c;
        else { char code[5]; sprintf(code, "%%%02X", c); encodedSig += code; }
    }
    return "SharedAccessSignature sr=" + String(iothub_hostname) + "%2Fdevices%2F" + String(device_id) + "&sig=" + encodedSig + "&se=" + String(expiry);
}

String getIsoTime() {
  time_t now = time(nullptr);
  struct tm* timeinfo = gmtime(&now); 
  char buffer[30];
  strftime(buffer, 30, "%Y-%m-%dT%H:%M:%SZ", timeinfo);
  return String(buffer);
}

String getDateOnly() {
  time_t now = time(nullptr);
  struct tm* timeinfo = gmtime(&now);
  char buffer[15];
  strftime(buffer, 15, "%Y-%m-%d", timeinfo);
  return String(buffer);
}

// --- NUEVO: FUNCIÓN PARA LLAMAR AL API DESDE LOS BOTONES ---
void callApi(String endpoint) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    WiFiClientSecure *apiClient = new WiFiClientSecure;
    apiClient->setInsecure(); // Saltar validación SSL para agilizar pruebas
    
    String url = String(api_base_url) + endpoint;
    Serial.println("\n[BOTON] Llamando a API: " + url);
    
    http.begin(*apiClient, url);
    http.addHeader("Content-Type", "application/json");
    
    // Enviamos el turno actual en el body
    String payload = "{\"shift\":\"" + currentShift + "\"}";
    
    int httpResponseCode = http.POST(payload);
    
    if (httpResponseCode > 0) {
      Serial.println("[API] Solicitud enviada (Codigo: " + String(httpResponseCode) + "). Esperando orden de Azure...");
    } else {
      Serial.println("[API] Error: " + String(httpResponseCode));
    }
    
    http.end();
    delete apiClient;
  } else {
    Serial.println("[API] Error: Sin WiFi");
  }
}

// ---------------- LÓGICA PRINCIPAL ----------------

void sendTelemetry(String controlEvent, String boxSize) {
  if (controlEvent == "" && boxSize == "") return;

  StaticJsonDocument<512> doc;
  doc["deviceId"] = device_id;
  doc["date"] = getDateOnly();
  doc["shift"] = currentShift;
  doc["boxSize"] = boxSize; 
  doc["isRunning"] = isRunning;
  
  if (controlEvent != "") doc["eventType"] = controlEvent;
  else doc["eventType"] = (char*)NULL; 

  doc["timestamp"] = getIsoTime(); 

  char jsonBuffer[512];
  serializeJson(doc, jsonBuffer);

  // Serial.println("DEBUG JSON: " + String(jsonBuffer)); // Descomentar para debug
  client.publish(publishTopic.c_str(), jsonBuffer);
  
  // Log visual para nosotros
  String logMsg = (controlEvent != "") ? controlEvent : ("CAJA " + boxSize);
  Serial.println(">>> TELEMETRÍA ENVIADA: " + logMsg);
}

void callback(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for (int i = 0; i < length; i++) msg += (char)payload[i];
  
  // Serial.println("\n[C2D] Raw: " + msg); 

  StaticJsonDocument<512> doc;
  DeserializationError error = deserializeJson(doc, msg);
  
  if (error) { Serial.println("Error JSON"); return; }

  const char* cmdRaw = doc["command"] | doc["Command"];
  String command = cmdRaw ? String(cmdRaw) : "";
  command.toUpperCase();

  if (command == "START") {
    isRunning = true;
    digitalWrite(MOTOR_PIN, HIGH);
    Serial.println(">>> [AZURE CMD] START -> MOTOR ON");
    sendTelemetry("START", "");
  }
  else if (command == "STOP") {
    isRunning = false;
    digitalWrite(MOTOR_PIN, LOW);
    Serial.println(">>> [AZURE CMD] STOP -> MOTOR OFF");
    sendTelemetry("STOP", "");
  }
  else if (command == "RESTART") {
    isRunning = true;
    digitalWrite(MOTOR_PIN, HIGH);
    boxDetected = false; // Resetear sensores
    Serial.println(">>> [AZURE CMD] RESTART");
    sendTelemetry("RESTART", "");
  }
  else if (command == "SHIFT_CHANGE") {
    const char* shiftRaw = doc["shift"] | doc["Shift"];
    if (shiftRaw) {
      currentShift = String(shiftRaw);
      Serial.println(">>> [AZURE CMD] CAMBIO TURNO: " + currentShift);
    }
  }
}

void reconnect() {
  while (!client.connected()) {
    Serial.print("Conectando a Azure MQTT...");
    String username = String(iothub_hostname) + "/" + String(device_id) + "/?api-version=2021-04-12";
    String sas = generateSasToken();

    if (client.connect(device_id, username.c_str(), sas.c_str())) {
      Serial.println(" ¡Conectado!");
      client.subscribe(subscribeTopic.c_str());
    } else {
      Serial.print(" Fallo rc=" + String(client.state()) + " reintento en 5s...");
      delay(5000);
    }
  }
}

void setup() {
  Serial.begin(115200);

  // Configuración de Sensores
  pinMode(SMALL_SENSOR_PIN, INPUT);
  pinMode(MEDIUM_SENSOR_PIN, INPUT);
  pinMode(LARGE_SENSOR_PIN, INPUT);
  
  // Motor
  pinMode(MOTOR_PIN, OUTPUT);
  digitalWrite(MOTOR_PIN, LOW);

  // --- NUEVO: Configuración de Botones ---
  // INPUT_PULLUP significa que el botón conecta a GND para activarse (LOW)
  pinMode(BTN_START_PIN, INPUT_PULLUP);
  pinMode(BTN_STOP_PIN, INPUT_PULLUP);
  pinMode(BTN_RESTART_PIN, INPUT_PULLUP);

  // WiFi
  Serial.printf("\nConectando a WiFi: %s ", ssid);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println(" OK");

  // Azure
  syncTime(); 
  espClient.setInsecure(); 
  client.setServer(iothub_hostname, 8883);
  client.setCallback(callback);
  client.setBufferSize(1024); 
}

void loop() {
  if (!client.connected()) reconnect();
  client.loop(); 

  // --- 1. LÓGICA DE BOTONES (REQUEST A API) ---
  if (millis() - lastButtonPress > DEBOUNCE_DELAY) {
    if (digitalRead(BTN_START_PIN) == LOW) {
      callApi("/api/control/start");
      lastButtonPress = millis();
    }
    else if (digitalRead(BTN_STOP_PIN) == LOW) {
      callApi("/api/control/stop");
      lastButtonPress = millis();
    }
    else if (digitalRead(BTN_RESTART_PIN) == LOW) {
      callApi("/api/control/restart");
      lastButtonPress = millis();
    }
  }

  // --- 2. LÓGICA DE SENSORES JERÁRQUICA ---
  if (isRunning) {
    // Leemos el estado actual de los sensores
    int sSmall = digitalRead(SMALL_SENSOR_PIN);
    int sMed = digitalRead(MEDIUM_SENSOR_PIN);
    int sLarge = digitalRead(LARGE_SENSOR_PIN);

    // Si NO hay caja detectada actualmente Y alguno de los sensores se activa...
    if (!boxDetected && (sSmall == HIGH || sMed == HIGH || sLarge == HIGH)) {
      
      // ESTABILIZACIÓN:
      // Esperamos 300ms para que la caja avance y tape correctamente todos los sensores que le corresponden.
      // (Ej. Una caja grande primero toca el de abajo, luego el del medio, luego el de arriba).
      delay(300); 

      // LEEMOS DE NUEVO para confirmar el tamaño real
      sSmall = digitalRead(SMALL_SENSOR_PIN);
      sMed = digitalRead(MEDIUM_SENSOR_PIN);
      sLarge = digitalRead(LARGE_SENSOR_PIN);

      // JERARQUÍA (De arriba hacia abajo)
      if (sLarge == HIGH) {
         Serial.println(">>> SENSOR: CAJA GRANDE DETECTADA");
         sendTelemetry("", "large");
      } 
      else if (sMed == HIGH) {
         Serial.println(">>> SENSOR: CAJA MEDIANA DETECTADA");
         sendTelemetry("", "medium");
      } 
      else if (sSmall == HIGH) {
         Serial.println(">>> SENSOR: CAJA PEQUEÑA DETECTADA");
         sendTelemetry("", "small");
      }

      // Marcamos que hay una caja pasando para no contarla doble
      boxDetected = true; 
    }

    // RESETEO:
    // Solo permitimos detectar otra caja cuando todos los sensores vuelven a estar libres (LOW)
    if (boxDetected && sSmall == LOW && sMed == LOW && sLarge == LOW) {
      boxDetected = false;
      delay(100); // Pequeño delay de seguridad
    }
  }
}