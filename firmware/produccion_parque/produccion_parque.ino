/* =====================================================================
   nodo_parque_s3.ino

   Parque Ambiental Municipal de Berisso
   Nodo físico: NODO-INV-N-01

   PLACA
   ESP32-S3-Zero

   ARDUINO IDE
   Placa: ESP32S3 Dev Module
   USB CDC On Boot: Enabled

   CONEXIONES QUE VA A USAR ESTE FIRMWARE
   DHT11         -> GPIO 5
   Relé          -> GPIO 6
   Buzzer activo -> GPIO 7
   Botón         -> GPIO 10

   IMPORTANTE
   Este firmware NO usa GPIO 19 ni GPIO 20 porque están asociados
   al USB nativo del ESP32-S3.

   Tampoco usamos LED interno. El estado se controla por Monitor Serie.

   La lógica de temperatura y humedad NO vive acá.
   El servidor recibe las lecturas, compara contra los umbrales
   y responde si hay que activar relé o alarma.
   ===================================================================== */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <time.h>

/* =====================================================================
   CONFIGURACIÓN — COMPLETAR ESTOS DATOS
   ===================================================================== */

// Wi-Fi
const char* WIFI_SSID = "NEXO";
const char* WIFI_PASS = "hola1234";

// Servidor
// Ejemplo:
// https://tu-proyecto.vercel.app/api/ingest
const char* SERVIDOR = "https://parque-ambiental.vercel.app/api/ingest";


// Tiene que ser exactamente la misma DEVICE_KEY configurada en Vercel.
const char* DEVICE_KEY = "lpxv721";

// Identidad del nodo
const char* DISPOSITIVO = "NODO-INV-N-01";
const char* AREA = "INV-N";

/* =====================================================================
   AJUSTES DE LOS MÓDULOS
   ===================================================================== */

// Muchos módulos KY-019 se activan poniendo la señal en LOW.
// Si el relé después funciona al revés, cambiar true por false.
const bool RELE_ACTIVO_EN_BAJO = true;

// El botón del proyecto queda normalmente en HIGH y al apretarlo pasa a LOW.
// Si después funciona invertido, cambiar true por false.
const bool BOTON_ACTIVO_EN_BAJO = true;

// El buzzer activo normalmente suena con HIGH.
// Si funciona invertido, cambiar false por true.
const bool BUZZER_ACTIVO_EN_BAJO = false;

/* =====================================================================
   PINES — ESP32-S3-ZERO
   ===================================================================== */

const int PIN_DHT = 5;
const int PIN_RELE = 6;
const int PIN_BUZZER = 7;
const int PIN_BOTON = 10;

/* =====================================================================
   TIEMPOS
   ===================================================================== */

const unsigned long INTERVALO_MS = 10000;

const unsigned long ANTIRREBOTE_MS = 50;
const unsigned long PULSACION_LARGA_MS = 2000;

const unsigned long BUZZER_PULSO_MS = 200;
const unsigned long BUZZER_PERIODO_MS = 2000;

const unsigned long WIFI_TIMEOUT_MS = 20000;

const uint16_t HTTP_TIMEOUT_MS = 6000;

/* =====================================================================
   DHT11
   ===================================================================== */

const int DHT_TIPO = DHT11;

DHT dht(PIN_DHT, DHT_TIPO);

/* =====================================================================
   HORA
   Argentina UTC-3
   ===================================================================== */

const long ZONA_HORARIA_SEG = -3 * 3600;

/* =====================================================================
   ESTADO DE LAS LECTURAS
   ===================================================================== */

float ultimaTemp = 0.0;
float ultimaHum = 0.0;

bool hayLecturaValida = false;

/* =====================================================================
   ESTADO DEL SERVIDOR
   ===================================================================== */

bool releEncendido = false;
bool alarmaActiva = false;

/* =====================================================================
   ESTADO DEL BOTÓN
   ===================================================================== */

String botonPendiente = "NINGUNO";

bool lecturaCrudaAnterior = false;
bool botonEstable = false;

unsigned long ultimoRebote = 0;
unsigned long inicioPulsacion = 0;

bool emergenciaYaDisparada = false;
bool envioInmediato = false;

/* =====================================================================
   ESTADO DEL BUZZER
   ===================================================================== */

bool buzzerSonando = false;
unsigned long buzzerCambioMs = 0;

/* =====================================================================
   ESTADO DEL WI-FI
   ===================================================================== */

bool wifiIntentando = false;
bool wifiEstuvoConectado = false;

unsigned long wifiInicioIntento = 0;

bool horaSincronizada = false;

/* =====================================================================
   CICLO DE ENVÍO
   ===================================================================== */

unsigned long ultimoEnvioMs = 0;

/* =====================================================================
   RELÉ
   ===================================================================== */

void aplicarRele(bool encendido) {
  int nivel;

  if (RELE_ACTIVO_EN_BAJO) {
    nivel = encendido ? LOW : HIGH;
  } else {
    nivel = encendido ? HIGH : LOW;
  }

  digitalWrite(PIN_RELE, nivel);
}

/* =====================================================================
   BUZZER
   ===================================================================== */

void aplicarBuzzer(bool sonando) {
  int nivel;

  if (BUZZER_ACTIVO_EN_BAJO) {
    nivel = sonando ? LOW : HIGH;
  } else {
    nivel = sonando ? HIGH : LOW;
  }

  digitalWrite(PIN_BUZZER, nivel);
}

/* =====================================================================
   HORA PARA MONITOR SERIE
   ===================================================================== */

String marcaDeTiempo() {
  char buffer[16];

  if (horaSincronizada) {
    struct tm ahora;

    if (getLocalTime(&ahora, 50)) {
      snprintf(
        buffer,
        sizeof(buffer),
        "%02d:%02d:%02d",
        ahora.tm_hour,
        ahora.tm_min,
        ahora.tm_sec
      );

      return String(buffer);
    }
  }

  unsigned long segundos = millis() / 1000UL;

  snprintf(
    buffer,
    sizeof(buffer),
    "%02lu:%02lu:%02lu",
    (segundos / 3600UL) % 100UL,
    (segundos / 60UL) % 60UL,
    segundos % 60UL
  );

  return String(buffer);
}

/* =====================================================================
   WI-FI

   No reinicia la placa si se cae internet.
   Intenta reconectar automáticamente.
   ===================================================================== */

void atenderWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    if (wifiIntentando || !wifiEstuvoConectado) {
      wifiIntentando = false;
      wifiEstuvoConectado = true;

      Serial.print("[");
      Serial.print(marcaDeTiempo());
      Serial.print("] Wi-Fi conectado | IP=");
      Serial.print(WiFi.localIP());
      Serial.print(" | senal=");
      Serial.print(WiFi.RSSI());
      Serial.println(" dBm");

      configTime(
        ZONA_HORARIA_SEG,
        0,
        "pool.ntp.org",
        "time.nist.gov"
      );

      struct tm prueba;
      horaSincronizada = getLocalTime(&prueba, 3000);
    }

    return;
  }

  if (wifiEstuvoConectado) {
    wifiEstuvoConectado = false;

    Serial.print("[");
    Serial.print(marcaDeTiempo());
    Serial.println("] Wi-Fi caido. Intentando reconectar.");
  }

  if (!wifiIntentando) {
    WiFi.disconnect(true);

    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);
    WiFi.setAutoReconnect(true);

    WiFi.begin(WIFI_SSID, WIFI_PASS);

    wifiIntentando = true;
    wifiInicioIntento = millis();

    Serial.print("[");
    Serial.print(marcaDeTiempo());
    Serial.print("] Conectando a Wi-Fi: ");
    Serial.println(WIFI_SSID);

    return;
  }

  if (millis() - wifiInicioIntento >= WIFI_TIMEOUT_MS) {
    wifiIntentando = false;

    Serial.print("[");
    Serial.print(marcaDeTiempo());
    Serial.println("] No conecto en 20 segundos. Reintentando.");
  }
}

/* =====================================================================
   BOTÓN

   Pulsación corta:
   NORMAL

   Pulsación de 2 segundos o más:
   EMERGENCIA

   Sin delay().
   ===================================================================== */

void atenderBoton() {
  int lectura = digitalRead(PIN_BOTON);

  bool presionadoAhora;

  if (BOTON_ACTIVO_EN_BAJO) {
    presionadoAhora = (lectura == LOW);
  } else {
    presionadoAhora = (lectura == HIGH);
  }

  if (presionadoAhora != lecturaCrudaAnterior) {
    lecturaCrudaAnterior = presionadoAhora;
    ultimoRebote = millis();

    return;
  }

  if (millis() - ultimoRebote < ANTIRREBOTE_MS) {
    return;
  }

  if (presionadoAhora != botonEstable) {
    botonEstable = presionadoAhora;

    if (botonEstable) {
      inicioPulsacion = millis();
      emergenciaYaDisparada = false;
    } else {
      if (!emergenciaYaDisparada) {
        botonPendiente = "NORMAL";

        Serial.print("[");
        Serial.print(marcaDeTiempo());
        Serial.println(
          "] Boton corto: solicitud NORMAL pendiente."
        );
      }
    }
  }

  if (
    botonEstable &&
    !emergenciaYaDisparada &&
    millis() - inicioPulsacion >= PULSACION_LARGA_MS
  ) {
    emergenciaYaDisparada = true;

    botonPendiente = "EMERGENCIA";
    envioInmediato = true;

    Serial.print("[");
    Serial.print(marcaDeTiempo());
    Serial.println(
      "] BOTON EMERGENCIA: envio inmediato."
    );
  }
}

/* =====================================================================
   BUZZER

   Mientras haya alarma:
   bip de 200 ms cada 2 segundos.
   ===================================================================== */

void atenderBuzzer() {
  if (!alarmaActiva) {
    if (buzzerSonando) {
      buzzerSonando = false;
      aplicarBuzzer(false);
    }

    return;
  }

  unsigned long ahora = millis();

  if (buzzerSonando) {
    if (ahora - buzzerCambioMs >= BUZZER_PULSO_MS) {
      buzzerSonando = false;
      buzzerCambioMs = ahora;

      aplicarBuzzer(false);
    }
  } else {
    if (
      ahora - buzzerCambioMs >=
      BUZZER_PERIODO_MS - BUZZER_PULSO_MS
    ) {
      buzzerSonando = true;
      buzzerCambioMs = ahora;

      aplicarBuzzer(true);
    }
  }
}

/* =====================================================================
   LÍNEA DEL MONITOR SERIE
   ===================================================================== */

void imprimirLinea(
  float temp,
  float hum,
  bool wifiOk,
  const char* nota
) {
  Serial.print("[");
  Serial.print(marcaDeTiempo());
  Serial.print("] T=");

  if (isnan(temp)) {
    Serial.print("--");
  } else {
    Serial.print(temp, 1);
  }

  Serial.print(" H=");

  if (isnan(hum)) {
    Serial.print("--");
  } else {
    Serial.print(hum, 1);
  }

  Serial.print(" | rele=");
  Serial.print(releEncendido ? "ON" : "OFF");

  Serial.print(" alarma=");
  Serial.print(alarmaActiva ? "ON" : "OFF");

  Serial.print(" | wifi=");
  Serial.print(wifiOk ? "OK" : "CAIDO");

  if (nota != nullptr) {
    Serial.print(" | ");
    Serial.print(nota);
  }

  Serial.println();
}

/* =====================================================================
   ENVÍO HTTPS AL SERVIDOR
   ===================================================================== */

void enviarLectura(
  float temp,
  float hum,
  const char* nota
) {
  if (WiFi.status() != WL_CONNECTED) {
    imprimirLinea(
      temp,
      hum,
      false,
      "sin envio: Wi-Fi caido"
    );

    return;
  }

  WiFiClientSecure cliente;

  /*
     Para el prototipo usamos setInsecure().

     HTTPS sigue cifrando la comunicación, pero no validamos
     el certificado del servidor.

     En producción real corresponde instalar la CA correcta.
  */
  cliente.setInsecure();

  HTTPClient http;

  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);

  if (!http.begin(cliente, SERVIDOR)) {
    imprimirLinea(
      temp,
      hum,
      true,
      "no se pudo abrir HTTPS"
    );

    return;
  }

  http.addHeader(
    "Content-Type",
    "application/json"
  );

  http.addHeader(
    "x-device-key",
    DEVICE_KEY
  );

  JsonDocument cuerpo;

  cuerpo["dispositivo"] = DISPOSITIVO;
  cuerpo["area"] = AREA;

  if (isnan(temp)) {
    cuerpo["temperatura"] = nullptr;
  } else {
    cuerpo["temperatura"] = temp;
  }

  if (isnan(hum)) {
    cuerpo["humedad"] = nullptr;
  } else {
    cuerpo["humedad"] = hum;
  }

  cuerpo["boton"] = botonPendiente;

  String json;

  serializeJson(cuerpo, json);

  Serial.print("[");
  Serial.print(marcaDeTiempo());
  Serial.print("] POST ");
  Serial.println(SERVIDOR);

  int codigo = http.POST(json);

  if (codigo == 200) {
    String respuesta = http.getString();

    JsonDocument datos;

    DeserializationError fallo =
      deserializeJson(datos, respuesta);

    if (fallo) {
      imprimirLinea(
        temp,
        hum,
        true,
        "respuesta del servidor ilegible"
      );
    } else {
      releEncendido =
        datos["rele"] | false;

      alarmaActiva =
        datos["alarma"] | false;

      aplicarRele(releEncendido);

      if (botonPendiente != "NINGUNO") {
        Serial.print("[");
        Serial.print(marcaDeTiempo());
        Serial.print("] Boton ");
        Serial.print(botonPendiente);
        Serial.println(
          " recibido por el servidor."
        );

        botonPendiente = "NINGUNO";
      }

      imprimirLinea(
        temp,
        hum,
        true,
        nota
      );
    }
  }

  else if (codigo == 401) {
    imprimirLinea(
      temp,
      hum,
      true,
      "HTTP 401: DEVICE_KEY incorrecta"
    );
  }

  else if (codigo == 404) {
    imprimirLinea(
      temp,
      hum,
      true,
      "HTTP 404"
    );
  }

  else if (codigo > 0) {
    String aviso =
      String("HTTP ") + String(codigo);

    imprimirLinea(
      temp,
      hum,
      true,
      aviso.c_str()
    );
  }

  else {
    String aviso =
      String("fallo de red: ") +
      http.errorToString(codigo);

    imprimirLinea(
      temp,
      hum,
      true,
      aviso.c_str()
    );
  }

  http.end();
}

/* =====================================================================
   MEDICIÓN DHT11
   ===================================================================== */

void medirYEnviar() {
  float temp = dht.readTemperature();
  float hum = dht.readHumidity();

  const char* nota = nullptr;

  if (isnan(temp) || isnan(hum)) {
    Serial.print("[");
    Serial.print(marcaDeTiempo());
    Serial.println(
      "] DHT11 devolvio nan."
    );

    if (hayLecturaValida) {
      temp = ultimaTemp;
      hum = ultimaHum;

      nota =
        "DHT fallo: se reenvia ultima lectura valida";
    }

    else if (botonPendiente != "NINGUNO") {
      enviarLectura(
        NAN,
        NAN,
        "sin DHT: se envia solamente boton"
      );

      return;
    }

    else {
      Serial.print("[");
      Serial.print(marcaDeTiempo());
      Serial.println(
        "] Todavia no hay lectura valida."
      );

      return;
    }
  }

  else {
    ultimaTemp = temp;
    ultimaHum = hum;

    hayLecturaValida = true;
  }

  enviarLectura(
    temp,
    hum,
    nota
  );
}

/* =====================================================================
   SETUP
   ===================================================================== */

void setup() {
  Serial.begin(115200);

  /*
     Ponemos las salidas en un estado seguro antes
     de empezar Wi-Fi o leer sensores.
  */

  pinMode(
    PIN_RELE,
    OUTPUT
  );

  aplicarRele(false);

  pinMode(
    PIN_BUZZER,
    OUTPUT
  );

  aplicarBuzzer(false);

  /*
     El botón utiliza la resistencia interna de la ESP32-S3.
  */

  if (BOTON_ACTIVO_EN_BAJO) {
    pinMode(
      PIN_BOTON,
      INPUT_PULLUP
    );
  } else {
    pinMode(
      PIN_BOTON,
      INPUT_PULLDOWN
    );
  }

  dht.begin();

  /*
     El USB serie nativo puede tardar un momento
     después del arranque.
  */

  unsigned long esperaSerie = millis();

  while (
    !Serial &&
    millis() - esperaSerie < 2000
  ) {
    // Espera limitada.
  }

  Serial.println();
  Serial.println(
    "============================================"
  );

  Serial.println(
    " Parque Ambiental Municipal de Berisso"
  );

  Serial.println(
    " ESP32-S3-Zero"
  );

  Serial.print(
    " Nodo: "
  );

  Serial.println(
    DISPOSITIVO
  );

  Serial.print(
    " Area: "
  );

  Serial.println(
    AREA
  );

  Serial.print(
    " Servidor: "
  );

  Serial.println(
    SERVIDOR
  );

  Serial.println(
    " Pines: DHT=5 RELE=6 BUZZER=7 BOTON=10"
  );

  Serial.println(
    "============================================"
  );

  WiFi.mode(
    WIFI_STA
  );

  WiFi.setSleep(
    false
  );

  /*
     Hace que intente mandar una lectura
     prácticamente al arrancar.
  */

  ultimoEnvioMs =
    millis() - INTERVALO_MS;
}

/* =====================================================================
   LOOP
   ===================================================================== */

void loop() {
  atenderWiFi();

  atenderBoton();

  atenderBuzzer();

  bool tocaPorTiempo =
    millis() - ultimoEnvioMs >=
    INTERVALO_MS;

  if (
    envioInmediato ||
    tocaPorTiempo
  ) {
    envioInmediato = false;

    ultimoEnvioMs =
      millis();

    medirYEnviar();
  }
}