# 01 — Contrato ACTUAL de `POST /api/ingest`

Fuente única: `app/api/ingest/route.ts` (226 líneas), más `lib/alertas.ts`,
`lib/catalogos.ts` y `lib/avisos.ts` para lo que la ruta delega.

Este documento describe **lo que el endpoint hace hoy**, no lo que debería
hacer. Todo cita `archivo:línea`.

---

## 1. Request

### 1.1 Método y ruta

- `POST /api/ingest` → `export async function POST(request: NextRequest)`
  (`app/api/ingest/route.ts:77`).
- `GET /api/ingest` → responde **405** con
  `{ ok: false, error: "Usá POST con la cabecera x-device-key." }`
  (`app/api/ingest/route.ts:221-226`). No hay handler para PUT, PATCH, DELETE ni
  OPTIONS: Next devuelve 405 por su cuenta.
- La ruta es **pública para el proxy** (`proxy.ts:12`): no necesita cookie de
  sesión.

### 1.2 Headers

| Header | Obligatorio | Qué hace |
|---|---|---|
| `x-device-key` | **sí** | se compara por igualdad exacta con `process.env.DEVICE_KEY` (`app/api/ingest/route.ts:86`) |
| `content-type: application/json` | de hecho sí | el cuerpo se lee con `request.json()` (`:92`); sin JSON válido, 400 |

No hay lista blanca de IPs, ni firma HMAC, ni nonce, ni verificación de
frescura. La única credencial es la clave estática compartida.

### 1.3 Cuerpo

Tipo declarado (`app/api/ingest/route.ts:23-29`):

```ts
type CuerpoIngesta = {
  dispositivo: string;
  area: string;
  temperatura: number | null;
  humedad: number | null;
  boton: "NINGUNO" | "NORMAL" | "EMERGENCIA";
};
```

Validación real, en `leerCuerpo()` (`app/api/ingest/route.ts:49-75`):

| Campo | Regla | Si falla |
|---|---|---|
| (raíz) | tiene que ser objeto JSON no nulo (`:50-52`) | 400 `"El cuerpo tiene que ser un objeto JSON."` |
| `dispositivo` | string; se le hace `.trim()`; no puede quedar vacío (`:56-58`) | 400 `"Falta el campo dispositivo."` |
| `area` | string; `.trim()`; no vacío (`:60-61`); luego **`.toUpperCase()`** (`:70`) | 400 `"Falta el campo area."` |
| `boton` | ausente → `"NINGUNO"` (`:63`); si está, tiene que ser uno de los tres (`:64-66`) | 400 `"El campo boton tiene que ser NINGUNO, NORMAL o EMERGENCIA."` |
| `temperatura` | `aNumero()` (`:39-47`): número finito, o string numérico no vacío; **cualquier otra cosa, incluido `null`, se convierte en `null` sin error** | nunca falla |
| `humedad` | ídem | nunca falla |

Notas verificables:

- `dispositivo` **no se valida contra ninguna tabla ni lista**. Cualquier cadena
  no vacía se acepta y se escribe tal cual en `lecturas.dispositivo`
  (`:128-134`).
- `boton` acepta el string en mayúsculas exactas. `"normal"` en minúscula es
  400.
- No hay límite de largo para `dispositivo` ni para `area`.
- Campos extra en el JSON se ignoran silenciosamente.

---

## 2. Todos los códigos de respuesta

Todas las respuestas salen por `json()` (`app/api/ingest/route.ts:31-33`), que
es `Response.json(cuerpo, { status })`.

| Status | Condición | Cuerpo exacto |
|---|---|---|
| **500** | `process.env.DEVICE_KEY` ausente o vacía (`:78-84`) | `{ "ok": false, "error": "DEVICE_KEY no está configurada en el servidor." }` |
| **401** | `x-device-key` distinta de `DEVICE_KEY` (`:86-88`) | `{ "ok": false, "error": "Clave de dispositivo inválida." }` |
| **400** | `request.json()` lanza (`:90-95`) | `{ "ok": false, "error": "El cuerpo no es JSON válido." }` |
| **400** | `leerCuerpo()` devuelve un string de error (`:97-100`) | `{ "ok": false, "error": "<uno de los cuatro mensajes de §1.3>" }` |
| **500** | error al leer el área en Supabase (`:113-118`) | `{ "ok": false, "error": "No se pudo leer el área: <error.message de Supabase>" }` |
| **404** | no existe un área con ese `codigo` (`:119-124`) | `` { "ok": false, "error": "No existe un área con código <AREA>." } `` |
| **500** | error al insertar la lectura (`:136-144`) | `{ "ok": false, "error": "No se pudo guardar la lectura: <error.message>" }` |
| **200** | camino feliz (`:207-217`) | ver §3 |
| **405** | método GET (`:221-226`) | `{ "ok": false, "error": "Usá POST con la cabecera x-device-key." }` |

Detalle importante del orden: **la validación del área ocurre ANTES de guardar
la lectura**. Si el `area` no existe, se responde 404 y **la lectura se pierde**
(`:104-134`). El comentario `// 1. La lectura se guarda siempre` (`:126`) está
escrito debajo del bloque que puede cortar con 404: se guarda siempre *salvo*
que el área no exista.

Los mensajes de 500 propagan el `message` de Supabase al cliente sin filtrar
(`:115`, `:141`).

---

## 3. Shape exacto de la respuesta 200

Construido en `app/api/ingest/route.ts:207-217`:

```json
{
  "ok": true,
  "rele": false,
  "alarma": false,
  "area": "INV-N",
  "llamados": [
    { "motivo": "Temperatura por encima del umbral", "tipo": "EMERGENCIA", "resultado": "creado" }
  ]
}
```

| Campo | Tipo | Origen |
|---|---|---|
| `ok` | `true` literal | `:209` |
| `rele` | boolean | expresión de `:200-203`, transcrita en §4 |
| `alarma` | boolean | `await hayEmergenciaAbierta(area.id)` (`:205`) |
| `area` | string | `area.codigo` tal como está en la tabla, **no** el que mandó el nodo (`:213`). El comentario de `:212` lo declara informativo: "el nodo puede ignorarlo" |
| `llamados` | array | acumulado en `:146` y llenado en `:166-170` y `:194` |

Elementos de `llamados` (`app/api/ingest/route.ts:146`):

```ts
{ motivo: string; tipo: string; resultado: string }
```

- `motivo`: uno de `MOTIVOS` (`lib/catalogos.ts:137-149`).
- `tipo`: `"NORMAL"` o `"EMERGENCIA"`.
- `resultado`: `"creado"` | `"actualizado"` | `"error"`, que es el
  `ResultadoRegistro` de `lib/alertas.ts:117`.

`llamados` es `[]` si no hubo desvíos ni botón, y **siempre `[]` si el área está
inactiva**, porque todo el bloque que lo llena está dentro de `if (area.activa)`
(`:150-196`).

---

## 4. Dónde se decide el relé — expresión literal

`app/api/ingest/route.ts:200-203`, transcrita textualmente:

```ts
  const rele =
    (cuerpo.temperatura !== null &&
      cuerpo.temperatura > Number(area.temp_max)) ||
    (cuerpo.humedad !== null && cuerpo.humedad < Number(area.hum_min));
```

Lectura de esa expresión:

- Se prende si hace **más calor** que `temp_max` (ventilar) **o** si hay **menos
  humedad** que `hum_min` (regar). El comentario de `:199` lo dice así.
- Es una comparación estricta `>` y `<`: estar exactamente en el límite deja el
  relé apagado.
- **No usa `evaluarDesvios()`** ni el concepto de EMERGENCIA: es una regla
  aparte, calculada de nuevo sobre los mismos umbrales.
- **No depende de `area.activa`**: se evalúa fuera del `if (area.activa)`, así
  que un área dada de baja igual recibe órdenes de relé.
- `temperatura` o `humedad` en `null` (DHT en fallo) hacen que ese término sea
  falso, nunca verdadero.

## 5. Dónde se decide la alarma

`app/api/ingest/route.ts:205`:

```ts
  const alarma = await hayEmergenciaAbierta(area.id);
```

`hayEmergenciaAbierta()` está en `lib/alertas.ts:194-203`:

```ts
  const { count } = await db()
    .from("llamados")
    .select("id", { count: "exact", head: true })
    .eq("area_id", areaId)
    .eq("tipo", "EMERGENCIA")
    .eq("estado", "NO_ATENDIDO");

  return (count ?? 0) > 0;
```

O sea: **la alarma es del ÁREA, no del nodo**. Cualquier llamado de tipo
EMERGENCIA con estado NO_ATENDIDO en esa área prende la sirena del nodo, sin
importar quién lo creó: puede ser un desvío de sensor, un botón, una caída de
otro nodo de la misma área, un llamado cargado a mano desde el panel o
`/movil`, o un llamado sembrado por `sql/02_datos.sql`. Se apaga sola cuando
alguien atiende todos esos llamados (`atenderLlamado`,
`app/(panel)/llamados/acciones.ts:60-69`).

Consecuencia verificada contra la base el 2026-09-09 (consulta:
`GET /rest/v1/llamados?select=id&area_id=eq.<n>&tipo=eq.EMERGENCIA&estado=eq.NO_ATENDIDO`
con `Prefer: count=exact`): **las ocho áreas tienen emergencias abiertas** —
INV-N 8, INV-S 4, INV-G 4, HID-1 5, COM-1 2, VIV-1 9, RIE-1 3, DEP-1 2. Es
decir que **hoy `/api/ingest` responde `alarma: true` a cualquier nodo, en
cualquier área**, y el buzzer del nodo físico suena de forma permanente hasta
que alguien cierre los 8 llamados de INV-N (varios de ellos son datos sembrados
por `sql/02_datos.sql`, no incidentes reales).

Y `alarma` también se evalúa fuera de `if (area.activa)` (`:205` está después
del cierre del bloque en `:196`).

---

## 6. Cómo se resuelve hoy el área

Cadena completa:

1. El nodo manda `area` en el cuerpo
   (`firmware/produccion_parque/produccion_parque.ino:557`,
   `cuerpo["area"] = AREA_COMPATIBILIDAD;` con
   `AREA_COMPATIBILIDAD = "INV-N"`, `:64`).
2. `leerCuerpo()` lo normaliza a mayúsculas: `area: area.toUpperCase()`
   (`app/api/ingest/route.ts:70`).
3. Se busca por **`areas.codigo`** (`app/api/ingest/route.ts:104-111`):

```ts
  const { data: area, error: errorArea } = await db()
    .from("areas")
    .select(
      "id, codigo, nombre, tipo, temp_min, temp_max, hum_min, hum_max, activa, creada_en",
    )
    .eq("codigo", cuerpo.area)
    .maybeSingle()
```

4. Si no aparece: **404**, y la lectura no se guarda (`:119-124`).
5. Si aparece, `area.id` se usa para: la lectura (`:130`), los llamados
   (`:157`, `:181`), y la consulta de alarma (`:205`).

**El campo `dispositivo` NO participa en absoluto de la resolución del área.**
No hay tabla de dispositivos; no hay columna que ate un nodo a un área. Un nodo
que mande `area: "COM-1"` escribe en Compostaje aunque físicamente esté en el
Invernadero Norte. El propio firmware documenta que esto es una muleta y que el
backend debería resolver el área por identidad del dispositivo
(`firmware/produccion_parque/produccion_parque.ino:23-27` y `:62-63`), pero el
backend **hoy no lo hace**.

---

## 7. Qué pasa entre el 400 y el 200 (secuencia real)

Orden efectivo dentro de `POST` (`app/api/ingest/route.ts:77-217`):

1. `DEVICE_KEY` configurada (`:78`) → si no, 500.
2. `x-device-key` correcta (`:86`) → si no, 401.
3. `request.json()` (`:90-95`) → si no, 400.
4. `leerCuerpo()` (`:97-100`) → si no, 400.
5. Lectura del área por `codigo` (`:104-124`) → 500 o 404.
6. **INSERT en `lecturas`** con `tomada_en = momento.toISOString()`, siendo
   `momento = new Date()` del servidor (`:127-134`) → 500 si falla.
7. Si `area.activa` (`:150`):
   - `evaluarDesvios(area, temperatura, humedad)` (`lib/alertas.ts:40-101`)
     devuelve 0, 1 o 2 desvíos (temperatura y humedad son problemas separados).
     Cada uno se registra con `registrarLlamado()` (`:156-164`).
   - Si `boton !== "NINGUNO"`, un llamado más, con
     `origen: "EMPLEADO"` y motivo `BOTON_EMERGENCIA` o `ASISTENCIA` según el
     tipo de pulsación (`:174-195`).
8. Se calcula `rele` (`:200-203`) y `alarma` (`:205`).
9. Se responde 200.

### 7.1 Clasificación NORMAL vs EMERGENCIA

`lib/alertas.ts:14-15`:

```ts
export const MARGEN_TEMP_NORMAL = 3; // °C
export const MARGEN_HUM_NORMAL = 10; // puntos de humedad
```

Un desvío es EMERGENCIA si la magnitud **supera** el margen
(`lib/alertas.ts:57`, `:67`, `:81`, `:91`); si no, NORMAL. Los cuatro motivos
posibles son `TEMP_ALTA`, `TEMP_BAJA`, `HUM_ALTA`, `HUM_BAJA`
(`lib/catalogos.ts:138-141`).

### 7.2 Antirrebote

`registrarLlamado()` (`lib/alertas.ts:128-191`) busca un llamado
`NO_ATENDIDO` de la **misma área y el mismo motivo** (`:140-142`). Si existe:

- solo actualiza `detalle`, y sube `tipo` a `EMERGENCIA` si el abierto era
  `NORMAL` y la condición empeoró (`:152-164`);
- devuelve `"actualizado"`;
- **no manda ningún aviso** (`lib/alertas.ts:179-181`).

Si no existe, inserta y llama `avisarNuevoLlamado()` (`:182-188`), que agenda
push + Telegram con `after()` para no hacer esperar al nodo
(`lib/avisos.ts:75-97`).

La clave de deduplicación es literalmente el texto del motivo. `lib/catalogos.ts:133-136`
advierte que cambiar esos textos rompe la deduplicación de los llamados
abiertos.

### 7.3 Área inactiva

`if (area.activa)` (`:150`) delimita **solo** la generación de llamados. Con el
área dada de baja:

- la lectura **sí** se guarda;
- `llamados` vuelve `[]`;
- `rele` **sí** se calcula y puede venir `true`;
- `alarma` **sí** se consulta y puede venir `true` por llamados viejos.

---

## 8. Quién más llama a este endpoint hoy

- El nodo físico, por HTTPS a
  `https://parque-ambiental.vercel.app/api/ingest`
  (`firmware/produccion_parque/produccion_parque.ino:54`).
- El **simulador del panel**, que arma la request en el servidor con la misma
  `DEVICE_KEY` y golpea la propia app por HTTP
  (`app/(panel)/dispositivos/acciones.ts:69-83`). Requiere `exigirAdmin()`
  (`:45`) para usarse, pero desde el punto de vista de `/api/ingest` es
  **indistinguible del nodo real**.

`/api/ingest` no tiene forma de saber cuál de los dos le habló.
