# 00 — Auditoría y congelado del estado actual

Fecha de la auditoría: **2026-09-09**.
Repositorio: `C:\Users\sofia\parque-ambiental`, rama `main`, HEAD `7cba21e`.

Método: lectura directa de los archivos del repositorio (toda afirmación cita
`archivo:línea`) y consulta en vivo a la base de datos de Supabase a través de
PostgREST con `SUPABASE_SERVICE_KEY` (las consultas usadas se transcriben en la
sección correspondiente). Ninguna afirmación de este documento proviene de
inferencia: lo que no se pudo verificar está marcado **NO VERIFICADO**.

---

## 1. Stack y versiones exactas

Origen: `package.json:1-33`.

| Paquete | Versión declarada |
|---|---|
| `next` | `16.3.3` (exacta, sin rango) |
| `react` / `react-dom` | `19.2.8` (exactas) |
| `@supabase/supabase-js` | `^2.112.4` |
| `bcryptjs` | `^3.0.3` |
| `jose` | `^6.2.10` |
| `recharts` | `^3.10.1` |
| `web-push` | `^3.6.7` |
| `typescript` | `^5` |
| `tailwindcss` / `@tailwindcss/postcss` | `^4` |
| `eslint` | `^9`, `eslint-config-next` `16.3.3` |
| `@types/node` | `^20` |

Gestor de paquetes: `yarn@4.18.0` (`package.json:32`), con
`nodeLinker: node-modules` (`.yarnrc.yml:1`).

Scripts (`package.json:5-10`): `dev` = `next dev`, `build` = `next build`,
`start` = `next start`, `lint` = `eslint`. **No hay script `test`**.

`tsconfig.json`: `strict: true` (`tsconfig.json:9`), `target ES2017` (`:3`),
`moduleResolution: bundler` (`:12`), alias `@/* -> ./*` (`:20-22`), `noEmit`
(`:10`).

`next.config.ts`:

- `serverExternalPackages: ["web-push"]` (`next.config.ts:7`), porque `web-push`
  hace `require` dinámicos de los módulos de crypto de Node.
- `experimental.authInterrupts: true` (`next.config.ts:11`), que es lo que
  habilita `forbidden()` y `app/forbidden.tsx`.
- `headers()` fuerza `Content-Type: application/javascript; charset=utf-8` y
  `Cache-Control: no-cache, no-store, must-revalidate` sobre `/sw.js`
  (`next.config.ts:14-34`).

`eslint.config.mjs`: `defineConfig` con `eslint-config-next/core-web-vitals` y
`eslint-config-next/typescript`, más `globalIgnores` de `.next/**`, `out/**`,
`build/**`, `next-env.d.ts` (`eslint.config.mjs:1-18`).

Estado del build al momento de la auditoría: `yarn build` termina con **exit
code 0**, compila en 2.0 s, TypeScript en 2.0 s, 17 páginas generadas, y el
reporte de rutas marca `ƒ Proxy (Middleware)`.

---

## 2. Proxy (Next 16 reemplaza `middleware.ts` por `proxy.ts`)

Archivo: `proxy.ts` en la raíz del proyecto. La documentación empaquetada lo
confirma:
`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md:10`
("The `middleware` file convention is deprecated and has been renamed to
`proxy`") y `:255` ("Proxy defaults to using the Node.js runtime. The `runtime`
config option is not available in Proxy files").

Función exportada: `export async function proxy(request: NextRequest)`
(`proxy.ts:20`).

Rutas públicas (`proxy.ts:12`):

```ts
const RUTAS_PUBLICAS = ["/login", "/api/ingest", "/api/vigilancia"];
```

`esPublica()` (`proxy.ts:14-18`) considera pública la ruta exacta y cualquier
descendiente (`ruta.startsWith(publica + "/")`).

Comportamiento (`proxy.ts:20-47`):

1. Lee la cookie `pab_sesion` y la verifica con `verificarSesion()`.
2. Si la ruta es pública: si es `/login` **y** hay sesión, redirige a `/`
   (`proxy.ts:27-32`); si no, `NextResponse.next()`.
3. Si hay sesión, deja pasar (`proxy.ts:36`).
4. Si no hay sesión, redirige a `/login` con `?desde=<pathname>` salvo que el
   pathname sea `/` (`proxy.ts:38-42`), y si venía cookie la borra
   (`proxy.ts:45`).

Matcher (`proxy.ts:49-53`):

```
/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|txt|xml)$).*)
```

Consecuencia verificable: `/api/exportar/csv` **no** está en `RUTAS_PUBLICAS`,
así que el proxy le exige sesión, y además la ruta llama `exigirAdmin()`
internamente (`app/api/exportar/csv/route.ts:70`).

---

## 3. Mapa de rutas del App Router y qué exige cada una

Rutas efectivamente construidas, según la salida de `yarn build`: `/`,
`/_not-found`, `/api/exportar/csv`, `/api/ingest`, `/api/vigilancia`, `/areas`,
`/avisos`, `/dispositivos`, `/empleados`, `/icon.png`, `/llamados`, `/login`,
`/movil`, `/reportes`, `/reportes/imprimir`, `/usuarios`. Todas dinámicas (`ƒ`)
salvo `/_not-found` y `/icon.png` (`○`).

| Ruta | Archivo | Guardia en el servidor | Guardia del proxy |
|---|---|---|---|
| `/` (tablero) | `app/(panel)/page.tsx:152` | `getSesion()` + `redirect("/login")` si es null (`:153-154`) | sesión |
| `/llamados` | `app/(panel)/llamados/page.tsx:33` | `exigirSesion()` (`:34`) | sesión |
| `/movil` | `app/(panel)/movil/page.tsx:18` | `exigirSesion()` (`:19`) | sesión |
| `/avisos` | `app/(panel)/avisos/page.tsx:15` | `exigirSesion()` (`:16`) | sesión |
| `/areas` | `app/(panel)/areas/page.tsx` | `exigirAdmin()` (`:24`) | sesión |
| `/empleados` | `app/(panel)/empleados/page.tsx` | `exigirAdmin()` (`:29`) | sesión |
| `/usuarios` | `app/(panel)/usuarios/page.tsx` | `exigirAdmin()` (`:14`) | sesión |
| `/dispositivos` | `app/(panel)/dispositivos/page.tsx` | `exigirAdmin()` (`:15`) | sesión |
| `/reportes` | `app/(panel)/reportes/page.tsx` | `exigirAdmin()` (`:59`) | sesión |
| `/reportes/imprimir` | `app/(panel)/reportes/imprimir/page.tsx` | `exigirAdmin()` (`:75`) | sesión |
| `/login` | `app/login/page.tsx:14` | `getSesion()`; con sesión `redirect("/")` (`:15-16`) | público |
| `/api/ingest` (POST) | `app/api/ingest/route.ts:77` | cabecera `x-device-key` == `DEVICE_KEY` (`:86`) | público |
| `/api/ingest` (GET) | `app/api/ingest/route.ts:221` | ninguna; devuelve 405 siempre | público |
| `/api/vigilancia` (GET/POST) | `app/api/vigilancia/route.ts:36,40` | `x-device-key` **o** `getSesion() !== null` (`:12-16`) | público |
| `/api/exportar/csv` (GET) | `app/api/exportar/csv/route.ts:69` | `exigirAdmin()` (`:70`) | sesión |
| `app/forbidden.tsx` | — | pantalla 403 que renderiza Next al llamar `forbidden()` | — |

Layout del grupo `(panel)`: `app/(panel)/layout.tsx:38-44` vuelve a hacer
`getSesion()` y `redirect("/login")` si no hay sesión, y arma la navegación
según el rol (`:15-36`).

Menú por rol (`app/(panel)/layout.tsx:15-32`) — es **solo presentación**:

- `NAV_ADMINISTRADOR`: Tablero, Llamados, Móvil, Áreas, Empleados, Usuarios,
  Dispositivos, Reportes, Avisos.
- `NAV_EMPLEADO`: Tablero, Llamados, Móvil, Avisos.

Ocultar un ítem no protege nada; la protección real la da `exigirAdmin()` en
cada página y en cada Server Action (ver §7).

---

## 4. Esquema real de la base de datos

**Verificado en vivo** contra Supabase el 2026-09-09, leyendo el documento
OpenAPI que PostgREST publica en `GET {SUPABASE_URL}/rest/v1/` con la
`SUPABASE_SERVICE_KEY`. En ese documento, la lista `required` de cada definición
corresponde a las columnas `NOT NULL`.

Tablas expuestas por PostgREST: `areas`, `empleados`, `usuarios`, `lecturas`,
`llamados`, `ajustes`, `suscripciones_push`. No hay ninguna otra.

> **Nota de vigencia.** Esta sección describe el esquema **verificado en vivo el
> 2026-09-09**, antes de las migraciones `sql/06`, `sql/07` y `sql/08`. El
> esquema que quedará una vez aplicadas está en **§11**, y esas tres migraciones
> **todavía no fueron aplicadas** (ver `20-migraciones-aplicadas.md` §6).

### 4.1 `areas`

| Columna | Tipo | Nullable | Notas |
|---|---|---|---|
| `id` | integer | NOT NULL | Primary key |
| `codigo` | text | NOT NULL | `unique` según `sql/01_esquema.sql:19` |
| `nombre` | text | NOT NULL | |
| `tipo` | text | NOT NULL | |
| `temp_min` | numeric | NOT NULL | |
| `temp_max` | numeric | NOT NULL | |
| `hum_min` | numeric | NOT NULL | |
| `hum_max` | numeric | NOT NULL | |
| `activa` | boolean | NOT NULL | |
| `creada_en` | timestamptz | NOT NULL | |

### 4.2 `empleados`

| Columna | Tipo | Nullable | Notas |
|---|---|---|---|
| `id` | integer | NOT NULL | Primary key |
| `legajo` | text | NOT NULL | `unique` según `sql/01_esquema.sql:35` |
| `nombre` | text | NOT NULL | |
| `apellido` | text | NOT NULL | |
| `dni` | text | NOT NULL | |
| `fecha_nacimiento` | date | NULL | |
| `telefono` | text | NULL | |
| `email` | text | NULL | |
| `domicilio` | text | NULL | |
| `area_id` | integer | NULL | FK → `areas.id` |
| `tarea` | text | NULL | |
| `turno` | **text** | NULL | era `char(1)`; `sql/04_multiseleccion.sql:16-17` lo convirtió — **confirmado en vivo: hoy es `text`** |
| `fecha_ingreso` | date | NULL | |
| `estado` | text | NOT NULL | |
| `observaciones` | text | NULL | |
| `creado_en` | timestamptz | NOT NULL | |
| `areas_ids` | integer[] | NOT NULL | agregada por `sql/04_multiseleccion.sql:19-20` |
| `tareas` | text[] | NOT NULL | `sql/04_multiseleccion.sql:22-23` |
| `turnos` | text[] | NOT NULL | `sql/04_multiseleccion.sql:25-26` |

**`sql/04_multiseleccion.sql` está aplicado en la base real.**

### 4.3 `usuarios`

| Columna | Tipo | Nullable | Notas |
|---|---|---|---|
| `id` | integer | NOT NULL | Primary key |
| `usuario` | text | NOT NULL | `unique` según `sql/01_esquema.sql:57` |
| `password_hash` | text | NOT NULL | bcrypt |
| `rol` | text | NOT NULL | `check in ('ADMINISTRADOR','EMPLEADO')` según `sql/01_esquema.sql:59` |
| `empleado_id` | integer | NULL | FK → `empleados.id` |
| `area_id` | integer | NULL | FK → `areas.id` |
| `activo` | boolean | NOT NULL | |
| `creado_en` | timestamptz | NOT NULL | |

### 4.4 `lecturas`

| Columna | Tipo | Nullable | Notas |
|---|---|---|---|
| `id` | bigint | NOT NULL | Primary key |
| `dispositivo` | text | NULL | |
| `area_id` | integer | NULL | FK → `areas.id` |
| `temperatura` | numeric | NULL | |
| `humedad` | numeric | NULL | |
| `tomada_en` | timestamptz | NOT NULL | |

### 4.5 `llamados`

| Columna | Tipo | Nullable | Notas |
|---|---|---|---|
| `id` | bigint | NOT NULL | Primary key |
| `area_id` | integer | NULL | FK → `areas.id` |
| `tipo` | text | NOT NULL | `check in ('NORMAL','EMERGENCIA')` según `sql/01_esquema.sql:84` |
| `origen` | text | NOT NULL | `check in ('SENSOR','EMPLEADO')` según `sql/01_esquema.sql:85` |
| `estado` | text | NOT NULL | `check in ('NO_ATENDIDO','ATENDIDO')` según `sql/01_esquema.sql:86` |
| `motivo` | text | NULL | **sin constraint: el catálogo cerrado vive solo en TypeScript** |
| `detalle` | text | NULL | |
| `creado_por` | text | NULL | |
| `creado_en` | timestamptz | NOT NULL | |
| `atendido_por` | text | NULL | |
| `atendido_en` | timestamptz | NULL | |

### 4.6 `ajustes`

| Columna | Tipo | Nullable | Notas |
|---|---|---|---|
| `clave` | text | NOT NULL | Primary key |
| `valor` | text | NOT NULL | |
| `actualizado_en` | timestamptz | NOT NULL | |
| `actualizado_por` | text | NULL | |

### 4.7 `suscripciones_push`

| Columna | Tipo | Nullable | Notas |
|---|---|---|---|
| `id` | bigint | NOT NULL | Primary key |
| `usuario_id` | integer | NOT NULL | FK → `usuarios.id`, `on delete cascade` (`sql/05_avisos.sql:82`) |
| `endpoint` | text | NOT NULL | `unique` (`sql/05_avisos.sql:83`); es el `onConflict` de los upsert |
| `p256dh` | text | NOT NULL | |
| `auth` | text | NOT NULL | |
| `dispositivo` | text | NULL | |
| `activa` | boolean | NOT NULL | |
| `creada_en` | timestamptz | NOT NULL | |
| `usada_en` | timestamptz | NULL | |

**`sql/05_avisos.sql` está aplicado en la base real** (las dos tablas existen).

### 4.8 Constraints, defaults, índices y triggers

**NO VERIFICADO EN VIVO.** PostgREST no expone `pg_catalog` ni
`information_schema`, y verificar un `check` o un `unique` por la vía de
intentar una inserción inválida sería DML, prohibido en esta etapa.

Lo que sigue es lo que **declaran los archivos** `sql/`, y debe tratarse como
*intención*, no como estado confirmado:

- Defaults: `areas.activa = true`, `areas.creada_en = now()`
  (`sql/01_esquema.sql:26-27`); `empleados.estado = 'activo'`,
  `empleados.creado_en = now()` (`:47,49`); `usuarios.activo = true`,
  `usuarios.creado_en = now()` (`:62-63`); `lecturas.tomada_en = now()` (`:75`);
  `llamados.estado = 'NO_ATENDIDO'`, `llamados.creado_en = now()` (`:86,90`);
  `empleados.areas_ids/tareas/turnos = '{}'`
  (`sql/04_multiseleccion.sql:20,23,26`); `suscripciones_push.activa = true`,
  `creada_en = now()` (`sql/05_avisos.sql:87-88`); `ajustes.actualizado_en =
  now()` (`sql/05_avisos.sql:107`).
- Uniques: `areas.codigo` (`:19`), `empleados.legajo` (`:35`),
  `usuarios.usuario` (`:57`), `suscripciones_push.endpoint`
  (`sql/05_avisos.sql:83`).
- Checks: los tres de `llamados` y el de `usuarios.rol`, citados arriba.
- Índices declarados: `idx_llamados_creado_en (creado_en desc)`,
  `idx_llamados_area (area_id)`, `idx_llamados_estado (estado)`,
  `idx_lecturas_area_hora (area_id, tomada_en desc)`
  (`sql/01_esquema.sql:98-101`); `idx_empleados_areas`, `idx_empleados_turnos`,
  `idx_empleados_tareas`, los tres `using gin`
  (`sql/04_multiseleccion.sql:53-55`); `idx_suscripciones_usuario`,
  `idx_suscripciones_activa` (`sql/05_avisos.sql:92-96`).
- **Triggers: ningún archivo `sql/` declara triggers, y no pude verificar en
  vivo si existen. NO VERIFICADO.**
- **RLS: el comentario de `sql/01_esquema.sql:5` afirma que no hay RLS, y todo
  el acceso es server-side con la service role key (`lib/db.ts:4`). El estado
  real de RLS en la base NO FUE VERIFICADO.**

### 4.9 Funciones (RPC) — verificadas ejecutándolas

Las seis funciones existen y responden 200. Se llamaron por
`POST {SUPABASE_URL}/rest/v1/rpc/<nombre>`:

| Función | Firma expuesta | Resultado de la verificación |
|---|---|---|
| `pab_zona()` | sin parámetros | devuelve `"America/Argentina/Buenos_Aires"` |
| `reporte_resumen(p_area, p_origen, p_desde, p_hasta)` | int, text, timestamptz, timestamptz | `[{"total":430,"atendidos":329,"no_atendidos":101}]` |
| `reporte_por_area(p_area, p_origen, p_desde, p_hasta)` | ídem | devuelve las 8 áreas |
| `reporte_distribucion(p_area, p_origen, p_desde, p_hasta)` | ídem | 3 dimensiones: estado / tipo / origen |
| `reporte_por_dia(p_area, p_origen, p_desde, p_hasta)` | ídem | serie diaria con relleno de ceros |
| `reporte_clima_por_dia(p_area, p_desde, p_hasta)` | int, timestamptz, timestamptz — **sin `p_origen`** | promedios de temperatura y humedad |

Definiciones en `sql/03_reportes.sql:25-26` (`pab_zona`), `:31` (`resumen`),
`:61` (`por_area`), `:96` (`distribucion`), `:129` (`por_dia`), `:185`
(`clima_por_dia`). Consumidas desde `lib/reportes.ts:143-147`.

### 4.10 Conteos por tabla (verificados el 2026-09-09)

Consulta usada por tabla: `GET {SUPABASE_URL}/rest/v1/<tabla>?select=id` con
`Prefer: count=exact` y `Range: 0-0`, leyendo la cabecera `content-range`.

| Tabla | Filas |
|---|---|
| `areas` | 8 |
| `empleados` | 15 |
| `usuarios` | 3 |
| `lecturas` | 5 683 |
| `llamados` | 430 |
| `suscripciones_push` | 1 |
| `ajustes` | 1 (contado con `select=*`: la tabla no tiene columna `id`) |

Distribución de `llamados` según `reporte_distribucion()`: estado NO_ATENDIDO
101 / ATENDIDO 329; tipo NORMAL 297 / EMERGENCIA 133; origen SENSOR 280 /
EMPLEADO 150. Llamado más nuevo: `2026-09-09T19:19:02Z`.

### 4.11 Contenido real de `areas` (difiere de `sql/02_datos.sql`)

Consulta:
`GET /rest/v1/areas?select=id,codigo,nombre,tipo,temp_min,temp_max,hum_min,hum_max,activa&order=id`.

| id | codigo | nombre | tipo | temp_min | temp_max | hum_min | hum_max | activa |
|---|---|---|---|---|---|---|---|---|
| 1 | INV-N | Invernadero Norte | invernadero | **20** | **25** | 60 | 80 | true |
| 2 | INV-S | Invernadero Sur | invernadero | 16 | 26 | 50 | 70 | true |
| 3 | INV-G | Invernadero de Germinación | invernadero | 22 | 30 | 70 | 90 | true |
| 4 | HID-1 | Hidroponía | hidroponia | 18 | 24 | 55 | 75 | true |
| 5 | COM-1 | Playa de Compostaje | compostaje | **5.5** | 45 | 40 | 90 | true |
| 6 | VIV-1 | Vivero Forestal | vivero | 12 | 32 | 45 | 85 | true |
| 7 | RIE-1 | Sala de Bombas y Riego | servicios | 5 | 40 | 20 | 80 | true |
| 8 | DEP-1 | Depósito y Taller | servicios | 5 | 40 | 20 | 80 | true |

`sql/02_datos.sql:19-26` siembra INV-N con `18, 28, 60, 80` y COM-1 con
`10, 45, 40, 90`. La base real dice otra cosa: **los umbrales fueron editados
desde la pantalla de Áreas después de sembrar. `sql/02_datos.sql` NO es el
estado actual de la base.**

### 4.12 Contenido real de `usuarios`

| id | usuario | rol | empleado_id | area_id | activo |
|---|---|---|---|---|---|
| 1 | `admin` | ADMINISTRADOR | null | null | true |
| 2 | `lbarrios` | EMPLEADO | 1 | 1 (INV-N) | true |
| 3 | `hgauna` | EMPLEADO | 2 | 4 (HID-1) | true |

`admin` no tiene ficha de empleado ni área: `areasDelUsuario()` le devuelve un
arreglo vacío, que es una respuesta válida (`lib/areas-propias.ts:24-27`).

Las contraseñas de estas tres cuentas están **en texto plano en el repositorio**:
`scripts/hash.js:10-14` y `sql/02_datos.sql:7-10` (`admin/Parque2026!`,
`lbarrios/Invernadero1!`, `hgauna/Hidroponia1!`).

### 4.13 `ajustes` y `suscripciones_push` reales

- `ajustes`: una fila, `telegram_activo = "si"`, `actualizado_en
  2026-09-09T18:24:42Z`, `actualizado_por = null`. Los avisos a Telegram están
  **encendidos**.
- `suscripciones_push`: una fila, `usuario_id 1` (`admin`), dispositivo
  `"Chrome en Windows"`, `activa = true`, creada `2026-09-09T19:12:03Z`, usada
  por última vez `2026-09-09T19:19:05Z`. **El push está funcionando y salió al
  menos un aviso real.**

---

## 5. Inventario de dispositivos según `lecturas.dispositivo`

Consulta: se paginó
`GET /rest/v1/lecturas?select=dispositivo,tomada_en&order=id.asc` en bloques de
1000 filas (`Range`) y se agrupó del lado del cliente, porque PostgREST no hace
`GROUP BY`. Equivalente SQL:
`select dispositivo, count(*), min(tomada_en), max(tomada_en) from lecturas group by 1`.

| dispositivo | filas | primera lectura | última lectura | naturaleza |
|---|---|---|---|---|
| `ESP32-COM-1` | 673 | 2026-08-25T19:47:18Z | 2026-09-01T19:47:18Z | **sembrado** (`sql/02_datos.sql:202`) |
| `ESP32-DEP-1` | 673 | ídem | ídem | sembrado |
| `ESP32-HID-1` | 673 | ídem | ídem | sembrado |
| `ESP32-INV-G` | 673 | ídem | ídem | sembrado |
| `ESP32-INV-N` | 673 | ídem | ídem | sembrado |
| `ESP32-INV-S` | 673 | ídem | ídem | sembrado |
| `ESP32-RIE-1` | 673 | ídem | ídem | sembrado |
| `ESP32-VIV-1` | 673 | ídem | ídem | sembrado |
| `NODO-COM-1-01` | 1 | 2026-09-02T22:45:50Z | ídem | simulador (`app/(panel)/dispositivos/gestor.tsx:41`) |
| `NODO-DEP-1-01` | 2 | 2026-09-01T20:18:39Z | 2026-09-01T20:18:40Z | simulador |
| `NODO-INV-N-01` | **280** | 2026-09-01T20:17:29Z | **2026-09-09T18:57:05Z** | **nodo físico + simulador, indistinguibles** |
| `NODO-INV-S-01` | 7 | 2026-09-01T20:17:51Z | 2026-09-01T20:17:55Z | simulador |
| `NODO-VIV-1-01` | 9 | 2026-09-01T20:18:18Z | 2026-09-01T20:18:22Z | simulador |

Observaciones verificadas:

- Los 8 identificadores `ESP32-<codigo>` son **exclusivamente sembrados**: los
  genera `sql/02_datos.sql:202` (`'ESP32-' || a.codigo`) y todos tienen
  exactamente 673 filas y el mismo rango horario, que es la ventana de 7 días
  cada 15 minutos de `sql/02_datos.sql:198`. Ningún firmware del repositorio usa
  ese formato.
- Los identificadores `NODO-<codigo>-01` los produce **tanto** el simulador del
  panel (`app/(panel)/dispositivos/gestor.tsx:39-42`, que devuelve
  `NODO-${codigo}-01`) **como** el nodo físico, cuyo `DISPOSITIVO` es
  literalmente `"NODO-INV-N-01"`
  (`firmware/produccion_parque/produccion_parque.ino:60`).
- Por lo tanto **`NODO-INV-N-01` es una identidad ambigua**: sus 280 filas
  mezclan hardware real y simulación, y no hay ninguna columna que permita
  separarlos. Ver `03-riesgos.md`, riesgo R1.
- La última lectura del sistema entero es de `NODO-INV-N-01`
  (2026-09-09T18:57Z): es el único nodo con actividad reciente.

`llamados.creado_por` (misma barrida, `select=creado_por`) confirma la mezcla:
aparecen los 8 `ESP32-*` (269 llamados, sembrados), `NODO-INV-N-01` (7),
`NODO-VIV-1-01` (6), `NODO-INV-S-01` (1), ocho legajos `PAB-00xx` (139,
sembrados) y los usuarios `admin` (4) y `lbarrios` (4).

---

## 6. Modelo actual de autenticación

Todo verificado en `lib/sesion.ts`, `lib/auth.ts` y `proxy.ts`.

- **Cookie**: `pab_sesion` (`lib/sesion.ts:8`), `httpOnly: true`,
  `sameSite: "lax"`, `secure` solo en producción, `path: "/"`,
  `maxAge = DURACION_SEGUNDOS` (`lib/auth.ts:62-68`).
- **Token**: JWT firmado con `jose`, algoritmo **HS256** (`lib/sesion.ts:12`),
  clave desde `process.env.JWT_SECRET` (`lib/sesion.ts:15-19`; si falta, lanza).
- **Vigencia**: `DURACION_HORAS = 8` → `DURACION_SEGUNDOS = 28800`
  (`lib/sesion.ts:9-10`), `setExpirationTime("8h")` (`lib/sesion.ts:36`).
- **Payload**: `{ id, usuario, rol, area_id }` (`lib/sesion.ts:28-33`), más
  `iat` y `exp`.
- **Verificación**: `verificarSesion()` (`lib/sesion.ts:41-62`) rechaza el token
  si `id` no es `number`, si `usuario` no es `string`, si `rol` no es
  `ADMINISTRADOR`/`EMPLEADO`, o si `area_id` no es `number` ni `null`. Cualquier
  excepción devuelve `null`.
- **Login**: `lib/auth.ts:34-71`. Normaliza el usuario con
  `trim().toLowerCase()` (`:38`), lee `usuarios` por `usuario`, rechaza si
  `!data.activo` (`:48`), y compara con `bcrypt.compare` (`:50`).
- **Logout**: `lib/auth.ts:84-87`, borra la cookie; expuesto como Server Action
  en `app/(panel)/acciones.ts:8-11`.
- **Guardias**: `exigirSesion()` (`lib/auth.ts:93-97`) redirige a `/login`;
  `exigirAdmin()` (`lib/auth.ts:107-112`) redirige a `/login` sin sesión y llama
  `forbidden()` si el rol no es `ADMINISTRADOR` — 403 real, habilitado por
  `experimental.authInterrupts` (`next.config.ts:11`).
- **No se usa Supabase Auth ni RLS**: el acceso a la base es siempre con la
  service role key desde el servidor (`lib/db.ts:1-4`, `lib/db.ts:39-54`).

El JWT congela `area_id` al momento del login. Por eso las áreas a cargo se
releen de la base en cada pantalla, en `areasDelUsuario()`
(`lib/areas-propias.ts:28-70`); la razón está escrita en
`lib/areas-propias.ts:5-11`.

Punto importante y verificado: **las áreas ya no son un candado de permisos**.
`lib/areas-propias.ts:13-14` y `app/(panel)/llamados/acciones.ts:5-10` lo dicen
explícitamente, y el código lo confirma: `crearLlamado()` usa el área elegida
sin compararla con las propias (`app/(panel)/llamados/acciones.ts:149-154`), y
`atenderLlamado()`/`cancelarAtencion()` no consultan el área (`:35-77`,
`:84-128`). Las áreas propias solo ordenan (`propiasPrimero`,
`areasPropiasPrimero`, `lib/areas-propias.ts:80-115`).

---

## 7. Matriz ACTUAL de permisos: ADMINISTRADOR vs EMPLEADO

### 7.1 Por ruta

| Ruta | ADMINISTRADOR | EMPLEADO | Mecanismo |
|---|---|---|---|
| `/` | sí | sí | `getSesion()` (`app/(panel)/page.tsx:153`) |
| `/llamados` | sí | sí | `exigirSesion()` (`llamados/page.tsx:34`) |
| `/movil` | sí | sí | `exigirSesion()` (`movil/page.tsx:19`) |
| `/avisos` | sí | sí | `exigirSesion()` (`avisos/page.tsx:16`) |
| `/areas` | sí | **403** | `exigirAdmin()` (`areas/page.tsx:24`) |
| `/empleados` | sí | **403** | `exigirAdmin()` (`empleados/page.tsx:29`) |
| `/usuarios` | sí | **403** | `exigirAdmin()` (`usuarios/page.tsx:14`) |
| `/dispositivos` | sí | **403** | `exigirAdmin()` (`dispositivos/page.tsx:15`) |
| `/reportes` | sí | **403** | `exigirAdmin()` (`reportes/page.tsx:59`) |
| `/reportes/imprimir` | sí | **403** | `exigirAdmin()` (`reportes/imprimir/page.tsx:75`) |
| `/api/exportar/csv` | sí | **403** | `exigirAdmin()` (`csv/route.ts:70`) |
| `/api/vigilancia` | sí | sí | cualquier sesión, o `x-device-key` (`vigilancia/route.ts:12-16`) |
| `/api/ingest` | — | — | solo `x-device-key`; el rol no interviene (`ingest/route.ts:86`) |
| `/login` | redirige a `/` | redirige a `/` | `login/page.tsx:15-16` y `proxy.ts:27-32` |

### 7.2 Por Server Action

| Server Action | Archivo:línea de la guardia | Guardia | ADMIN | EMPLEADO |
|---|---|---|---|---|
| `cerrarSesion` | `app/(panel)/acciones.ts:8` | ninguna (solo `logout()`) | sí | sí |
| `accionLogin` | `app/login/acciones.ts:25` | ninguna (es el login) | — | — |
| `atenderLlamado` | `llamados/acciones.ts:36` | `exigirSesion()` | sí | sí |
| `cancelarAtencion` | `llamados/acciones.ts:87` | `exigirSesion()` | sí | sí |
| `crearLlamado` | `llamados/acciones.ts:133` | `exigirSesion()` | sí | sí |
| `guardarSuscripcion` | `avisos/acciones.ts:38` | `exigirSesion()` | sí | sí |
| `asegurarSuscripcion` | `avisos/acciones.ts:80` | `exigirSesion()` | sí | sí |
| `borrarSuscripcion` | `avisos/acciones.ts:133` | `exigirSesion()` | sí | sí |
| `cambiarSuscripcion` | `avisos/acciones.ts:160` | `exigirSesion()` | sí | sí |
| `probarPush` | `avisos/acciones.ts:185` | `exigirSesion()` | sí | sí |
| `cambiarTelegram` | `avisos/acciones.ts:211` | **`exigirAdmin()`** | sí | **403** |
| `crearArea` | `areas/acciones.ts:109` | **`exigirAdmin()`** | sí | **403** |
| `actualizarArea` | `areas/acciones.ts:132` | **`exigirAdmin()`** | sí | **403** |
| `cambiarActivaArea` | `areas/acciones.ts:159` | **`exigirAdmin()`** | sí | **403** |
| `crearEmpleado` | `empleados/acciones.ts:167` | **`exigirAdmin()`** | sí | **403** |
| `actualizarEmpleado` | `empleados/acciones.ts:196` | **`exigirAdmin()`** | sí | **403** |
| `cambiarEstadoEmpleado` | `empleados/acciones.ts:232` | **`exigirAdmin()`** | sí | **403** |
| `crearUsuario` | `usuarios/acciones.ts:109` | **`exigirAdmin()`** | sí | **403** |
| `cambiarRolUsuario` | `usuarios/acciones.ts:148` | **`exigirAdmin()`** | sí | **403** |
| `cambiarActivoUsuario` | `usuarios/acciones.ts:190` | **`exigirAdmin()`** | sí | **403** |
| `resetearPassword` | `usuarios/acciones.ts:216` | **`exigirAdmin()`** | sí | **403** |
| `eliminarUsuario` | `usuarios/acciones.ts:245` | **`exigirAdmin()`** | sí | **403** |
| `simularLectura` | `dispositivos/acciones.ts:45` | **`exigirAdmin()`** | sí | **403** |

Detalles de alcance dentro de las acciones abiertas a EMPLEADO:

- Las cinco acciones de suscripción de `avisos/acciones.ts` filtran además por
  `usuario_id = sesion.id` (`:141`, `:170`) o insertan con ese id (`:51`,
  `:115`), así que nadie toca la suscripción de otra persona. El envío de prueba
  va solo a los dispositivos propios (`enviarPushA(sesion.id, …)`, `:187`).
- Las tres acciones de `llamados/acciones.ts` **no restringen por área**: ver
  §6.

---

## 8. Variables de entorno

Solo los **nombres** presentes en `.env.local` (nueve), en el orden en que
aparecen. Ningún valor se transcribe.

| Variable | Está en `.env.local` | Dónde se consume |
|---|---|---|
| `SUPABASE_URL` | sí | `lib/db.ts:28` (vía `requerido()`, normalizando el sufijo `/rest/v1`, `lib/db.ts:27-32`) |
| `SUPABASE_SERVICE_KEY` | sí | `lib/db.ts:43` |
| `JWT_SECRET` | sí | `lib/sesion.ts:15` |
| `DEVICE_KEY` | sí | `app/api/vigilancia/route.ts:13`; `app/(panel)/dispositivos/acciones.ts:47`. **Desde el 2026-09-09 `/api/ingest` ya no la exige**: solo la consulta como fallback, y únicamente si `INGEST_PERMITE_CLAVE_GLOBAL` vale `"1"` |
| `TELEGRAM_TOKEN` | sí | `lib/telegram.ts:60` |
| `TELEGRAM_CHAT_ID` | sí | `lib/telegram.ts:61` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | sí | `lib/push.ts:54`; `app/(panel)/layout.tsx:76`; `app/(panel)/avisos/page.tsx:39` |
| `VAPID_PRIVATE_KEY` | sí | `lib/push.ts:55` |
| `VAPID_CONTACTO` | sí | `lib/push.ts:63` (con default `mailto:avisos@parque-ambiental.local`) |

Variables que el código lee pero **no están en `.env.local`**:

| Variable | Dónde se lee | Efecto de su ausencia |
|---|---|---|
| `APP_URL` | `lib/telegram.ts:29` | el enlace del mensaje de Telegram cae al siguiente candidato |
| `VERCEL_PROJECT_PRODUCTION_URL` | `lib/telegram.ts:32` | la inyecta Vercel; en local no existe |
| `VERCEL_URL` | `lib/telegram.ts:35` | ídem |
| `NEXT_PUBLIC_SITE_URL` | `app/layout.tsx:40` | `metadataBase` cae a `http://localhost:3000` — **en producción las URLs de Open Graph quedan apuntando a localhost** |
| `NODE_ENV` | `lib/auth.ts:65` | lo pone Next; decide el flag `secure` de la cookie |
| `INGEST_PERMITE_CLAVE_GLOBAL` | `app/api/ingest/route.ts` | **agregada el 2026-09-09.** Enciende el fallback a la clave global única en `/api/ingest`. Solo el valor literal `"1"` lo enciende; ausente, vacía o cualquier otro valor lo deja **apagado**, que es el default seguro. Ver `12-contrato-ingest-objetivo.md` §8.4 |

---

## 9. Estado de git

- Rama: `main`. Rama principal para PRs: `main`.
- HEAD: `7cba21e "hola"`.
- Historial completo: `7cba21e hola`, `2fca48d hol`, `b2a3192 agrego soporte
  PWA`, `c7cd47a ......`, `daa767c base del sistema`, `3e1d5b0 Initial commit
  from Create Next App`.
- **Hay 30 rutas con cambios en el índice, sin commitear**, entre ellas
  `firmware/produccion_parque/produccion_parque.ino` (M), `lib/push.ts` (M),
  `lib/areas-propias.ts` (A), `next.config.ts` (M), `public/sw.js` (M) y siete
  archivos de `app/(panel)/`. El estado auditado en este documento es el del
  **árbol de trabajo**, no el del último commit.

---

## 10. Otros archivos relevantes

- `public/manifest.json`: PWA `standalone`, `start_url` y `scope` `/`,
  `orientation: portrait`, íconos 192 y 512.
- `public/sw.js`: service worker que **no cachea nada** a propósito
  (`public/sw.js:1-11`); maneja `push` (`:16-46`) y `notificationclick`
  (`:50-73`). Espera del servidor `{ titulo, cuerpo, tipo, url }`, que es
  exactamente lo que arma `lib/push.ts:83-93`.
- `app/registrar-sw.tsx:16-18`: registra `/sw.js` con `updateViaCache: "none"`.
- **Suscripción automática al push**: `app/(panel)/avisos-automaticos.tsx`,
  montado desde `app/(panel)/layout.tsx:75-77`. Los avisos vienen prendidos: al
  entrar al panel se suscribe el dispositivo, con tres frenos verificables
  (`avisos-automaticos.tsx:48-64`) — no reactiva si la persona lo apagó en ese
  navegador (`estaApagadoAca()`, `componentes/push-cliente.ts:14-21`, marca
  `pab_avisos_apagados` en `localStorage`), no pregunta si el permiso está en
  `denied` (`:51`), y pide el permiso **una sola vez por navegador** usando la
  marca `pab_avisos_preguntado` (`:25-42`, `:54-58`). Llama
  `asegurarSuscripcion()` (`:63`), que a diferencia de `guardarSuscripcion()`
  **no toca `activa`** si la fila ya existía (`avisos/acciones.ts:70-112`).
- `app/(panel)/componentes/push-cliente.ts`: helpers compartidos entre el
  enganche automático y la pantalla de Avisos. Valida que la clave VAPID sea un
  punto P-256 sin comprimir —65 bytes que arrancan con `0x04`— antes de
  suscribir (`:63-71`), y arma un nombre legible del navegador para la lista de
  dispositivos (`:74-…`).
- `scripts/hash.js`: genera los hashes bcrypt de `sql/02_datos.sql` con 10
  rondas (`scripts/hash.js:8`). Contiene las tres contraseñas en claro
  (`:10-14`).
- `documents/`: ya contenía `TASTE_SKILL.md`, `arreglos.txt`,
  `caveman_skill.md`, `conocimiento.md`, `informe-final.html`. Este documento y
  sus tres compañeros son lo único creado en esta etapa.

---

## 11. Esquema resultante tras las migraciones 06, 07 y 08

**Estado: las tres migraciones están escritas y con la sintaxis validada, pero
NO fueron aplicadas.** Ver `20-migraciones-aplicadas.md` §6 para el detalle de
qué se validó y qué no. Esta sección describe el esquema que quedará una vez que
se apliquen; hasta entonces, el esquema vigente es el de §4.

Archivos: `sql/06_dispositivos.sql`, `sql/07_automatizacion_areas.sql`,
`sql/08_credenciales_dispositivos.sql`. Ninguno modifica ni elimina nada
preexistente: son aditivos e idempotentes.

### 11.1 Tabla nueva: `dispositivos`

| Columna | Tipo | Nulo | Default | Notas |
|---|---|---|---|---|
| `id` | `serial` | NOT NULL | — | Primary key. Identidad **interna**: es la que referencian las otras tablas |
| `codigo` | `text` | NOT NULL | — | Identidad **pública**: viaja en `/api/ingest` y está grabada en el firmware. Único vía `idx_dispositivos_codigo`. `check`: sin espacios al borde, largo 1 a 64 |
| `nombre` | `text` | NOT NULL | — | — |
| `modelo` | `text` | NULL | — | `'ESP32-S3-Zero'` para el nodo físico |
| `area_id` | `int` | **NULL** | — | FK → `areas.id`, **sin `on delete cascade`** |
| `activo` | `boolean` | NOT NULL | `true` | — |
| `naturaleza` | `text` | NOT NULL | `'FISICO'` | `check in ('FISICO','SIMULADO')`. Separa el hardware real del simulador |
| `reporta_temperatura` | `boolean` | NOT NULL | `true` | capacidad |
| `reporta_humedad` | `boolean` | NOT NULL | `true` | capacidad |
| `reporta_boton` | `boolean` | NOT NULL | `true` | capacidad |
| `acciona_rele` | `boolean` | NOT NULL | `true` | capacidad |
| `acciona_alarma` | `boolean` | NOT NULL | `true` | capacidad |
| `ultimo_contacto_en` | `timestamptz` | NULL | — | **materializada**, derivada de `lecturas`, recalculable |
| `observaciones` | `text` | NULL | — | — |
| `creado_en` | `timestamptz` | NOT NULL | `now()` | — |

Índices: `idx_dispositivos_codigo` (**único**), `idx_dispositivos_area`,
`idx_dispositivos_contacto` (`ultimo_contacto_en desc`).

**No hay tabla de historial de asignación**, por decisión: el pasado ya está
congelado en `lecturas.area_id` y `llamados.area_id`, y las cinco funciones
`reporte_*` agrupan por esas columnas. Ver `10-arquitectura.md` §2.

Contenido esperado tras el backfill: **13 filas**, una por identificador
distinto presente hoy en `lecturas.dispositivo`.

| `codigo` | `naturaleza` | `activo` | `area_id` |
|---|---|---|---|
| `NODO-INV-N-01` | **FISICO** | **true** | 1 (INV-N) |
| `ESP32-INV-N` … `ESP32-DEP-1` (8) | SIMULADO | false | 1 a 8 |
| `NODO-INV-S-01`, `NODO-VIV-1-01`, `NODO-DEP-1-01`, `NODO-COM-1-01` | SIMULADO | false | 2, 6, 8, 5 |

Los ocho `ESP32-*` los sembró `sql/02_datos.sql:202` y nunca fueron hardware.
Los cuatro `NODO-*-01` restantes los produjo el simulador del panel.

### 11.2 Tabla nueva: `dispositivo_credenciales`

| Columna | Tipo | Nulo | Default | Notas |
|---|---|---|---|---|
| `id` | `bigserial` | NOT NULL | — | Primary key |
| `dispositivo_id` | `int` | NOT NULL | — | FK → `dispositivos.id`, **`on delete cascade`** |
| `algoritmo` | `text` | NOT NULL | `'sha256-v1'` | `check in ('sha256-v1','bcrypt-v1')` |
| `secreto_hash` | `text` | NOT NULL | — | **el hash, nunca el secreto** |
| `prefijo` | `text` | NULL | — | primeros caracteres, para identificar sin revelar |
| `estado` | `text` | NOT NULL | `'ACTIVA'` | `check in ('ACTIVA','ROTADA','REVOCADA')` |
| `origen` | `text` | NOT NULL | `'GENERADA'` | `check in ('GENERADA','LEGADO')` |
| `expira_en` | `timestamptz` | NULL | — | ventana de gracia de las rotadas |
| `usada_en` | `timestamptz` | NULL | — | auditoría de uso |
| `creada_en` | `timestamptz` | NOT NULL | `now()` | — |
| `creada_por` | `text` | NULL | — | — |
| `revocada_en` | `timestamptz` | NULL | — | — |
| `revocada_por` | `text` | NULL | — | — |
| `motivo` | `text` | NULL | — | — |

Índices: `idx_credenciales_dispositivo`, `idx_credenciales_estado`, y
`idx_credenciales_hash_sha256` (**único parcial**,
`where algoritmo = 'sha256-v1'`).

**La migración no siembra ninguna fila.** La credencial del nodo físico necesita
un hash bcrypt calculado con la librería de la aplicación y va en la etapa
siguiente. Mientras la tabla esté vacía, `/api/ingest` sigue autenticando con
`DEVICE_KEY` exactamente como hasta ahora.

### 11.3 Columnas nuevas en tablas existentes

**`lecturas`** (existente, §4.4) suma una columna:

| Columna | Tipo | Nulo | Notas |
|---|---|---|---|
| `dispositivo_id` | `int` | **NULL** | FK → `dispositivos.id`. Nullable a propósito: contar los nulos es la señal que autoriza a apagar el fallback de la clave global |

Índice nuevo: `idx_lecturas_dispositivo_hora` (`dispositivo_id, tomada_en desc`),
mismo patrón que `idx_lecturas_area_hora`.

**`lecturas.dispositivo` (texto) no se toca**: ni se borra, ni se renombra, ni
cambia de tipo. La fila termina con las dos columnas, y significan cosas
distintas: el texto es lo que el nodo **dijo ser**, la FK es a quién lo
**atribuyó** el servidor.

**`areas`** (existente, §4.1) suma cuatro columnas:

| Columna | Tipo | Nulo | Default | Acciona cuando |
|---|---|---|---|---|
| `auto_temp_alta` | `boolean` | NOT NULL | `true` | `temperatura > temp_max` |
| `auto_temp_baja` | `boolean` | NOT NULL | `false` | `temperatura < temp_min` |
| `auto_hum_alta` | `boolean` | NOT NULL | `false` | `humedad > hum_max` |
| `auto_hum_baja` | `boolean` | NOT NULL | `true` | `humedad < hum_min` |

Las ocho áreas existentes quedan con `(true, false, false, true)`, que reproduce
exactamente la expresión de `rele` de `app/api/ingest/route.ts:200-203`.

**`temp_min`, `temp_max`, `hum_min` y `hum_max` no cambian**: mismo tipo, mismo
nombre, mismo significado. Siguen definiendo la normalidad y alimentando
`evaluarDesvios()` (`lib/alertas.ts:40-101`).

### 11.4 Lo que NO cambia

- **Ninguna función.** Las seis de `sql/03_reportes.sql` (`pab_zona`,
  `reporte_resumen`, `reporte_por_area`, `reporte_distribucion`,
  `reporte_por_dia`, `reporte_clima_por_dia`) quedan intactas.
- **Ninguna fila preexistente**, salvo los backfills declarados:
  `lecturas.dispositivo_id` (columna nueva) y las cuatro columnas nuevas de
  `areas`. Ninguna columna que existiera antes se modifica.
- **Ningún archivo de `app/` ni de `lib/`.** Tras aplicar las tres migraciones,
  el sistema se comporta igual que antes: no hay código que lea las estructuras
  nuevas. `lib/tipos.ts` no declara las columnas nuevas y todos los `select`
  están escritos con lista explícita de columnas, nunca con `select *`.
- **El contrato de `/api/ingest`.** Sigue siendo el de `01-contrato-ingest.md`,
  palabra por palabra, incluida la autenticación por `DEVICE_KEY`.
