#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <HTTPClient.h> 
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
const int SMALL_SENSOR_PIN = 34;
const int MEDIUM_SENSOR_PIN = 25;
const int LARGE_SENSOR_PIN = 32;

// --- CONFIGURACIÓN MOTOR ---
const int MOTOR_PIN_1 = 26; 
const int MOTOR_PIN_2 = 13; 

// --- PINES DE BOTONES (Conectar a GND) ---
const int BTN_START_PIN = 27;
const int BTN_STOP_PIN = 14;
const int BTN_RESTART_PIN = 21;

// ---------------- VARIABLES GLOBALES ----------------
bool isRunning = false;
String currentShift = "manana"; 
bool boxDetected = false; 

unsigned long lastButtonPress = 0;
const int DEBOUNCE_DELAY = 1000; 

// TIEMPO DE ESCANEO (Ajustar según velocidad de faja)
const int SENSOR_SAMPLE_TIME = 600; 

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

void setMotorState(bool state) {
    if (state) {
        digitalWrite(MOTOR_PIN_1, HIGH);
        digitalWrite(MOTOR_PIN_2, LOW);
    } else {
        digitalWrite(MOTOR_PIN_1, LOW);
        digitalWrite(MOTOR_PIN_2, LOW);
    }
}

void callApi(String endpoint) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    WiFiClientSecure *apiClient = new WiFiClientSecure;
    apiClient->setInsecure(); 
    
    String url = String(api_base_url) + endpoint;
    Serial.println("\n[BOTON] Llamando a API: " + url);
    
    http.begin(*apiClient, url);
    http.addHeader("Content-Type", "application/json");
    
    String payload = "{\"shift\":\"" + currentShift + "\"}";
    
    int httpResponseCode = http.POST(payload);
    
    if (httpResponseCode > 0) {
      Serial.println("[API] Solicitud enviada (Codigo: " + String(httpResponseCode) + ").");
    } else {
      Serial.println("[API] Error: " + String(httpResponseCode));
    }
    
    http.end();
    delete apiClient;
  }
}

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

  client.publish(publishTopic.c_str(), jsonBuffer);
  String logMsg = (controlEvent != "") ? controlEvent : ("CAJA " + boxSize);
  Serial.println(">>> TELEMETRÍA: " + logMsg);
}

void callback(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for (int i = 0; i < length; i++) msg += (char)payload[i];
  
  StaticJsonDocument<512> doc;
  DeserializationError error = deserializeJson(doc, msg);
  
  if (error) { Serial.println("Error JSON"); return; }

  const char* cmdRaw = doc["command"] | doc["Command"];
  String command = cmdRaw ? String(cmdRaw) : "";
  command.toUpperCase();

  if (command == "START") {
    isRunning = true;
    setMotorState(true);
    sendTelemetry("START", "");
  }
  else if (command == "STOP") {
    isRunning = false;
    setMotorState(false); 
    sendTelemetry("STOP", "");
  }
  else if (command == "RESTART") {
    isRunning = true;
    setMotorState(true); 
    boxDetected = false; 
    sendTelemetry("RESTART", "");
  }
  else if (command == "SHIFT_CHANGE") {
    const char* shiftRaw = doc["shift"] | doc["Shift"];
    if (shiftRaw) {
      currentShift = String(shiftRaw);
      Serial.println(">>> CAMBIO TURNO: " + currentShift);
    }
  }
}

void reconnect() {
  while (!client.connected()) {
    Serial.print("Conectando a Azure...");
    String username = String(iothub_hostname) + "/" + String(device_id) + "/?api-version=2021-04-12";
    String sas = generateSasToken();

    if (client.connect(device_id, username.c_str(), sas.c_str())) {
      Serial.println(" ¡OK!");
      client.subscribe(subscribeTopic.c_str());
    } else {
      delay(5000);
    }
  }
}

void setup() {
  Serial.begin(115200);

  // --- CONFIGURACIÓN FC-51 (Lógica Inversa) ---
  // INPUT_PULLUP mantiene la señal en HIGH (1) cuando no hay obstáculos.
  // Cuando el sensor ve algo, baja la señal a LOW (0).
  pinMode(SMALL_SENSOR_PIN, INPUT_PULLUP);
  pinMode(MEDIUM_SENSOR_PIN, INPUT_PULLUP);
  pinMode(LARGE_SENSOR_PIN, INPUT_PULLUP);
  
  pinMode(MOTOR_PIN_1, OUTPUT);
  pinMode(MOTOR_PIN_2, OUTPUT);
  setMotorState(false); 

  pinMode(BTN_START_PIN, INPUT_PULLUP);
  pinMode(BTN_STOP_PIN, INPUT_PULLUP);
  pinMode(BTN_RESTART_PIN, INPUT_PULLUP);

  Serial.printf("\nWiFi: %s ", ssid);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println(" OK");

  syncTime(); 
  espClient.setInsecure(); 
  client.setServer(iothub_hostname, 8883);
  client.setCallback(callback);
}

void loop() {
  if (!client.connected()) reconnect();
  client.loop(); 

  // --- BOTONES ---
  if (millis() - lastButtonPress > DEBOUNCE_DELAY) {
    if (digitalRead(BTN_START_PIN) == LOW) { callApi("/api/control/start"); lastButtonPress = millis(); }
    else if (digitalRead(BTN_STOP_PIN) == LOW) { callApi("/api/control/stop"); lastButtonPress = millis(); }
    else if (digitalRead(BTN_RESTART_PIN) == LOW) { callApi("/api/control/restart"); lastButtonPress = millis(); }
  }

  // --- LÓGICA DE SENSORES FC-51 (DETECTA CON LOW) ---
  if (isRunning) {
    
    // FC-51 envía LOW (0) cuando detecta obstáculo
    int nowSmall = digitalRead(SMALL_SENSOR_PIN);
    int nowMed = digitalRead(MEDIUM_SENSOR_PIN);
    int nowLarge = digitalRead(LARGE_SENSOR_PIN);

    // TRIGGER: Si cualquiera está en LOW (detectando)
    if (!boxDetected && (nowSmall == LOW || nowMed == LOW || nowLarge == LOW)) {
      
      Serial.println("\n>>> OBJETO ENTRANDO! Iniciando escaneo...");
      
      bool foundLarge = false;
      bool foundMedium = false;
      bool foundSmall = false;

      unsigned long start = millis();
      
      // VENTANA DE MUESTREO
      while(millis() - start < SENSOR_SAMPLE_TIME) {
        client.loop(); 

        // Leemos nuevamente dentro del bucle
        if (digitalRead(LARGE_SENSOR_PIN) == LOW) foundLarge = true;
        if (digitalRead(MEDIUM_SENSOR_PIN) == LOW) foundMedium = true;
        if (digitalRead(SMALL_SENSOR_PIN) == LOW) foundSmall = true;

        // DIAGNÓSTICO VISUAL (Para verificar calibración)
        // Verás letras minúsculas si detecta
        if (digitalRead(SMALL_SENSOR_PIN) == LOW) Serial.print("s");
        if (digitalRead(MEDIUM_SENSOR_PIN) == LOW) Serial.print("M");
        if (digitalRead(LARGE_SENSOR_PIN) == LOW) Serial.print("L");

        delay(10); 
      }
      Serial.println(""); 

      // DECISIÓN
      if (foundLarge) {
          Serial.println(">>> FINAL: CAJA GRANDE");
          sendTelemetry("", "large");
      } 
      else if (foundMedium) {
          Serial.println(">>> FINAL: CAJA MEDIANA");
          sendTelemetry("", "medium");
      } 
      else if (foundSmall) {
          Serial.println(">>> FINAL: CAJA PEQUEÑA");
          sendTelemetry("", "small");
      } else {
          Serial.println(">>> ERROR: Falsa alarma (ruido).");
      }
      
      boxDetected = true; 
    }

    // SALIDA: Esperamos a que TODOS vuelvan a HIGH (Sin obstáculo)
    if (boxDetected) {
       if (digitalRead(SMALL_SENSOR_PIN) == HIGH && 
           digitalRead(MEDIUM_SENSOR_PIN) == HIGH && 
           digitalRead(LARGE_SENSOR_PIN) == HIGH) {
           
           delay(200); 
           // Doble chequeo
           if (digitalRead(SMALL_SENSOR_PIN) == HIGH) {
             boxDetected = false;
             Serial.println(">>> ZONA LIBRE.");
           }
       }
    }
  }
}