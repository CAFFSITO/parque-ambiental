# 02 — Contrato ACTUAL del firmware del nodo

Fuente única: `firmware/produccion_parque/produccion_parque.ino`, leído entero
(861 líneas). Encabezado del archivo: proyecto **NEXO — ROOTBOX**, nodo físico
`NODO-INV-N-01`, placa **ESP32-S3-Zero** (`:4-6`), compilado desde Arduino IDE
como "ESP32S3 Dev Module" con "USB CDC On Boot: Enabled" (`:8-10`).

Aviso: este archivo figura como **modificado y sin commitear** en `git status`.
Lo auditado es el árbol de trabajo.

---

## 1. Constantes reales

### 1.1 Identidad y red

| Constante | Valor literal | Línea |
|---|---|---|
| `WIFI_SSID` | `"NEXO"` | `:50` |
| `WIFI_PASS` | (credencial en claro en el repositorio) | `:51` |
| `SERVIDOR` | `"https://parque-ambiental.vercel.app/api/ingest"` | `:54` |
| `DEVICE_KEY` | (clave en claro en el repositorio, 7 caracteres) | `:57` |
| `DISPOSITIVO` | `"NODO-INV-N-01"` | `:60` |
| `AREA_COMPATIBILIDAD` | `"INV-N"` | `:64` |

`SERVIDOR` apunta a **producción**, con la ruta completa incrustada. No hay
variable de entorno, ni configuración por serie, ni portal de aprovisionamiento:
cambiar de dominio o de ruta exige recompilar y reflashear.

`AREA_COMPATIBILIDAD` está declarada explícitamente como muleta: el comentario
de `:62-63` dice "Compatibilidad temporal con el backend actual. El backend
nuevo debe determinar el area desde la base de datos", y el encabezado repite lo
mismo en `:25-27`. Hoy el backend **no** lo hace (ver `01-contrato-ingest.md`
§6).

### 1.2 Tiempos

| Constante | Valor | Línea | Qué controla |
|---|---|---|---|
| `INTERVALO_MS` | `10000` (10 s) | `:93` | período de reporte |
| `ANTIRREBOTE_MS` | `50` | `:95` | filtro del botón |
| `PULSACION_LARGA_MS` | `2000` (2 s) | `:96` | umbral NORMAL vs EMERGENCIA |
| `BUZZER_PULSO_MS` | `200` | `:98` | duración del pitido |
| `BUZZER_PERIODO_MS` | `2000` | `:99` | período del pitido |
| `WIFI_TIMEOUT_MS` | `20000` (20 s) | `:101` | reintento de asociación Wi-Fi |
| `HTTP_TIMEOUT_MS` | `6000` (6 s) | `:102` | connect timeout **y** read timeout (`:527-528`) |
| `SERVIDOR_FAILSAFE_MS` | `45000` (45 s) | `:105` | apagado seguro del relé |
| `ZONA_HORARIA_SEG` | `-3 * 3600` | `:119` | solo para el monitor serie |

`INTERVALO_MS = 10 s` es la constante que hay que cruzar con
`SEGUNDOS_SIN_SENAL = 90` del servidor (`lib/alertas.ts:18`): ver
`03-riesgos.md`, riesgo R5.

---

## 2. Pines y polaridades verificadas

Declaración (`:84-87`):

| Pin | GPIO | Uso |
|---|---|---|
| `PIN_DHT` | 5 | DHT11 |
| `PIN_RELE` | 6 | relé |
| `PIN_BUZZER` | 7 | **buzzer activo + LED rojo, compartidos** |
| `PIN_BOTON` | 10 | pulsador |

Polaridades (`:71`, `:74`, `:78`):

```cpp
const bool RELE_ACTIVO_EN_BAJO = false;   // :71  HIGH prende el relé
const bool BOTON_ACTIVO_EN_BAJO = true;   // :74  reposo HIGH, pulsado LOW
const bool BUZZER_ACTIVO_EN_BAJO = false; // :78  HIGH prende buzzer y LED
```

Las tres están **verificadas físicamente y así consta en el propio archivo**:
`:32-35` dice "Este rele fue probado fisicamente: GPIO 6 HIGH -> rele ON, GPIO 6
LOW -> rele OFF", y `:812` lo repite en el banner del arranque ("Rele probado:
HIGH=ON LOW=OFF").

Las polaridades se aplican en `aplicarRele()` (`:183-193`), `aplicarBuzzer()`
(`:199-209`) y en la lectura del botón (`:359-363`).

### 2.1 GPIO 7 compartido: buzzer + LED

**Hecho confirmado y con consecuencia funcional.** El encabezado lo describe en
`:15-17`:

```
   Buzzer activo -> GPIO 7
   LED rojo      -> GPIO 7 mediante resistencia de 470 ohm
                   pata corta del LED -> GND
```

y `:76-77` lo repite: "Buzzer activo y LED rojo comparten GPIO 7. HIGH =
buzzer/LED encendidos."

Consecuencia: **no se pueden accionar por separado**. Cualquier señalización
sonora enciende también la luminosa y viceversa. Como el patrón de alarma es un
pulso de 200 ms cada 2 segundos (`atenderBuzzer()`, `:419-449`), el LED rojo
**parpadea** en vez de quedar fijo: no existe un modo "silencioso pero visible"
ni "audible sin luz" sin cambiar el hardware. El banner del arranque lo declara
como `"Pines: DHT=5 RELE=6 BUZZER+LED=7 BOTON=10"` (`:809`).

### 2.2 Configuración de los pines en `setup()`

`:742-770`: `PIN_RELE` y `PIN_BUZZER` como `OUTPUT`, y `PIN_BOTON` como
`INPUT_PULLUP` porque `BOTON_ACTIVO_EN_BAJO` es `true` (`:760-770`).

---

## 3. Qué manda el nodo

`enviarLectura()` (`:500-677`) arma el JSON en `:551-571`:

```json
{
  "dispositivo": "NODO-INV-N-01",
  "area": "INV-N",
  "temperatura": 23.4,
  "humedad": 61.0,
  "boton": "NINGUNO"
}
```

- `temperatura` y `humedad` van como **`null` literal** si el valor es `NaN`
  (`:559-569`).
- `boton` es el string `botonPendiente`, que vale `"NINGUNO"`, `"NORMAL"` o
  `"EMERGENCIA"` (`:144`, `:383`, `:401`).

Headers (`:541-549`): `Content-Type: application/json` y `x-device-key`.

TLS: `WiFiClientSecure` con **`cliente.setInsecure()`** (`:523`). El comentario
de `:518-522` lo asume: "HTTPS cifra el trafico, pero setInsecure() no valida la
identidad del servidor. Para produccion real hay que instalar la CA correcta."
El nodo es vulnerable a un man-in-the-middle que le presente cualquier
certificado.

---

## 4. Qué campos de la respuesta lee el firmware, y con qué default

Solo en la rama `codigo == 200` (`:583-631`), y solo después de que
`deserializeJson()` no falle (`:588-598`).

`:604-608`:

```cpp
      releEncendido =
        datos["rele"] | false;

      alarmaActiva =
        datos["alarma"] | false;
```

| Campo leído | Default si falta, es `null` o no es booleano | Efecto |
|---|---|---|
| `rele` | **`false`** (operador `|` de ArduinoJson) | `aplicarRele(releEncendido)` inmediato (`:610`) |
| `alarma` | **`false`** | `atenderBuzzer()` lo consume en el siguiente ciclo del loop (`:419-449`) |

**El firmware ignora `ok`, `area` y `llamados`.** No los lee en ninguna línea.
Si el servidor devolviera 200 con `{}`, el nodo apagaría relé y alarma sin
protestar.

Efecto secundario del 200 válido (`:599-602`):

```cpp
      servidorRespondioAlgunaVez = true;
      ultimaRespuestaServidorMs = millis();
      failsafeServidorAplicado = false;
```

Es lo único que rearma el failsafe. Y el botón pendiente se limpia solo aquí
(`:612-622`): `botonPendiente = "NINGUNO"` recién cuando el servidor confirmó
con 200 + JSON legible. **Cualquier otro código deja el botón pendiente y lo
reintenta en el envío siguiente.**

---

## 5. Comportamiento ante cada situación

### 5.1 HTTP 401

`:633-640`. Imprime en serie `"HTTP 401: DEVICE_KEY incorrecta"`. **No cambia
`releEncendido` ni `alarmaActiva`**, no rearma el failsafe, y **no limpia
`botonPendiente`**. El relé se queda como estaba hasta que el failsafe de 45 s
lo apague — y el failsafe solo actúa si alguna vez hubo un 200 previo (`:327-329`).

### 5.2 HTTP 404

`:642-649`. Imprime `"HTTP 404"`. Mismo tratamiento que el 401: sin cambio de
estado, sin rearme, con el botón todavía pendiente. Este es el código que
devuelve `/api/ingest` cuando el `area` no existe
(`app/api/ingest/route.ts:119-124`).

### 5.3 Cualquier otro código > 0

`:651-661`. Imprime `"HTTP <codigo>"`. Idéntico: sin efecto sobre relé, alarma,
failsafe ni botón. Esto incluye **200 con JSON ilegible** (`:591-597`, que
imprime "respuesta del servidor ilegible"), 400, 405 y los 500.

### 5.4 Fallo de red (código ≤ 0)

`:663-674`. Imprime `"fallo de red: " + http.errorToString(codigo)`. Sin cambio
de estado. También cuenta como fallo de red el `http.begin()` que devuelve false
(`:530-539`, `"no se pudo abrir HTTPS"`).

En todos los casos, `http.end()` se ejecuta al salir (`:676`).

### 5.5 Caída del Wi-Fi

Dos puntos:

- **Antes de enviar** (`:505-514`): si `WiFi.status() != WL_CONNECTED`, imprime
  `"sin envio: Wi-Fi caido"` y **retorna sin intentar nada**. No toca relé ni
  alarma.
- **`atenderWiFi()`** (`:253-316`), que corre primero en cada loop (`:838`): al
  detectar la caída lo anuncia una vez (`:281-287`), hace
  `WiFi.disconnect(true)`, vuelve a `WIFI_STA`, `setSleep(false)`,
  `setAutoReconnect(true)` y `WiFi.begin()` (`:289-307`). Si pasan
  `WIFI_TIMEOUT_MS` (20 s) sin conectar, reintenta (`:309-315`).
- Al reconectar, sincroniza la hora por NTP contra `pool.ntp.org` y
  `time.nist.gov` (`:267-275`), solo para el monitor serie.

El relé sigue en el último estado ordenado durante toda la caída, **hasta que el
failsafe lo apague**.

### 5.6 Failsafe del servidor

`atenderFailsafeServidor()` (`:326-348`), llamado en cada loop (`:840`):

```cpp
  if (!servidorRespondioAlgunaVez) {
    return;                                     // :327-329
  }
  if (millis() - ultimaRespuestaServidorMs < SERVIDOR_FAILSAFE_MS) {
    failsafeServidorAplicado = false;
    return;                                     // :331-334
  }
  if (!failsafeServidorAplicado) {
    failsafeServidorAplicado = true;
    releEncendido = false;
    aplicarRele(false);                         // :336-347
  }
```

Reglas exactas:

1. **Solo actúa si hubo al menos un 200 válido antes** (`:327-329`). Si el nodo
   arranca y nunca logra hablar con el servidor, el failsafe nunca corre — pero
   eso no importa, porque `setup()` ya dejó el relé apagado (§5.8).
2. A los 45 s sin un 200 válido, apaga el relé una sola vez.
3. **No toca `alarmaActiva`**: el comentario de `:322-323` lo justifica ("una
   alarma ya conocida sigue avisando"). El buzzer sigue sonando indefinidamente
   si la última respuesta decía `alarma: true` y después se cayó el servidor.

Con `INTERVALO_MS = 10 s`, el failsafe tolera 4 envíos fallidos consecutivos
antes de disparar.

### 5.7 Botón

`atenderBoton()` (`:354-410`):

- Antirrebote de 50 ms sobre el flanco (`:365-373`).
- **Pulsación corta** (soltar antes de 2 s): `botonPendiente = "NORMAL"`
  (`:381-391`). Se manda en el próximo ciclo de 10 s.
- **Pulsación larga** (≥ `PULSACION_LARGA_MS`, todavía apretado):
  `botonPendiente = "EMERGENCIA"` **y `envioInmediato = true`** (`:394-409`),
  que saltea la espera del intervalo (`:850-853`).
- `emergenciaYaDisparada` (`:399`) impide que soltar el botón después de una
  pulsación larga genere además un NORMAL (`:382`).

### 5.8 Arranque: estado seguro antes de Wi-Fi

`setup()` (`:742-831`), en este orden exacto:

1. `Serial.begin(115200)` (`:743`).
2. `pinMode(PIN_RELE, OUTPUT)` y **`aplicarRele(false)`** (`:746-751`).
3. `pinMode(PIN_BUZZER, OUTPUT)` y **`aplicarBuzzer(false)`** (`:753-758`).
4. `pinMode(PIN_BOTON, INPUT_PULLUP)` (`:760-770`).
5. `dht.begin()` (`:772`).
6. Espera del monitor serie, acotada a 2 s (`:774-781`).
7. Banner informativo (`:783-819`).
8. **Recién ahora** `WiFi.mode(WIFI_STA)` y `WiFi.setSleep(false)` (`:821-827`).
9. `ultimoEnvioMs = millis() - INTERVALO_MS` (`:829-830`), para que el primer
   envío salga en el primer loop y no dentro de 10 s.

El comentario de `:745` lo declara: "Salidas en estado seguro antes de Wi-Fi".
Verificado: **el relé y el buzzer quedan apagados antes de que exista red**, así
que un corte de energía deja el actuador apagado al volver.

### 5.9 DHT en NaN

`medirYEnviar()` (`:683-736`). Si `isnan(temp) || isnan(hum)` (`:689`), tres
caminos, en este orden:

1. **Hay una lectura válida previa** (`hayLecturaValida`, `:696-702`): reenvía
   `ultimaTemp` / `ultimaHum` con la nota
   `"DHT fallo: se reenvia ultima lectura valida"`. **El servidor recibe datos
   viejos como si fueran actuales** y no tiene forma de saberlo: la nota queda
   solo en el monitor serie, nunca en el JSON.
2. **No hay lectura previa pero sí botón pendiente** (`:704-712`): envía
   `NAN, NAN` — que se serializa como `null, null` (`:559-569`) — con la nota
   `"sin DHT: se envia solamente boton"`, y retorna.
3. **Ni lectura previa ni botón** (`:714-722`): imprime "Todavia no hay lectura
   valida" y **no envía nada**. El servidor cuenta ese silencio para
   `SEGUNDOS_SIN_SENAL`.

Cuando la lectura es buena, se guarda como última válida (`:725-729`).

### 5.10 Loop

`loop()` (`:837-861`): `atenderWiFi()` → `atenderFailsafeServidor()` →
`atenderBoton()` → `atenderBuzzer()` → envío si `envioInmediato` o si pasaron
`INTERVALO_MS`. No hay `delay()` en ningún lado: el botón se muestrea a
velocidad de loop.

---

## 6. LISTA EXPLÍCITA de cambios de backend que romperían el nodo

Cada ítem indica el cambio y la línea del firmware que lo hace fatal. No es
especulación: es lectura directa del código.

### 6.1 Rompen el nodo por completo

1. **Cambiar la ruta o el dominio del endpoint.** `SERVIDOR` está incrustado
   (`:54`). Mover `/api/ingest` a otra ruta, o el proyecto a otro dominio, deja
   al nodo golpeando el aire hasta que se reflashee. No hay fallback.

2. **Rotar `DEVICE_KEY` sin reflashear.** `:57`. El servidor devolvería 401
   (`app/api/ingest/route.ts:86-88`) y el nodo, en `:633-640`, **no reintenta,
   no alerta a nadie y no apaga el buzzer**: solo imprime en un puerto serie que
   nadie mira. El relé queda como estaba hasta que el failsafe lo apague a los
   45 s.

3. **Cambiar el nombre de la cabecera `x-device-key`.** `:546-549`. 401 en cada
   envío, mismo cuadro que el punto anterior.

4. **Exigir autenticación de sesión en `/api/ingest`** — sacarla de
   `RUTAS_PUBLICAS` (`proxy.ts:12`). El proxy respondería un redirect 307 a
   `/login`; el firmware caería en la rama "otro código" (`:651-661`) y quedaría
   mudo para siempre.

5. **Renombrar el área `INV-N` o borrarla de `areas`.** El nodo manda
   `area: "INV-N"` fijo (`:64`, `:557`); `/api/ingest` responde **404** y
   **descarta la lectura** (`app/api/ingest/route.ts:119-124`). El nodo, en
   `:642-649`, solo lo imprime. Se pierde toda la telemetría en silencio.

6. **Validar TLS del lado del nodo o cambiar de CA sin reflashear.** Hoy no
   valida (`setInsecure()`, `:523`), así que un cambio de certificado del
   servidor no lo afecta — pero si se instalara una CA fija, cualquier rotación
   de certificado en Vercel lo dejaría afuera. Se anota porque el propio
   archivo lo pide como paso a producción (`:518-522`).

### 6.2 Rompen el comportamiento sin romper la conexión

7. **Renombrar los campos `rele` o `alarma` de la respuesta 200.**
   `:604-608`. ArduinoJson devuelve el default `false` sin error: el relé se
   apagaría permanentemente y el buzzer nunca sonaría, **con el nodo
   reportando 200 OK y aparentando salud total**. Es el modo de falla más
   peligroso de toda la lista: silencioso y sin síntoma.

8. **Cambiar el tipo de `rele`/`alarma` de booleano a otra cosa** (string
   `"ON"`, número `1`, objeto). Mismo resultado que el punto 7: `| false`
   descarta lo que no sea booleano.

9. **Devolver 200 con un cuerpo que no sea JSON** (texto plano, HTML de error
   de la plataforma). `deserializeJson()` falla (`:588-598`), no se rearma el
   failsafe, no se limpia el botón pendiente, y a los 45 s el relé se apaga.

10. **Devolver 204 o cualquier 2xx que no sea exactamente 200.** La rama es
    `if (codigo == 200)` (`:583`), comparación estricta. Un 201 o un 204 cae en
    "otro código" y el nodo se comporta como si el servidor no le hubiera
    respondido: failsafe a los 45 s y botón sin confirmar.

11. **Cambiar el contrato del campo `boton`** — aceptar solo minúsculas, exigir
    un enum distinto, o dejar de aceptarlo. El nodo manda `"NINGUNO"`,
    `"NORMAL"` o `"EMERGENCIA"` en mayúsculas (`:571`, `:144`, `:383`, `:401`).
    Si el servidor responde 400, el botón **nunca se limpia** (`:612-622`) y el
    nodo reintenta el mismo evento cada 10 segundos indefinidamente.

12. **Volver obligatorio un campo nuevo en el cuerpo** (por ejemplo un
    `firmware_version`, un `timestamp` o una firma). El nodo manda cinco campos
    y solo cinco (`:551-571`). Cualquier 400 nuevo lo deja mudo.

13. **Dejar de aceptar `null` en `temperatura` / `humedad`.** El nodo los manda
    como `null` cuando el DHT falla y hay un botón pendiente (`:559-569`,
    `:704-712`). Un 400 en ese caso perdería justamente el evento de botón, que
    es el caso de uso más urgente del nodo.

14. **Bajar `SEGUNDOS_SIN_SENAL` por debajo de ~20 s** (`lib/alertas.ts:18`).
    Con `INTERVALO_MS = 10 s` y `HTTP_TIMEOUT_MS = 6 s`, un solo envío lento
    generaría un llamado de EMERGENCIA "Sensor sin señal" falso. Ver
    `03-riesgos.md`, riesgo R5.

15. **Subir el tiempo de respuesta de `/api/ingest` por encima de 6 s.**
    `HTTP_TIMEOUT_MS = 6000` (`:102`, aplicado en `:527-528`). Agregar trabajo
    síncrono al handler —una consulta pesada, un envío de Telegram sin
    `after()`— haría que el nodo corte la conexión antes de leer la respuesta y
    caiga en la rama de fallo de red (`:663-674`). Hoy los avisos se agendan con
    `after()` justamente por esto (`lib/avisos.ts:75-97`, `lib/alertas.ts:179-181`).

### 6.3 No rompen nada (margen disponible)

- Agregar campos nuevos a la respuesta 200: el firmware los ignora.
- Cambiar el valor de `area` en la respuesta: no se lee (`:583-631`).
- Cambiar el contenido de `llamados`: no se lee.
- Cambiar los textos de los motivos, los márgenes `MARGEN_TEMP_NORMAL` /
  `MARGEN_HUM_NORMAL`, o los umbrales de un área: el firmware **no decide
  umbrales** por diseño (`:21-22`), solo obedece `rele` y `alarma`.
