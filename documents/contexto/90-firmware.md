# 90 — Contrato definitivo hardware ↔ servidor

Fecha: **2026-09-10**. Cierra el contrato entre
`firmware/produccion_parque/produccion_parque.ino` (leído entero, 860 líneas) y
`app/api/ingest/route.ts`.

**El firmware no se tocó.** `git status` sobre `firmware/` no reporta ninguna
modificación. Ese era el objetivo: que el `.ino` que hoy está grabado en
`NODO-INV-N-01` siga andando sin reflashear.

La arquitectura que se preserva, y que ninguna de las verificaciones de abajo
contradice:

> **El ESP32 mide. El ESP32 envía. El servidor decide. El ESP32 ejecuta.**

---

## 0. Alcance honesto de lo verificado

Hay que decirlo antes que nada, porque cambia cómo se lee el resto.

| Prueba | Estado |
|---|---|
| Las 12 verificaciones del contrato | **hechas** — §2, por HTTP contra `next start` con la base real |
| Cambiar la automatización del área y ver el relé responder al ciclo siguiente | **hecha** — §3.1, extremo a extremo del lado servidor |
| 10 minutos de operación continua del nodo físico | **NO hecha** — §3.3 |
| Botón corto y largo apretados a mano | **NO hecha** — §3.3 |
| Cortar el servidor y ver el relé apagarse a los 45 s | **parcial** — §2.5 |
| Log del monitor serie | **NO hay** — §3.3 |

El motivo es uno solo y es material: **el nodo físico está apagado**. Su última
lectura real es del `2026-09-10T02:59:05Z`; desde entonces no reportó. Además
`SERVIDOR` está incrustado en el firmware apuntando a
`https://parque-ambiental.vercel.app/api/ingest` (`.ino:54`), así que **aunque
estuviera encendido no golpearía el servidor de prueba**: hablaría con lo que
esté desplegado en Vercel, que no incluye los cambios de esta etapa.

Lo que sí se hizo fue reproducir **byte por byte** el POST del firmware contra
el backend nuevo. Eso verifica el contrato; no verifica el hardware. La
distinción está mantenida en todo el documento.

---

## 1. El contrato, en una página

### 1.1 Lo que el nodo manda

```
POST https://parque-ambiental.vercel.app/api/ingest
Content-Type: application/json
x-device-key: <secreto de 7 caracteres grabado en .ino:57>

{"dispositivo":"NODO-INV-N-01","area":"INV-N","temperatura":22.5,"humedad":70,"boton":"NINGUNO"}
```

Cinco campos, en ese orden de inserción (`.ino:551-571`), y no puede mandar uno
más.

| Campo | Tipo | Quién decide con esto |
|---|---|---|
| `dispositivo` | `string` no vacío, obligatorio | **nadie**. Solo ubica la credencial heredada `bcrypt-v1`. La identidad la determina la credencial |
| `area` | `string`, **opcional** | **nadie**. Informativo. El área sale de `dispositivos.area_id` |
| `temperatura` | `number` \| `null` | se guarda y se evalúa |
| `humedad` | `number` \| `null` | se guarda y se evalúa |
| `boton` | `"NINGUNO"` \| `"NORMAL"` \| `"EMERGENCIA"` | genera llamado con `origen: "EMPLEADO"` |

### 1.2 Lo que el servidor responde

```json
{"ok":true,"rele":false,"alarma":true,"area":"INV-N","llamados":[],
 "dispositivo":"NODO-INV-N-01","compatibilidad":false,
 "area_declarada":"INV-N","avisos":[]}
```

**El firmware lee exactamente dos campos** (`.ino:604-608`):

```cpp
releEncendido = datos["rele"]   | false;
alarmaActiva  = datos["alarma"] | false;
```

`rele` y `alarma`: **booleanos JSON, en la raíz, con esos nombres exactos**. Todo
lo demás lo ignora, así que agregar campos es gratis y quitarlos —de esos dos—
es catastrófico y silencioso.

### 1.3 Los tres estados del nodo, y qué los provoca

| Lo que recibe el nodo | Relé | Alarma | Botón pendiente | Failsafe |
|---|---|---|---|---|
| **200 + JSON legible** | se aplica `rele` en el acto (`.ino:610`) | se aplica `alarma` | **se limpia** (`.ino:612-622`) | **se rearma** |
| **200 + cuerpo ilegible** | sin cambio | sin cambio | queda pendiente | no se rearma |
| **cualquier otro código** | sin cambio | sin cambio | queda pendiente | no se rearma |
| **sin respuesta / red caída** | sin cambio | sin cambio | queda pendiente | no se rearma |

Y a los 45 s sin un 200 legible, el nodo apaga el relé solo
(`SERVIDOR_FAILSAFE_MS`, `.ino:105`, `:326-348`). **No apaga la alarma**, a
propósito (`.ino:322-323`).

---

## 2. Las doce verificaciones

Ejecutadas contra `next start` en `localhost:3210`, con la base real, el
**2026-09-10**. La clave se leyó del firmware a una variable de entorno, como en
`40-pruebas-ingest.md`; no aparece escrita en este archivo.

### 2.1 El JSON del firmware es aceptado tal cual — **VERIFICADO**

Cinco cuerpos, byte por byte como los serializa ArduinoJson, incluidos los dos
caminos de DHT en fallo:

```
OK  lectura normal
    -> {"dispositivo":"NODO-INV-N-01","area":"INV-N","temperatura":22.5,"humedad":70,"boton":"NINGUNO"}
    <- HTTP 200 rele=false alarma=true area=INV-N compatibilidad=false
OK  DHT en NaN (.ino:559-569 serializa null)
    -> {"dispositivo":"NODO-INV-N-01","area":"INV-N","temperatura":null,"humedad":null,"boton":"NINGUNO"}
    <- HTTP 200 rele=false alarma=true area=INV-N compatibilidad=false
OK  boton NORMAL         <- HTTP 200 rele=false alarma=true
OK  boton EMERGENCIA     <- HTTP 200 rele=false alarma=true
OK  solo boton, sin DHT  <- HTTP 200 rele=false alarma=true
```

`compatibilidad: false` en los cinco: entró por su **credencial propia**, no por
el fallback global. Ver §2.3 y §2.4.

### 2.2 `rele` y `alarma` booleanos, y ningún camino de éxito los omite — **VERIFICADO**

**Auditoría estática.** `app/api/ingest/route.ts` tiene exactamente **dos**
respuestas con estado 200:

| Línea | Camino | ¿`rele`? | ¿`alarma`? |
|---|---|---|---|
| `:267` | dispositivo dado de baja | `rele: false` literal | `alarma: false` literal |
| `:509` | camino feliz | `rele`, de `decision?.encendido ?? false` | `alarma`, de `hayEmergenciaAbierta()` |

`const rele = decision?.encendido ?? false` (`:476`) es booleano por
construcción. `hayEmergenciaAbierta()` termina en `return (count ?? 0) > 0`
(`lib/alertas.ts:202`), booleano estricto. **No hay un tercer 200.**

**Verificación dinámica**, con un lector que reproduce `datos["x"] | false` de
ArduinoJson —solo un booleano JSON sobrevive—:

```
OK   en rango                    -> rele=false alarma=true HTTP 200
OK   temp alta (rele deberia ON) -> rele=true  alarma=true HTTP 200
OK   hum baja (rele deberia ON)  -> rele=true  alarma=true HTTP 200
OK   sin campo area              -> rele=false alarma=true HTTP 200
OK   area declarada equivocada   -> rele=false alarma=true HTTP 200
OK   temp fuera de rango fisico  -> rele=false alarma=true HTTP 200
OK   DHT en NaN -> null/null     -> rele=false alarma=true HTTP 200

  => ningun camino de exito omite rele ni alarma
```

Los siete pasaron las seis comprobaciones: HTTP 200, JSON parseable, existe
`rele`, existe `alarma`, ambos `typeof === "boolean"`, ambos en la raíz.

### 2.3 La credencial del firmware autentica sin fallback global — **VERIFICADO**

La clave de `.ino:57` está sembrada como credencial `bcrypt-v1` de
`NODO-INV-N-01` (`sql/09_credencial_nodo_fisico.sql`). Estado en la base:

```
id 1 | dispositivo_id 11 | bcrypt-v1 | ACTIVA | origen LEGADO
```

El camino heredado necesita el código declarado para localizar el hash, y el
firmware lo manda en `dispositivo` (`.ino:556`). Por eso ese campo sigue siendo
obligatorio aunque no decida nada.

`compatibilidad: false` en la respuesta es la prueba de que **la cascada probó
la credencial antes que el fallback**. Ese orden no es negociable: si el
fallback se probara primero, el nodo seguiría entrando como anónimo y la
migración no habría servido de nada.

### 2.4 Con el fallback global apagado, el nodo sigue autenticando — **VERIFICADO**

`INGEST_PERMITE_CLAVE_GLOBAL` **no está en `.env.local`** (`grep -c` devuelve
`0`), y el default es cerrado: solo el literal `"1"` lo enciende
(`route.ts:77`). Todas las pruebas de arriba corrieron así.

> **Esta es la prueba de que la migración de seguridad terminó.** El nodo entra
> por identidad propia, no por una clave compartida. La `DEVICE_KEY` global ya
> no participa de ningún camino que el nodo use.

Falta un paso, y es de despliegue: **confirmar que `INGEST_PERMITE_CLAVE_GLOBAL`
tampoco esté definida en Vercel.** Si allá estuviera en `"1"`, producción
seguiría aceptando la clave global aunque acá no. No se pudo verificar desde
este entorno.

### 2.5 Failsafe — **PARCIAL**

Lo que se verificó, que es la mitad que depende del servidor:

```
=== V5a) servidor VIVO ===
  HTTP 200 en 1.82s -> el .ino rearma failsafe
  [servidor detenido]
=== V5b) servidor CAIDO ===
  HTTP 000 (0 = sin respuesta), curl exit=7 (connection refused)
  -> el .ino cae en 'fallo de red' (codigo<=0): NO rearma failsafe,
     NO limpia boton, NO toca rele
```

Con el servidor caído **no llega ninguna respuesta**, mucho menos un 200 con
JSON válido. El nodo entra en la rama de `.ino:663-674` y a los 45 segundos
`atenderFailsafeServidor()` apaga el relé.

**La segunda parte de la consigna —"ninguna respuesta de error se devuelve como
200 con JSON válido en un caso donde quisieras que actúe el failsafe"— también
se verificó**, y merece la tabla completa:

| Situación | Respuesta | ¿Es lo correcto? |
|---|---|---|
| Clave inválida / credencial revocada / vencida | **401** | **sí**. El nodo no debe seguir accionando con una identidad rechazada |
| Cuerpo inválido, `boton` fuera de catálogo, cuerpo > 8 KB | **400** | **sí** |
| Dispositivo no registrado (solo en modo compatibilidad) | **404** | **sí** |
| **Fallo al guardar la lectura en la base** | **500** (`route.ts:410`) | **sí, y es el caso que importa**. Si el servidor no puede hacer su trabajo, no debe decirle al nodo "todo bien": el relé tiene que caer al estado seguro |
| `GET` | **405** | sí |
| **Dispositivo dado de baja** | **200 con `rele:false`** | **sí, y es deliberado**. Ver abajo |

El único 200 que podría leerse como "error disfrazado de éxito" es el del
dispositivo dado de baja, y es una decisión tomada y documentada
(`12-contrato-ingest-objetivo.md` §3.1): con `rele:false` el relé se apaga **en
el acto**; con un 4xx se apagaría **45 segundos después**, además de perder la
lectura y dejar el botón reintentándose cada 10 s. El 4xx es peor en las tres
columnas.

**Lo que falta**: cronometrar los 45 segundos reales con el nodo encendido y ver
el relé abrir. Eso necesita el hardware.

### 2.6 Pérdida de Wi-Fi: el servidor no asume nada distinto — **VERIFICADO**

Del lado del nodo: si `WiFi.status() != WL_CONNECTED` no intenta el POST y
retorna sin tocar relé ni alarma (`.ino:505-514`). No decide nada por su cuenta.

Del lado del servidor, dos hechos comprobados:

1. **La arquitectura es pull, no push.** No existe ninguna llamada saliente
   hacia el nodo. Búsqueda de `fetch(` en `app/api` y `lib`, descartando
   Telegram y web-push: **ninguna**. El servidor nunca inicia contacto, así que
   no tiene forma de "asumir" un estado empujándolo.
2. **La única inferencia del servidor sobre un nodo callado es la vigilancia**,
   y es exactamente la correcta: a los 90 segundos sin reportar, un llamado de
   EMERGENCIA "Sensor sin señal". Ver §2.11.

No hay ninguna otra suposición: el handler no recuerda nada entre peticiones.

### 2.7 Arranque: el servidor no depende de un estado previo del nodo — **VERIFICADO**

`setup()` deja relé y buzzer apagados **antes** de tocar el Wi-Fi
(`.ino:746-758`, con `WiFi.mode()` recién en `:821`). Un corte de energía deja
el actuador abierto al volver.

Del lado del servidor, por auditoría estática de `route.ts`:

- **No lee `dispositivos.ultimo_contacto_en`.** Esa columna solo se **escribe**,
  vía `registrarContacto()` dentro de `after()`. Es telemetría, no insumo.
- **No lee ningún estado anterior de relé ni de alarma.** Búsqueda de
  `releAnterior`, `estadoPrevio`, `ultimo_rele`, `previous`: ninguna
  coincidencia en `route.ts` ni en `lib/automatizacion.ts`.

La decisión se calcula entera desde el área y la lectura **de esta petición**.
Un nodo que acaba de arrancar recibe exactamente la misma respuesta que uno que
lleva días prendido, con la misma lectura. Es lo que hace que el arranque en
estado seguro sea suficiente.

### 2.8 Polaridad: el backend nunca la interpreta — **VERIFICADO**

`RELE_ACTIVO_EN_BAJO = false` (`.ino:71`), probado físicamente: GPIO 6 HIGH
enciende. La traducción booleano → nivel eléctrico vive **entera** en
`aplicarRele()` (`.ino:183-193`).

Auditoría del backend:

```
route.ts:476   const rele = decision?.encendido ?? false;
route.ts:512   rele,
automatizacion.ts:198   encendido: areaActiva && motivos.length > 0,
```

Búsqueda de `!rele`, `!encendido`, `ACTIVO_EN_BAJO`, `invert` en `app` y `lib`:
**ninguna coincidencia**.

El servidor habla de **intención** (`encendido`), no de voltaje. El firmware es
el único dueño de la polaridad. Si mañana se cambia el relé por uno activo en
bajo, se toca una constante del `.ino` y el backend no se entera — que es
exactamente como tiene que ser.

### 2.9 DHT en NaN — **VERIFICADO**

El firmware serializa `null` (`.ino:559-569`). El backend lo acepta y **no
genera alerta por la magnitud ausente**, pero sigue evaluando la otra:

```
HTTP 200 | temperatura null, humedad 70 (en rango)
  llamados: []
  avisos:   []
HTTP 200 | temperatura null, humedad 40 (FUERA de rango)
  llamados: [{"motivo":"Humedad por debajo del umbral","tipo":"EMERGENCIA","resultado":"actualizado"}]
  avisos:   ["Actuador encendido por: Humedad por debajo del mínimo."]
HTTP 200 | ambas null
  llamados: []
  avisos:   []
```

Y la fila queda guardada con el `null`, no descartada:

```
{"id":5732,"dispositivo":"NODO-INV-N-01","dispositivo_id":11,"area_id":1,
 "temperatura":null,"humedad":null,"tomada_en":"2026-09-10T14:02:42.987+00:00"}
```

La guarda es `if (temperatura !== null && Number.isFinite(temperatura))` en
`evaluarDesvios()` (`lib/alertas.ts:52`), y la misma condición en
`decidirActuadorDeArea()`. Una magnitud ausente no acciona y no alerta: no se
puede afirmar nada sobre lo que no se midió.

### 2.10 Botón — **VERIFICADO**

| Pulsación | `botonPendiente` | Motivo generado | Tipo | Origen |
|---|---|---|---|---|
| corta (< 2 s) | `"NORMAL"` (`.ino:383`) | `Solicitud de asistencia` | NORMAL | EMPLEADO |
| larga (≥ 2 s) | `"EMERGENCIA"` (`.ino:401`) + envío inmediato | `Botón de emergencia accionado` | EMERGENCIA | EMPLEADO |

```
V10a) pulsacion CORTA -> boton:"NORMAL"
  HTTP 200 | llamados: [{"motivo":"Solicitud de asistencia","tipo":"NORMAL","resultado":"actualizado"}]
V10b) pulsacion LARGA -> boton:"EMERGENCIA"
  HTTP 200 | llamados: [{"motivo":"Botón de emergencia accionado","tipo":"EMERGENCIA","resultado":"actualizado"}]
```

Los dos motivos son los del catálogo cerrado vigente (`lib/catalogos.ts`), sin
cambios. Y los dos llamados quedaron visibles en el panel con el texto del nodo
y la marca de tiempo de la prueba:

```
id 433 | EMERGENCIA | origen EMPLEADO | NO_ATENDIDO
  motivo : Solicitud de asistencia
  detalle: Accionado desde NODO-INV-N-01 en Invernadero Norte el 10/09/2026 11:03.
           Lectura del momento: 22,5 °C, 70,0 %.
id 434 | EMERGENCIA | origen EMPLEADO | NO_ATENDIDO
  motivo : Botón de emergencia accionado
  detalle: Accionado desde NODO-INV-N-01 en Invernadero Norte el 10/09/2026 11:03.
           Lectura del momento: 22,5 °C, 70,0 %.
```

`resultado: "actualizado"` y no `"creado"` porque **INV-N ya tenía un llamado
abierto de cada uno de esos dos motivos**. Es el antirrebote funcionando: agrupa
por `(área, motivo)` y refresca el detalle en vez de duplicar. Total de
llamados: **431 antes y 431 después** de toda la corrida.

> **No se forzó el camino `"creado"`.** Habría requerido atender primero los
> llamados abiertos del operador, o inventar un desvío de un motivo que hoy no
> tiene ninguno abierto — y `registrarLlamado()` dispara Telegram y push **solo
> al crear** (`lib/alertas.ts:182-188`). Ensuciar la bandeja y hacer sonar el
> teléfono de alguien para probar una rama ya cubierta por los tests no valía la
> pena. Se deja dicho en vez de disimularlo.

**El nodo limpia `botonPendiente` solo tras un 200 válido**, verificado por
lectura del código: la asignación `botonPendiente = "NINGUNO"` está en
`.ino:620`, dentro del bloque `if (codigo == 200)` **y** después de que
`deserializeJson()` no falle. Las ramas 401, 404, otro código y fallo de red no
la tocan. Un evento de botón no se pierde nunca por un error del servidor: se
reintenta cada 10 segundos hasta que alguien lo confirme.

### 2.11 Vigilancia — **VERIFICADO, con un cambio en `lib/alertas.ts`**

`INTERVALO_MS = 10 s` contra `SEGUNDOS_SIN_SENAL = 90`: el margen es de **9
envíos perdidos** antes de declarar el nodo caído. Ninguna de las dos constantes
se movió, y hay un test que fija el 90 en los tres bordes.

**Hizo falta ajustar el criterio, y se ajustó.** El archivo completo está
entregado; la sección de vigilancia se reescribió entera. Cuatro motivos, en
orden de peso:

1. **Naturaleza.** La versión anterior agrupaba `lecturas.dispositivo` y después
   filtraba contra una lista de códigos físicos. Ahora la consulta misma solo
   trae `naturaleza = 'FISICO'` y `activo = true`.
2. **El punto ciego de 24 horas (R10).** La barrida vieja solo miraba lecturas
   de las últimas 24 h: **un nodo caído hace más de un día desaparecía**, y su
   llamado dejaba de refrescarse. Pasaba de "caído, en emergencia" a
   "inexistente". Con `dispositivos.ultimo_contacto_en` no hay ventana.
3. **Costo.** Con un nodo cada 10 s, la barrida vieja transfería hasta 8 640
   filas por nodo por día para agrupar en memoria. Ahora es una consulta que
   devuelve una fila por dispositivo físico.
4. **Identidad.** Agrupar por el texto del cuerpo era agrupar por lo que el nodo
   declaraba. `dispositivos.codigo` es la identidad registrada, la misma que
   resuelve la credencial.

Se verificó primero que la columna materializada sea confiable: `ultimo_contacto_en`
coincide con `max(tomada_en)` en **las 14 filas** de `dispositivos`.

**Resultado con el nodo todavía fresco** (había reportado hacía 75 s):

```
flota FISICO+activo (lo unico que se vigila):
  NODO-INV-N-01 | area 1 | hace 75 s (umbral 90)
simulados/inactivos que NO se vigilan:
  ESP32-COM-1(S-) ESP32-DEP-1(S-) ESP32-HID-1(S-) ESP32-INV-G(S-)
  ESP32-INV-N(S-) ESP32-INV-S(S-) ESP32-RIE-1(S-) ESP32-VIV-1(S-)
  NODO-COM-1-01(S-) NODO-DEP-1-01(S-) NODO-INV-S-01(S-) NODO-VIV-1-01(S-)
  SIM-INV-N(S+)

{"ok":true,"umbral_segundos":90,"revisados":1,"caidos":0,"creados":0,"actualizados":0}
```

**`revisados: 1`.** Los **13** dispositivos simulados o inactivos —incluido
`SIM-INV-N`, que está activo pero es simulado— quedaron fuera. Cero falsos
"Sensor sin señal".

**Resultado con el nodo ya vencido**, 118 s después del último reporte:

```
{"ok":true,"umbral_segundos":90,"revisados":1,"caidos":1,"creados":0,"actualizados":1}

llamado del nodo fisico:
{"id":421,"area_id":1,"estado":"NO_ATENDIDO",
 "detalle":"El nodo NODO-INV-N-01 no reporta hace 118 segundos.
            Última lectura: 10/09/2026 11:03."}
```

Detecta, refresca el llamado abierto en vez de duplicarlo, y el total de
llamados no se movió.

Se agregó `tests/vigilancia.test.ts`: **15 casos** sobre `estaCaido()` —los tres
bordes del umbral, el nodo que nunca reportó, el nodo sin área, y siete
comprobaciones de que coincide con `estadoDeConexion()` de las pantallas—.
Suite completa: **103 tests en verde**.

> **Deuda que queda anotada.** Hay dos llamados de "Sensor sin señal" abiertos
> —id 411 y 412, de `ESP32-COM-1` y `ESP32-DEP-1`— creados por la lógica vieja
> antes de este cambio. La barrida nueva ya no los toca ni crea otros iguales,
> pero **tampoco los cierra solos**. Hay que atenderlos desde el panel.

### 2.12 TLS: `setInsecure()` es deuda de producción — **DOCUMENTADO**

`.ino:523`:

```cpp
cliente.setInsecure();
```

El propio archivo lo declara (`.ino:518-522`): *"HTTPS cifra el trafico, pero
setInsecure() no valida la identidad del servidor. Para produccion real hay que
instalar la CA correcta."*

**Qué significa exactamente.** El tráfico va cifrado; lo que **no** se verifica
es contra quién. Un atacante en la red del parque que pueda hacerse pasar por
`parque-ambiental.vercel.app` —DNS, ARP, un AP falso con el mismo SSID `NEXO`—
recibiría la `x-device-key` en claro y podría responder `{"rele":true}` o
`{"alarma":false}` a gusto. Es decir: **puede accionar el relé y silenciar la
sirena**.

**Por qué no está en el camino crítico de esta etapa.** Arreglarlo exige
compilar y reflashear con `cliente.setCACert(...)`, y eso es justamente lo que
esta etapa se propuso evitar. Además introduce un modo de falla nuevo: con una
CA fija, **cualquier rotación de certificado en Vercel deja el nodo mudo hasta
que alguien vaya a reflashearlo** — y las CA raíz tienen fecha de vencimiento.

**Recomendación**, para cuando haya acceso físico al nodo: fijar la CA raíz de
Vercel (hoy ISRG Root X1, de Let's Encrypt) y **agendar el vencimiento**, o
mejor, aprovechar el mismo viaje para grabar además una credencial `sha256-v1`
generada y retirar el `bcrypt-v1` heredado. Los dos cambios necesitan el mismo
destornillador.

**Riesgo mientras tanto:** medio. Requiere un atacante con posición de red
dentro del parque. La red es `WIFI_SSID = "NEXO"` con contraseña en claro en el
repositorio (`.ino:51`), lo que baja el listón bastante — pero eso es R2/R15, no
esto.

---

## 3. Prueba de integración

### 3.1 Cambiar la automatización y ver el relé responder — **HECHA**

Del lado del servidor, extremo a extremo: se cambió `auto_temp_alta` de INV-N
**desde el panel**, invocando la Server Action `actualizarArea` por HTTP con
cookie de ADMINISTRADOR firmada, y se mandó la misma lectura antes y después.

```
INV-N original: temp 20-25 | hum 60-80 | auto_temp_alta=true auto_hum_baja=true

CICLO 1: temp 33 (> temp_max 25), auto_temp_alta = true
  rele = true  | avisos: ["Actuador encendido por: Temperatura por encima del máximo."]

--- se apaga auto_temp_alta DESDE EL PANEL (Server Action actualizarArea) ---
  "Área actualizada. Los umbrales y la automatización ya rigen."

CICLO 2: misma lectura, sin reflashear nada
  rele = false | avisos: ["Fuera de rango sin automatización marcada: Temperatura por encima del máximo."]

--- se restaura auto_temp_alta = true ---

CICLO 3: misma lectura, tras restaurar
  rele = true  | avisos: ["Actuador encendido por: Temperatura por encima del máximo."]

INV-N final: ¿identica al original? SI
```

**El relé cambió de conducta en el ciclo siguiente, sin tocar el firmware.** Y
el aviso del ciclo 2 muestra la separación entre alerta y automatización
funcionando: la condición se detecta —y genera llamado— pero el actuador no se
enciende porque el área no lo tiene marcado.

INV-N quedó **byte por byte** como estaba antes de la prueba.

Lo que esto **no** prueba: que el relé físico haya abierto y cerrado. Prueba que
el servidor manda el booleano correcto. El último tramo —que el ESP32 aplique
`aplicarRele()` sobre GPIO 6— está verificado por el propio firmware
(`.ino:32-35`, "Este rele fue probado fisicamente") pero no se re-verificó hoy.

### 3.2 Latencia contra `HTTP_TIMEOUT_MS = 6000` — **MEDIDA**

```
intento 1: HTTP 200 en 1.593s      intento 4: HTTP 200 en 1.267s
intento 2: HTTP 200 en 1.219s      intento 5: HTTP 200 en 1.388s
intento 3: HTTP 200 en 1.343s      intento 6: HTTP 200 en 1.176s
```

Entre 1,2 y 1,6 segundos, contra un presupuesto de 6. Margen de unas **4
veces**, no de un orden de magnitud — y estas mediciones salen de una máquina de
escritorio hacia Supabase; desde Vercel deberían ser mejores por cercanía. Es un
número a vigilar: el punto 15 de `02-contrato-firmware.md` §6.2 avisa que
agregar trabajo síncrono al handler come ese margen. Por eso las dos escrituras
de telemetría van en `after()`.

### 3.3 Lo que NO se pudo hacer, y qué hace falta

| Prueba pedida | Por qué no |
|---|---|
| 10 minutos de operación continua sin errores en el monitor serie | **El nodo está apagado.** Última lectura real: `2026-09-10T02:59:05Z` |
| Botón corto y largo apretados a mano | Requiere estar frente al aparato |
| Cortar el servidor y cronometrar los 45 s del relé | Requiere ver el relé |
| Log del monitor serie | Requiere el nodo conectado por USB a esta máquina |

Hay un segundo obstáculo, independiente del primero y más importante:

> **`SERVIDOR` está incrustado en `.ino:54` apuntando a
> `https://parque-ambiental.vercel.app/api/ingest`.** No hay variable, ni
> configuración por serie, ni portal de aprovisionamiento. **El nodo solo puede
> hablar con producción.**

Así que la prueba de integración real exige, en este orden:

1. **Desplegar estos cambios a Vercel.** Hoy están solo en el árbol local y sin
   commitear. Mientras tanto, el nodo —si se encendiera— hablaría con el backend
   viejo.
2. **Confirmar que `INGEST_PERMITE_CLAVE_GLOBAL` no esté definida en Vercel**, o
   que no valga `"1"` (§2.4).
3. **Encender el nodo** y dejarlo 10 minutos con el monitor serie abierto a
   115200 baudios.
4. Apretar el botón corto, esperar el ciclo, apretar el largo.
5. Cambiar `auto_temp_alta` de INV-N desde el panel y forzar una lectura fuera de
   rango.
6. Cortar la red del nodo y cronometrar: el relé tiene que abrir a los 45 s.

**El log del monitor serie va acá, en esta sección, cuando esa corrida se haga.**
Este documento queda con el hueco explícito en vez de con un log inventado.

Además, no se pudo probar el endpoint de producción desde este entorno: hacerlo
implicaba mandar la clave del dispositivo a un host externo, y la acción fue
bloqueada. Es una restricción razonable; queda como paso a ejecutar con
aprobación explícita.

---

## 4. Incompatibilidades detectadas

**Ninguna que impida que el `.ino` actual siga funcionando.** El firmware no se
tocó y las doce verificaciones pasaron.

Igual aparecieron **dos defectos reales del firmware** que el servidor **no
puede compensar**. Se documentan como pide la consigna, con el cambio mínimo
propuesto, el riesgo y por qué no hay alternativa del lado del servidor.
**Ninguno de los dos se aplicó.**

### 4.1 El DHT en fallo reenvía la última lectura válida como si fuera actual

**Qué pasa.** `medirYEnviar()` (`.ino:689-702`): si el DHT devuelve `NaN` y ya
hubo una lectura válida, el firmware **reenvía `ultimaTemp` / `ultimaHum`** con
la nota `"DHT fallo: se reenvia ultima lectura valida"`. Esa nota **queda solo en
el monitor serie: nunca viaja en el JSON**.

**Consecuencia.** El servidor recibe un número viejo y lo trata como una medición
del momento. Lo guarda en `lecturas` con `tomada_en = ahora`, lo evalúa contra
los umbrales, decide el relé con él y lo promedia en los reportes. Con un DHT11
muerto —que se cuelga con cierta facilidad— el sistema puede pasar **horas
regando o ventilando según una medición congelada**, sin que nada lo delate.

**Por qué el servidor no puede arreglarlo.** No hay señal. Dos peticiones
consecutivas con `22.5 / 70` son indistinguibles de un ambiente estable, que es
el caso normal en un invernadero. Heurísticas del tipo "sospechar si el valor no
cambia en N ciclos" generarían falsos positivos justo cuando el sistema anda
bien. **La información se pierde en el nodo; solo el nodo puede reportarla.**

**Cambio mínimo propuesto** (`.ino:696-702`), tres líneas:

```cpp
    if (hayLecturaValida) {
      temp = NAN;   // era: temp = ultimaTemp;
      hum  = NAN;   // era: hum  = ultimaHum;
      nota = "DHT fallo: se envia null en vez de la ultima lectura";
    }
```

Con eso el nodo manda `null`, que es lo que ya manda en el otro camino
(`.ino:704-712`) y que el servidor ya sabe tratar: guarda la fila con `null`, no
alerta por esa magnitud, y el actuador no acciona por ella. **Verificado en
§2.9.** No hace falta ningún cambio de backend.

**Riesgo del cambio.** Bajo pero real: un DHT11 que falla de forma intermitente
—un ciclo sí, uno no— dejaría huecos en la serie de datos donde hoy hay una
línea continua. El relé **se apagaría** en los ciclos con `null`, en vez de
sostenerse con el último valor. Para un actuador de riego o ventilación eso es
el comportamiento seguro: no accionar sobre un dato que no existe. Pero **es un
cambio de conducta observable** y hay que decidirlo, no colarlo.

**Alternativa sin reflashear: ninguna.** Es la razón por la que esto está acá.

### 4.2 El failsafe apaga el relé pero nunca la alarma

**Qué pasa.** `atenderFailsafeServidor()` (`.ino:336-347`) apaga el relé a los
45 s y **deliberadamente no toca `alarmaActiva`**. El comentario de `.ino:322-323`
lo justifica: *"una alarma ya conocida sigue avisando"*.

**Consecuencia.** Si el servidor cae justo después de haber respondido
`alarma: true`, el buzzer suena en pulsos de 200 ms cada 2 segundos
**indefinidamente**, y no hay forma de bajarlo desde el panel porque el panel es
justamente lo que no responde. Como buzzer y LED comparten GPIO 7
(`.ino:15-17`), tampoco se puede apagar el sonido dejando la luz.

**Por qué el servidor no puede arreglarlo.** Un servidor caído no manda nada, por
definición. No hay respuesta que enviar.

**Cambio mínimo propuesto**: ninguno automático. La conducta actual es
**defendible**: una emergencia real no debería silenciarse porque se cayó la red.
Lo que falta no es código de failsafe sino **una forma manual de silenciar** — por
ejemplo, que una pulsación larga del botón con `alarmaActiva == true` silencie el
buzzer hasta la próxima respuesta del servidor. Eso es una funcionalidad nueva,
no un arreglo de compatibilidad, y **queda fuera del alcance de esta etapa**.

Se anota porque está emparentado con **R8** (`03-riesgos.md`): hoy `alarma` es
por área y hay emergencias abiertas sin atender en las ocho, en su mayoría
sembradas por `sql/02_datos.sql`. Mientras R8 siga abierto, **el nodo real
recibe `alarma: true` de forma prácticamente permanente** — se ve en todas las
respuestas de §2— y este failsafe parcial es el que decide que siga sonando.
Arreglar R8 vale más que arreglar esto.

---

## 5. Lista definitiva: cambios de backend que romperían el nodo

Supera y reemplaza la §6 de `02-contrato-firmware.md`, que fue escrita contra el
backend viejo. Cada punto cita la línea del `.ino` que lo hace fatal.

### 5.1 Rompen el nodo por completo

| # | Cambio | Por qué es fatal | Síntoma |
|---|---|---|---|
| 1 | **Mover o renombrar `/api/ingest`**, o cambiar el dominio | `SERVIDOR` incrustado en `.ino:54`, sin fallback | 404 o fallo de red para siempre; relé off a los 45 s |
| 2 | **Renombrar la cabecera `x-device-key`** | `.ino:546-549` | 401 en cada envío; relé off a los 45 s |
| 3 | **Revocar o rotar sin ventana la credencial de `NODO-INV-N-01`** | El secreto está grabado en `.ino:57` | 401; el nodo solo lo imprime en un puerto serie que nadie mira |
| 4 | **Sacar `/api/ingest` de `RUTAS_PUBLICAS`** (`proxy.ts:12`) | El proxy redirige 307 a `/login` | El nodo cae en "otro código" y queda mudo |
| 5 | **Borrar la fila `NODO-INV-N-01` de `dispositivos`**, o dar de baja el dispositivo | La credencial cuelga de `dispositivo_id` con `on delete cascade` | Borrar: 401. Dar de baja: 200 con `rele:false`, y **la lectura no se guarda** |

**Ya no rompe nada**, y conviene subrayarlo: **renombrar o borrar el área
`INV-N`**. Era el punto 5 de la lista vieja. El área sale de
`dispositivos.area_id`, no de `body.area`, y `area` dejó de ser obligatorio —
verificado en §2.1, cuerpo sin `area` → 200. El nodo ya no depende del código de
área que tiene grabado.

### 5.2 Rompen el comportamiento sin romper la conexión

| # | Cambio | Por qué es fatal |
|---|---|---|
| 6 | **Renombrar `rele` o `alarma`** en la respuesta 200 | ArduinoJson devuelve el default `false` **sin error**. El relé quedaría apagado para siempre y la sirena muda, **con el nodo reportando 200 OK y aparentando salud total**. El modo de falla más peligroso de toda la lista: silencioso y sin síntoma |
| 7 | **Cambiar su tipo** a string, número u objeto | Idéntico al punto 6: `\| false` descarta todo lo que no sea booleano JSON |
| 8 | **Anidarlos** bajo `ordenes`, `actuadores` o cualquier otra clave | `datos["rele"]` accede a la raíz. Idéntico al punto 6 |
| 9 | **Devolver 200 con un cuerpo que no sea JSON** (HTML de error de la plataforma) | `deserializeJson()` falla: no se rearma el failsafe, no se limpia el botón, relé off a los 45 s |
| 10 | **Devolver 201 o 204 en vez de 200** | `if (codigo == 200)` es comparación **estricta** (`.ino:583`) |
| 11 | **Cambiar el contrato de `boton`** — minúsculas, otro enum, o dejar de aceptarlo | Un 400 deja el botón **sin limpiar** (`.ino:612-622`) y el nodo reintenta el mismo evento cada 10 s **indefinidamente** |
| 12 | **Volver obligatorio un campo nuevo** en el cuerpo | El nodo manda cinco y solo cinco. Cualquier 400 nuevo lo deja mudo |
| 13 | **Dejar de aceptar `null`** en `temperatura` / `humedad` | Se perdería justo el caso "DHT roto con botón pendiente", el más urgente del nodo |
| 14 | **Bajar `SEGUNDOS_SIN_SENAL` por debajo de ~20 s** | Con `INTERVALO_MS = 10 s` y `HTTP_TIMEOUT_MS = 6 s`, un solo envío lento generaría un "Sensor sin señal" falso |
| 15 | **Superar los 6 s de respuesta** | `HTTP_TIMEOUT_MS = 6000` (`.ino:102`). Hoy el margen es de ~4x (§3.2). Cualquier trabajo síncrono nuevo en el handler lo come |
| 16 | **Dejar de escribir `dispositivos.ultimo_contacto_en`** | **NUEVO en esta etapa.** La vigilancia ahora se apoya en esa columna. Si `registrarContacto()` dejara de correr, el nodo sano parecería caído y generaría emergencias falsas cada 90 s |

### 5.3 No rompen nada — margen disponible

- **Agregar campos a la respuesta 200.** El firmware lee dos y nada más. Los
  cuatro campos nuevos (`dispositivo`, `compatibilidad`, `area_declarada`,
  `avisos`) ya lo demuestran.
- **Cambiar el valor de `area` en la respuesta**, o el contenido de `llamados` o
  de `avisos`: no se leen.
- **Cambiar umbrales, márgenes `MARGEN_TEMP_NORMAL` / `MARGEN_HUM_NORMAL`,
  textos de motivos, o los cuatro interruptores de automatización.** El firmware
  **no decide umbrales** por diseño (`.ino:21-22`): obedece `rele` y `alarma`.
  Verificado en §3.1.
- **Renombrar o dar de baja el área `INV-N`** (ver §5.1).
- **Hacer opcional cualquier campo del cuerpo.** El nodo manda los cinco
  siempre.
- **Apagar definitivamente `INGEST_PERMITE_CLAVE_GLOBAL`.** El nodo entra por
  credencial propia (§2.4).

---

## 6. Cambios de esta etapa

| Archivo | Cambio |
|---|---|
| `firmware/produccion_parque/produccion_parque.ino` | **ninguno** |
| `app/api/ingest/route.ts` | **ninguno en esta etapa** |
| `lib/alertas.ts` | vigilancia reescrita sobre `dispositivos` (§2.11). Archivo completo entregado |
| `tests/vigilancia.test.ts` | **nuevo** — 15 casos sobre `estaCaido()` |
| `documents/contexto/90-firmware.md` | este archivo |

`evaluarDesvios()`, los márgenes, `registrarLlamado()` con su antirrebote,
`hayEmergenciaAbierta()` y el catálogo `MOTIVOS` **no se tocaron**.

**Estado de las suites:** `yarn build` exit 0 · `yarn lint` sin hallazgos ·
`yarn test` **103 tests, 4 archivos, en verde**.

---

## 7. Efectos de estas pruebas sobre la base

Todo corrió contra la base real, porque es la única que hay.

| | Antes | Después | Delta |
|---|---|---|---|
| `lecturas` | 5 711 | **5 739** | **+28** |
| `lecturas` de `NODO-INV-N-01` (`dispositivo_id = 11`) | 299 | **327** | **+28** |
| `llamados` | 431 | **431** | **0** |
| `areas` | — | — | **0**, INV-N restaurada byte por byte |

**Las 28 lecturas nuevas están atribuidas al nodo físico, y hay que decir por
qué:** las pruebas usaron su credencial real, que es exactamente lo que había que
verificar. **No las escribió el hardware: las escribió curl desde esta máquina.**
Todas están dentro de rango salvo las cuatro deliberadamente fuera, ninguna
generó un llamado nuevo, y quedan identificables por su marca de tiempo
—`2026-09-10T14:02Z` a `14:1x Z`— contra el silencio del nodo desde las 02:59Z.

Sigue pendiente de la sesión anterior la fila **5720**, con texto
`NODO-INV-N-01` y `dispositivo_id 37`. La sentencia para corregirla está en
`80-simulador.md` §7.

---

## 8. Invariantes del contrato

**H-1. `rele` y `alarma` son booleanos JSON en la raíz de toda respuesta 200.**
No cambian de nombre, de tipo, de posición ni de significado. Es el invariante
que sostiene todo lo demás.

**H-2. Ningún camino de éxito omite `rele`.** Hay exactamente dos respuestas 200
y las dos lo traen literal.

**H-3. Ningún error del servidor se disfraza de 200.** El único 200 que "falla" a
propósito es el del dispositivo dado de baja, y responde `rele: false` para
apagar en el acto en vez de esperar 45 segundos.

**H-4. El servidor nunca interpreta polaridad.** Habla de intención
(`encendido`); la traducción a voltaje vive entera en `aplicarRele()`.

**H-5. El servidor no lee ningún estado previo del nodo.** Cada respuesta se
calcula desde el área y la lectura de esa misma petición.

**H-6. La arquitectura es pull.** El servidor nunca inicia contacto con el nodo.

**H-7. Una magnitud en `null` no alerta ni acciona.** No se afirma nada sobre lo
que no se midió.

**H-8. El nodo solo confirma un evento de botón con un 200 y JSON legible.** Un
error del servidor nunca pierde una pulsación.

**H-9. Solo se vigilan dispositivos `FISICO` y `activo`.** Un simulador que deja
de simular no es una emergencia.

**H-10. El código del área grabado en el firmware ya no decide nada.** Renombrar
`INV-N` dejó de ser un modo de ruptura.
