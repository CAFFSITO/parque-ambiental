# 40 — Pruebas de `/api/ingest` con curl

Ejecutadas el **2026-09-09** contra el servidor local (`yarn dev`, puerto 3000),
que apunta a la base real de Supabase.

## Preparación

La clave del nodo **no se escribe en este archivo**. Se lee del firmware a una
variable de entorno, que es la misma técnica que usa
`scripts/sembrar-credencial.js`:

```bash
export PAB_CLAVE=$(sed -n 's/^const char\* DEVICE_KEY = "\(.*\)";.*/\1/p' \
  firmware/produccion_parque/produccion_parque.ino)

U=http://localhost:3000/api/ingest
```

Esa cadena es hoy dos cosas a la vez: la **credencial heredada** del nodo
(`sql/09_credencial_nodo_fisico.sql`, `bcrypt-v1`) y la vieja **clave global**
`DEVICE_KEY`. Que las dos sean iguales es lo que hace útil la prueba 1: si la
respuesta trae `compatibilidad: false`, la cascada probó la credencial **antes**
que el fallback, que es el orden que no se puede invertir.

Helper usado en toda la corrida:

```bash
probar() { printf "\n--- %s\n" "$1"; shift; \
  curl -s -o /tmp/b -w "HTTP %{http_code}\n" "$@"; cat /tmp/b; echo; }
```

**Valores elegidos a propósito:** `temperatura: 22.5` y `humedad: 70` están
dentro del rango de INV-N (20–25 °C, 60–80 %), así que las pruebas **no generan
llamados**. Verificado: el conteo de `llamados` quedó en 431 antes y después.

---

## 1. Credencial propia + área correcta → 200

```bash
probar "1) credencial propia + area correcta" \
  -X POST $U -H "content-type: application/json" -H "x-device-key: $PAB_CLAVE" \
  -d '{"dispositivo":"NODO-INV-N-01","area":"INV-N","temperatura":22.5,"humedad":70,"boton":"NINGUNO"}'
```

```
HTTP 200
{"ok":true,"rele":false,"alarma":true,"area":"INV-N","llamados":[],
 "dispositivo":"NODO-INV-N-01","compatibilidad":false,
 "area_declarada":"INV-N","avisos":[]}
```

`rele` y `alarma` presentes y booleanos. **`compatibilidad: false`** con una
clave que también es la global: la credencial ganó.

---

## 2. Credencial propia + área EQUIVOCADA → 200, gana la base

```bash
probar "2) area equivocada en el body" \
  -X POST $U -H "content-type: application/json" -H "x-device-key: $PAB_CLAVE" \
  -d '{"dispositivo":"NODO-INV-N-01","area":"COM-1","temperatura":22.5,"humedad":70,"boton":"NINGUNO"}'
```

```
HTTP 200
{"ok":true,"rele":false,"alarma":true,"area":"INV-N","llamados":[],
 "dispositivo":"NODO-INV-N-01","compatibilidad":false,"area_declarada":"COM-1",
 "avisos":["El nodo declaró el área COM-1 pero tiene asignada INV-N. Se usó la asignada."]}
```

El body dijo `COM-1` (área 5) y la respuesta dice `INV-N`. **Verificado en la
fila insertada**, que es lo que importa:

```sql
select id, dispositivo, dispositivo_id, area_id, temperatura, humedad
  from lecturas order by id desc limit 3;
```

```
{"id":5685,"dispositivo":"NODO-INV-N-01","dispositivo_id":11,"area_id":1,...}
```

`area_id = 1` (INV-N), **no 5**. El body no eligió el área.

---

## 3. Sin campo `area` → 200

```bash
probar "3) sin campo area" \
  -X POST $U -H "content-type: application/json" -H "x-device-key: $PAB_CLAVE" \
  -d '{"dispositivo":"NODO-INV-N-01","temperatura":22.5,"humedad":70,"boton":"NINGUNO"}'
```

```
HTTP 200
{"ok":true,"rele":false,"alarma":true,"area":"INV-N","llamados":[],
 "dispositivo":"NODO-INV-N-01","compatibilidad":false,"area_declarada":null,"avisos":[]}
```

`area` ya no es obligatorio. Antes, faltando, devolvía **400**.

---

## 4. Clave global con el flag ENCENDIDO → 200 en modo compatibilidad

Requiere dos preparativos, los dos revertidos al final:

```bash
# 1. encender el flag (el servidor de dev recarga .env.local solo)
printf '\nINGEST_PERMITE_CLAVE_GLOBAL=1\n' >> .env.local

# 2. activar temporalmente un dispositivo sin credencial propia
#    (ESP32-INV-N, id 5, sembrado e inactivo)
```

```bash
probar "4) clave global con flag encendido" \
  -X POST $U -H "content-type: application/json" -H "x-device-key: $PAB_CLAVE" \
  -d '{"dispositivo":"ESP32-INV-N","area":"COM-1","temperatura":22.5,"humedad":70,"boton":"NINGUNO"}'
```

```
HTTP 200
{"ok":true,"rele":false,"alarma":true,"area":"INV-N","llamados":[],
 "dispositivo":"ESP32-INV-N","compatibilidad":true,"area_declarada":"COM-1",
 "avisos":["Modo compatibilidad: autenticado con la clave global. Emitile una credencial propia a ESP32-INV-N.",
           "El nodo declaró el área COM-1 pero tiene asignada INV-N. Se usó la asignada."]}
```

Dos cosas de una: **`compatibilidad: true`**, y aun así el área salió de la base
(`INV-N`) y no del body (`COM-1`). **No hay ninguna ruta por la que el body
pueda elegir el área de decisión**, ni siquiera en modo compatibilidad.

---

## 5. Clave global con el flag APAGADO → 401

```bash
probar "5) clave global con flag apagado" \
  -X POST $U -H "content-type: application/json" -H "x-device-key: $PAB_CLAVE" \
  -d '{"dispositivo":"ESP32-INV-N","area":"INV-N","temperatura":22.5,"humedad":70,"boton":"NINGUNO"}'
```

```
HTTP 401
{"ok":false,"error":"Clave de dispositivo inválida."}
```

`ESP32-INV-N` no tiene credencial propia; con el flag apagado no hay fallback.
Se repitió después de restaurar `.env.local` y volvió a dar 401.

---

## 6. Clave incorrecta → 401 con el shape que el firmware ya loguea

```bash
probar "6) clave incorrecta" \
  -X POST $U -H "content-type: application/json" -H "x-device-key: clave-que-no-es" \
  -d '{"dispositivo":"NODO-INV-N-01","area":"INV-N","temperatura":22.5,"humedad":70,"boton":"NINGUNO"}'

probar "6b) sin cabecera" \
  -X POST $U -H "content-type: application/json" \
  -d '{"dispositivo":"NODO-INV-N-01","temperatura":22.5,"humedad":70}'
```

```
HTTP 401
{"ok":false,"error":"Clave de dispositivo inválida."}
```

Mismo cuerpo y mismo código que la versión anterior. El firmware lo registra
como `HTTP 401: DEVICE_KEY incorrecta` (`.ino:633-640`) y **no cambia estado**:
no rearma el failsafe, no apaga el relé y no confirma el botón pendiente.

---

## 7. Dispositivo desactivado → 200 y NO se guarda lectura

Con el flag encendido y `ESP32-INV-N` de vuelta en inactivo:

```bash
probar "7) dispositivo desactivado" \
  -X POST $U -H "content-type: application/json" -H "x-device-key: $PAB_CLAVE" \
  -d '{"dispositivo":"ESP32-INV-N","temperatura":22.5,"humedad":70}'
```

```
HTTP 200
{"ok":true,"rele":false,"alarma":false,"area":null,"llamados":[],
 "dispositivo":"ESP32-INV-N","compatibilidad":false,"area_declarada":null,
 "avisos":["El dispositivo está dado de baja: la lectura no se guarda."]}
```

**Verificado que no guardó nada:**

```sql
select count(*) from lecturas where dispositivo_id = 5;   -- 673, sin cambios
```

Es 200 y no 4xx a propósito: con `rele: false` el relé se apaga **en el acto**.
Un 401 lo dejaría encendido 45 segundos hasta que actúe el failsafe del nodo, y
además dejaría el botón pendiente reintentándose cada 10 segundos.

---

## 8. Payload inválido → 400

```bash
probar "8a) no-JSON"            -X POST $U -H "content-type: application/json" -H "x-device-key: $PAB_CLAVE" -d 'esto no es json'
probar "8b) sin dispositivo"    -X POST $U -H "content-type: application/json" -H "x-device-key: $PAB_CLAVE" -d '{"area":"INV-N","temperatura":22.5,"humedad":70,"boton":"NINGUNO"}'
probar "8c) boton invalido"     -X POST $U -H "content-type: application/json" -H "x-device-key: $PAB_CLAVE" -d '{"dispositivo":"NODO-INV-N-01","boton":"normal"}'
```

```
HTTP 400  {"ok":false,"error":"El cuerpo no es JSON válido."}
HTTP 400  {"ok":false,"error":"Falta el campo dispositivo."}
HTTP 400  {"ok":false,"error":"El campo boton tiene que ser NINGUNO, NORMAL o EMERGENCIA."}
```

Los tres mensajes son **los mismos de antes**.

---

## 9. El POST exacto del firmware → 200 con `rele` y `alarma` booleanos

Mismo JSON que arma el `.ino` (`:551-571`: `dispositivo`, `area`,
`temperatura`, `humedad`, `boton`), mismas cabeceras (`:541-549`), y la clave
real del nodo:

```bash
curl -s -X POST $U \
  -H "Content-Type: application/json" \
  -H "x-device-key: $PAB_CLAVE" \
  -d '{"dispositivo":"NODO-INV-N-01","area":"INV-N","temperatura":22.5,"humedad":70,"boton":"NINGUNO"}'
```

```
{"ok":true,"rele":false,"alarma":true,"area":"INV-N","llamados":[],
 "dispositivo":"NODO-INV-N-01","compatibilidad":false,"area_declarada":"INV-N","avisos":[]}
```

Y la telemetría quedó registrada:

```
ultimo_contacto_en  -> 2026-09-09T23:18:51.661+00:00
credencial usada_en -> 2026-09-09T23:18:51.661+00:00
```

`usada_en` avanzando es la prueba de que entró **por su credencial** y no por el
fallback global.

---

## 10. Regresión: el contrato que el firmware lee

```
OK  existe ok
OK  existe rele
OK  existe alarma
OK  rele es boolean
OK  alarma es boolean
OK  ok === true
valores: rele=false  alarma=true  area=INV-N
```

Los dos campos que el firmware lee (`datos["rele"]` y `datos["alarma"]`,
`.ino:604-608`) conservan **nombre, tipo y nivel en la raíz**.

---

## 11. Extra: valor fuera de rango físico

No estaba en la lista, pero se implementó y conviene dejarlo probado:

```bash
probar "11) temperatura imposible" \
  -X POST $U -H "content-type: application/json" -H "x-device-key: $PAB_CLAVE" \
  -d '{"dispositivo":"NODO-INV-N-01","temperatura":999,"humedad":70,"boton":"NINGUNO"}'
```

```
HTTP 200
{"ok":true,"rele":false,"alarma":true,"area":"INV-N","llamados":[],
 "dispositivo":"NODO-INV-N-01","compatibilidad":false,"area_declarada":null,
 "avisos":["Temperatura fuera de rango físico (999,0 °C): se descartó."]}
```

La fila quedó con `temperatura: null` y `humedad: 70`. Se descarta **el valor**,
no la petición: un 400 dejaría al nodo sin órdenes y con el botón reintentándose
cada 10 segundos mientras el sensor siga roto.

---

## Efectos sobre la base

Todo esto corrió contra la base real, porque es la única que hay. Lo que quedó:

| | Antes | Después | Delta |
|---|---|---|---|
| `lecturas` | 5 683 | 5 690 | **+7** |
| `llamados` | 431 | 431 | **0** |

Las 7 filas (ids 5684–5690) son de `NODO-INV-N-01` y `ESP32-INV-N`, con valores
dentro de rango. **No se creó ningún llamado**, que era el efecto que había que
evitar: un llamado falso aparece en la bandeja del operador.

Cambios temporales, los dos revertidos y verificados:

| Cambio | Revertido |
|---|---|
| `INGEST_PERMITE_CLAVE_GLOBAL=1` en `.env.local` | sí — restaurado desde copia; confirmado con un 401 posterior |
| `ESP32-INV-N` activado para la prueba 4 | sí — vuelto a `activo = false`; el único activo es `NODO-INV-N-01` |

---

## Qué falta probar, y con qué

- **Un dispositivo con credencial `sha256-v1`.** Todo lo probado usa el camino
  heredado (`bcrypt-v1`), que es el único que hay sembrado. El camino rápido
  está cubierto por los tests unitarios de `tests/credenciales.test.ts`, pero no
  de punta a punta.
- **El nodo físico real.** Las pruebas reproducen su POST, no son el nodo.
  Cuando vuelva a reportar, hay que confirmar que `usada_en` avanza.
- **El simulador del panel.** Usa `process.env.DEVICE_KEY`
  (`dispositivos/acciones.ts:47`), así que con el flag apagado **recibe 401**.
  Ver la advertencia de `12-contrato-ingest-objetivo.md` §8.5.
