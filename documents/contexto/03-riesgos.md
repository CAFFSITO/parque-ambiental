# 03 — Riesgos y contradicciones detectadas

Fecha: **2026-09-09**. Cada riesgo cita `archivo:línea` o la consulta que lo
verifica. Nada de lo que sigue es hipótesis: todo fue confirmado leyendo el
código o consultando la base real. Donde algo no se pudo confirmar, se dice.

Los cinco riesgos que el encargo pedía verificar explícitamente son **R1, R2,
R3, R4 y R5**. El resto apareció durante la auditoría.

---

## R1 — El simulador genera identidades idénticas a las del nodo físico

**Confirmado.**

`app/(panel)/dispositivos/gestor.tsx:39-42`:

```tsx
/** Nombre de nodo que se le propone al simulador para cada área. */
function nodoDe(codigo: string): string {
  return `NODO-${codigo}-01`;
}
```

`firmware/produccion_parque/produccion_parque.ino:60`:

```cpp
const char* DISPOSITIVO = "NODO-INV-N-01";
```

Para el área `INV-N`, `nodoDe("INV-N")` produce exactamente
`"NODO-INV-N-01"`, que es literalmente el identificador del hardware.

**El simulador golpea `/api/ingest` de verdad, por HTTP, con la misma
`DEVICE_KEY`** (`app/(panel)/dispositivos/acciones.ts:5-7` y `:69-83`), y
`/api/ingest` no valida `dispositivo` contra nada
(`app/api/ingest/route.ts:56-58`). No existe ninguna columna que distinga origen
simulado de origen real.

**Ya ocurrió en producción.** La consulta
`select dispositivo, count(*), max(tomada_en) from lecturas group by 1`
(ejecutada vía PostgREST paginado, ver `00-auditoria.md` §5) devuelve
`NODO-INV-N-01` con **280 filas** cuyo rango va del 2026-09-01T20:17Z al
2026-09-09T18:57Z: son datos reales y simulados mezclados sin posibilidad de
separarlos.

Consecuencias verificables:

- Los reportes, los promedios de `reporte_clima_por_dia()`
  (`sql/03_reportes.sql:185-208`) y el tablero mezclan mediciones inventadas con
  mediciones físicas.
- La vigilancia de nodos caídos (`lib/alertas.ts:216-252`) agrupa por
  `dispositivo`: **una simulación mantiene "vivo" al nodo físico aunque esté
  desconectado**, porque `estadoDeNodos()` toma la fila más reciente de ese
  identificador sin importar quién la escribió.
- Los llamados heredan la ambigüedad: `llamados.creado_por` tiene 7 filas con
  `NODO-INV-N-01`, y no se sabe cuáles vinieron del hardware.

Severidad: **alta**. Contamina el dato que es la razón de ser del sistema, y no
es reversible sobre lo ya escrito.

---

## R2 — Una sola `DEVICE_KEY` global, que además abre `/api/vigilancia`

**Confirmado.**

`app/api/ingest/route.ts:78-88`:

```ts
  const claveEsperada = process.env.DEVICE_KEY;
  ...
  if (request.headers.get("x-device-key") !== claveEsperada) {
```

`app/api/vigilancia/route.ts:12-16`:

```ts
async function autorizado(request: NextRequest): Promise<boolean> {
  const clave = process.env.DEVICE_KEY;
  if (clave && request.headers.get("x-device-key") === clave) return true;
  return (await getSesion()) !== null;
}
```

Ambas rutas son públicas para el proxy (`proxy.ts:12`).

Hechos que se derivan:

1. **La misma clave abre las dos rutas.** Quien tenga la clave del nodo puede
   además forzar la barrida de vigilancia (`revisarNodosCaidos(true)`,
   `app/api/vigilancia/route.ts:27`), que **crea llamados de EMERGENCIA** en la
   base (`lib/alertas.ts:305-322`). Es escritura, no lectura.
2. **La clave está en claro en el repositorio**, en
   `firmware/produccion_parque/produccion_parque.ino:57` — y ese archivo está
   commiteado en git. Rotarla exige reflashear el nodo físico (ver
   `02-contrato-firmware.md` §6.1, punto 2).
3. **No hay identidad por nodo.** Un segundo nodo implicaría compartir la misma
   clave, y comprometer uno compromete a todos.
4. Con esa clave, cualquiera puede escribir lecturas arbitrarias en cualquier
   área (`/api/ingest` no valida `dispositivo`) y, con umbrales fuera de rango,
   **disparar la sirena física** del nodo real vía `hayEmergenciaAbierta()`
   (`lib/alertas.ts:194-203`).
5. `/api/vigilancia` también acepta **cualquier sesión válida**, incluida la de
   un EMPLEADO (`:15`): no exige rol de administrador aunque su efecto sea crear
   llamados.

El `WIFI_PASS` también está en claro en el firmware
(`firmware/produccion_parque/produccion_parque.ino:51`), igual que las tres
contraseñas de las cuentas en `scripts/hash.js:10-14` y `sql/02_datos.sql:7-10`.

Severidad: **alta**.

---

## R3 — `sql/01_esquema.sql` y `sql/02_datos.sql` son destructivos

**Confirmado.**

`sql/01_esquema.sql:8-12`, las cinco primeras sentencias del archivo:

```sql
drop table if exists llamados cascade;
drop table if exists lecturas cascade;
drop table if exists usuarios cascade;
drop table if exists empleados cascade;
drop table if exists areas cascade;
```

`sql/02_datos.sql:13`:

```sql
truncate table llamados, lecturas, usuarios, empleados, areas restart identity cascade;
```

Ninguno de los dos es idempotente en el sentido inofensivo: **correr cualquiera
de los dos hoy borraría 5 683 lecturas, 430 llamados, 15 empleados, 3 usuarios y
8 áreas** (conteos verificados el 2026-09-09, ver `00-auditoria.md` §4.10),
incluidas las 280 lecturas reales del nodo físico.

El `cascade` del `drop` alcanza también a `suscripciones_push`, que tiene FK a
`usuarios` con `on delete cascade` (`sql/05_avisos.sql:82`), aunque
`sql/01_esquema.sql` ni la menciona: se escribió antes que ella.

Agravante verificado: **`sql/02_datos.sql` ya no describe el estado real de la
base.** `sql/02_datos.sql:19-26` siembra INV-N con `18, 28, 60, 80`; la base
tiene hoy `20, 25, 60, 80`. COM-1 está sembrada con `temp_min = 10` y en la base
vale `5.5`. Los umbrales fueron editados desde la pantalla de Áreas después de
sembrar. Reejecutar el archivo no "restauraría" nada: **revertiría** decisiones
operativas reales.

Los archivos se presentan como pasos de instalación
(`sql/01_esquema.sql:4` "Pegar PRIMERO", `sql/02_datos.sql:4` "Pegar SEGUNDO"),
sin ninguna advertencia de destrucción en la cabecera.

Severidad: **crítica** por impacto, **baja** por probabilidad si nadie los
ejecuta. La instrucción operativa vigente es no correrlos nunca.

---

## R4 — No existe framework de tests

**Confirmado.**

`package.json:5-10` declara cuatro scripts: `dev`, `build`, `start`, `lint`.
**No hay `test`.** Un `grep -i "test\|vitest\|jest\|playwright"` sobre
`package.json` no devuelve ninguna coincidencia: no hay dependencia de testing
en `dependencies` ni en `devDependencies`. Tampoco hay archivos `*.test.ts`,
`*.spec.ts`, ni carpetas `__tests__` en todo el árbol (verificado con el listado
completo de archivos del repositorio, excluyendo `node_modules`, `.git` y
`.next`).

Lo que queda sin cobertura automática, en orden de riesgo:

| Lógica | Archivo | Por qué duele |
|---|---|---|
| `evaluarDesvios()` | `lib/alertas.ts:40-101` | decide NORMAL vs EMERGENCIA; ocho ramas y dos márgenes |
| `registrarLlamado()` (antirrebote y escalada) | `lib/alertas.ts:128-191` | un error crea decenas de llamados o silencia una emergencia |
| Expresión del relé | `app/api/ingest/route.ts:200-203` | acciona hardware físico |
| `verificarSesion()` | `lib/sesion.ts:41-62` | es toda la autorización del sistema |
| `leerCuerpo()` / `aNumero()` | `app/api/ingest/route.ts:39-75` | única barrera de entrada del endpoint público |
| `leerFiltro()` / `aInstante()` | `lib/reportes.ts:38-86` | maneja zonas horarias a mano |
| `celda()` del CSV | `app/api/exportar/csv/route.ts:40-50` | escapa contra inyección de fórmulas en Excel |

La única verificación automática hoy es `next build` (TypeScript + ESLint), que
comprueba tipos, no comportamiento.

Severidad: **media-alta**, y creciente: cada cambio de umbral o de contrato se
valida a ojo.

---

## R5 — El nodo reporta cada 10 s contra un umbral de 90 s

**Confirmado.**

`lib/alertas.ts:17-18`:

```ts
/** Un nodo que no reporta en este tiempo se considera caído. */
export const SEGUNDOS_SIN_SENAL = 90;
```

`firmware/produccion_parque/produccion_parque.ino:93`:

```cpp
const unsigned long INTERVALO_MS = 10000;
```

El margen es de **9 envíos**: hacen falta nueve reportes perdidos seguidos para
que el servidor declare el nodo caído y cree un llamado de EMERGENCIA
(`lib/alertas.ts:289-291`, `:308-318`, motivo `MOTIVOS.SIN_SENAL`,
`lib/catalogos.ts:142`).

Lo que esto implica, en las dos direcciones:

- **Sobre-reporte.** 8 640 lecturas por nodo por día. Con las 5 683 filas que
  hay hoy en total, un solo nodo funcionando de forma continua multiplicaría la
  tabla por más de uno y medio **cada día**. No hay política de retención, ni
  partición, ni agregación: `lecturas` crece sin techo, y
  `reporte_clima_por_dia()` (`sql/03_reportes.sql:185-208`) hace `avg()` sobre
  la tabla entera del rango.
- **Detección lenta para lo que promete.** El tablero considera "vieja" una
  lectura a los 30 minutos (`app/(panel)/page.tsx:17`,
  `MINUTOS_LECTURA_VIGENTE = 30`), mientras la vigilancia usa 90 segundos: **dos
  umbrales distintos para la misma pregunta**, en dos pantallas del mismo
  sistema.
- **El margen es más chico de lo que parece.** `HTTP_TIMEOUT_MS = 6000`
  (`firmware/…:102`): un endpoint que tarde 6 s por request consume la mayor
  parte del intervalo. Y el failsafe del relé (`SERVIDOR_FAILSAFE_MS = 45000`,
  `firmware/…:105`) dispara a la mitad del umbral de 90 s: **el relé se apaga 45
  segundos antes de que el servidor se entere de que el nodo tiene problemas.**

Riesgo asociado, verificado: **bajar `SEGUNDOS_SIN_SENAL` por debajo de ~20 s
generaría emergencias falsas** con un solo envío lento.

Severidad: **media**. No rompe hoy, pero fija el costo de la base y desalinea
tres constantes de tiempo que deberían derivar una de otra.

---

## R6 — El motivo es texto libre en la base, y la base ya tiene 20 motivos fuera del catálogo

**Confirmado.**

`lib/catalogos.ts:133-136` declara la premisa del diseño:

> "Catálogo cerrado de motivos de llamado. El antirrebote agrupa por (área +
> motivo), así que estos textos son la clave de deduplicación: no los cambies
> sin migrar los llamados abiertos."

Pero `llamados.motivo` es `text` **sin `check` ni FK** (`sql/01_esquema.sql:87`,
confirmado en vivo: la columna es `text` nullable, `00-auditoria.md` §4.5). El
catálogo solo se aplica en TypeScript, y solo en el alta manual
(`app/(panel)/llamados/acciones.ts:145-147`).

Consulta de verificación: se leyeron los 430 llamados
(`GET /rest/v1/llamados?select=tipo,origen,estado,motivo`) y se agruparon. Los
`MOTIVOS` de `lib/catalogos.ts:137-149` son **11**; en la base conviven esos 11
con **20 textos distintos que no pertenecen al catálogo**, todos sembrados por
`sql/02_datos.sql:110-142`, entre ellos:

`Temperatura fuera de rango`, `Humedad fuera de rango`,
`Lectura intermitente del sensor`, `Humedad de sustrato por debajo del mínimo`,
`Oscilación térmica sostenida`, `Temperatura crítica sostenida`,
`Humedad crítica sostenida`, `Sensor sin señal por más de una hora`,
`Caída brusca de temperatura`, `Sobrecalentamiento del sector`,
`Falta de insumos`, `Pedido de recambio de sustrato`, `Revisión de goteros`,
`Limpieza de bandejas pendiente`, `Poda y raleo pendiente`,
`Rotura de caño de riego`, `Corte de energía en el sector`, `Plaga detectada`,
`Bomba fuera de servicio`, `Anegamiento del sector`.

Contradicción concreta: existe `Sensor sin señal por más de una hora` (12
llamados) al lado de `Sensor sin señal` (10 llamados, el del catálogo,
`lib/catalogos.ts:142`). **Para el antirrebote son motivos distintos**
(`lib/alertas.ts:141`, `.eq("motivo", entrada.motivo)`), así que se duplican
entre sí en la misma área.

Además, `MOTIVOS_MANUALES` (`lib/catalogos.ts:158-165`) ofrece **6 opciones** en
los selectores de `/llamados` y `/movil`
(`app/(panel)/llamados/gestor.tsx:476`, `app/(panel)/movil/gestor.tsx:205`),
mientras que `crearLlamado()` valida contra `LISTA_MOTIVOS`, que son **11**:
cinco motivos son aceptables por la acción pero no ofrecibles por la interfaz.

Severidad: **media**. Ensucia filtros, reportes y la deduplicación.

---

## R7 — La lectura se pierde cuando el área no existe, contra lo que dice el comentario

**Confirmado.**

`app/api/ingest/route.ts:126` afirma:

```ts
  // 1. La lectura se guarda siempre, aunque el área esté dada de baja.
```

Pero el `insert` de `lecturas` está en `:128-134`, **después** del bloque
`:119-124` que corta con **404** si `areas.codigo` no coincide. El comentario es
cierto para "área inactiva" y falso para "área inexistente".

Impacto real y ya vivido: si alguien renombra el código `INV-N`, el nodo físico
—que manda `area` fijo, `firmware/…:64`— empieza a recibir 404 y **su telemetría
se descarta en silencio**, porque el firmware solo lo imprime en el puerto serie
(`firmware/…:642-649`). El sistema no registraría ni la lectura ni la ausencia
de lectura hasta que pasen los 90 segundos y se dispare "Sensor sin señal".

Severidad: **media**. La numeración de los comentarios (`// 1.`, `// 2.`)
tampoco sigue el orden de ejecución, lo que hace fácil leer mal el archivo.

---

## R8 — La alarma es del área, no del nodo, y hoy está encendida en las ocho áreas

**Confirmado.**

`app/api/ingest/route.ts:205` → `hayEmergenciaAbierta(area.id)`
(`lib/alertas.ts:194-203`), que cuenta **cualquier** llamado
`tipo = EMERGENCIA` y `estado = NO_ATENDIDO` del área, sin importar el origen.

Consulta de verificación, por área
(`GET /rest/v1/llamados?select=id&area_id=eq.<n>&tipo=eq.EMERGENCIA&estado=eq.NO_ATENDIDO`,
`Prefer: count=exact`, 2026-09-09):

| área | emergencias abiertas |
|---|---|
| 1 INV-N | **8** |
| 2 INV-S | 4 |
| 3 INV-G | 4 |
| 4 HID-1 | 5 |
| 5 COM-1 | 2 |
| 6 VIV-1 | 9 |
| 7 RIE-1 | 3 |
| 8 DEP-1 | 2 |

Es decir: **hoy `/api/ingest` responde `alarma: true` a todo nodo en toda
área**, y el buzzer de `NODO-INV-N-01` suena en pulsos de 200 ms cada 2 segundos
de forma permanente (`firmware/…:419-449`), **por llamados que en su mayoría son
datos sembrados por `sql/02_datos.sql`, no incidentes reales**.

Segundo efecto: como el buzzer y el LED comparten GPIO 7
(`firmware/…:15-17`, `:76-78`), no se puede silenciar sin apagar también la
señalización visual.

Tercer efecto, más sutil: el failsafe apaga el relé pero **deliberadamente no
apaga la alarma** (`firmware/…:322-323`, `:336-347`). Si el servidor cae con
`alarma: true` en la última respuesta, el buzzer suena indefinidamente sin
posibilidad de que nadie lo baje desde el panel.

Severidad: **alta en lo operativo**. Una alarma que suena siempre deja de ser
una alarma.

---

## R9 — Los filtros de fecha de `/llamados` no llevan zona horaria

**Confirmado.**

`app/(panel)/llamados/page.tsx:62-67`:

```ts
  if (filtros.desde !== "") {
    consulta = consulta.gte("creado_en", `${filtros.desde}T00:00:00`);
  }
  if (filtros.hasta !== "") {
    consulta = consulta.lte("creado_en", `${filtros.hasta}T23:59:59`);
  }
```

El string va sin offset. `creado_en` es `timestamptz`, así que Postgres lo
interpreta en su propia zona (UTC en Supabase), mientras que **todo lo que se
muestra en pantalla está formateado en `America/Argentina/Buenos_Aires`**
(`lib/formato.ts:6-16`).

El mismo problema está resuelto correctamente en la otra pantalla:
`lib/reportes.ts:66-70` agrega `-03:00` explícito, con el comentario que lo
justifica en `:62-65`. Y las funciones SQL usan `pab_zona()`
(`sql/03_reportes.sql:23-26`, `:145`, `:156`, `:161`, `:199`).

O sea: **el sistema tiene tres tratamientos de zona horaria y uno está mal.**
Filtrar "desde el 9/9" en `/llamados` deja afuera los llamados de las 21:00 a
las 23:59 hora local del 8/9 y de más, corrido 3 horas.

Severidad: **media**. Silencioso: no falla, muestra de menos.

---

## R10 — La vigilancia solo ve una ventana de 24 horas, así que un nodo caído hace más de un día desaparece

**Confirmado.**

`lib/alertas.ts:216-218`:

```ts
export async function estadoDeNodos(): Promise<NodoVigilado[]> {
  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
```

Y `revisarNodosCaidos()` (`:288-291`) filtra sobre esa lista. Un dispositivo
cuya última lectura tenga más de 24 horas **no aparece en la lista y por lo
tanto no genera ningún llamado de "Sensor sin señal"**. El nodo pasa de "caído,
en emergencia" a "inexistente".

Verificado en la base: los 8 identificadores `ESP32-<codigo>` tienen su última
lectura el **2026-09-01**, ocho días atrás. Hoy son invisibles para la
vigilancia. También lo son `NODO-COM-1-01`, `NODO-DEP-1-01`, `NODO-INV-S-01` y
`NODO-VIV-1-01`.

Efecto combinado con R1: si el nodo físico se apaga y nadie lo simula, se crea
un llamado de emergencia; si se apaga y alguien simula desde el panel, **el
llamado nunca se crea**, porque la simulación refresca `max(tomada_en)` de su
mismo identificador.

Además, `estadoDeNodos()` trae **todas** las lecturas de las últimas 24 h para
agrupar en JavaScript (`lib/alertas.ts:219-247`) porque "PostgREST no agrupa"
(`:213-215`). Con un nodo reportando cada 10 s son 8 640 filas por nodo por día
transferidas en cada barrida.

Y el rate limit de la barrida es una variable de módulo
(`lib/alertas.ts:257-258`, `ultimaRevision` / `MS_ENTRE_REVISIONES = 20_000`):
el propio comentario de `:254-256` reconoce que en serverless es best-effort.

Severidad: **media-alta**. Es un punto ciego en la función que justifica el
sistema.

---

## R11 — El área ya no restringe nada, pero el código y los comentarios todavía hablan de "candado"

**Confirmado, y es una contradicción de documentación más que de código.**

El comportamiento actual es deliberado y está bien explicado en
`lib/areas-propias.ts:13-14` y `app/(panel)/llamados/acciones.ts:5-10`:
cualquiera con sesión crea y atiende llamados de cualquier área.

Pero quedaron dos comentarios que afirman lo contrario:

- `app/(panel)/llamados/acciones.ts:82`: *"Rige el mismo candado de área que
  para atenderlo"* — no existe tal candado; `atenderLlamado()` (`:35-77`) no
  consulta el área en ningún momento.
- `app/(panel)/llamados/acciones.ts:149`: *"El área es la que se eligió, sea
  cual sea el rol"*, seguido de `const areaId = areaPedida;` (`:150`) — una
  asignación que no hace nada, residuo de la lógica que se sacó.

También quedó código muerto: `atenderLlamado()` y `cancelarAtencion()` piden
`area_id` en su `select` (`:44`, `:95`) y nunca lo usan.

Severidad: **baja** técnicamente, **media** para quien lea el código después:
los comentarios describen un sistema de permisos que ya no existe.

---

## R12 — El simulador se llama a sí mismo por HTTP, adivinando su propia URL

**Confirmado.**

`app/(panel)/dispositivos/acciones.ts:30-40` arma la base desde la cabecera
`host` de la request entrante y `x-forwarded-proto`, y `:69` hace `fetch` contra
`${base}/api/ingest`.

Es una decisión explicada (`:5-7`: "Así lo que se demuestra es el camino real y
no un atajo"), pero tiene tres consecuencias reales:

1. Depende de cabeceras que puede fijar el cliente. Un `Host` manipulado
   redirigiría la request a otro destino, con la `DEVICE_KEY` real adjunta
   (`:73`). La acción exige `exigirAdmin()` (`:45`), lo que acota el vector a
   una cuenta de administrador.
2. Un salto de red extra por cada simulación, con el riesgo de fallar en
   entornos donde la función no puede resolverse a sí misma.
3. La lectura simulada entra por el mismo camino que el nodo real y queda
   indistinguible (ver R1).

Severidad: **baja-media**.

---

## R13 — `NEXT_PUBLIC_SITE_URL` se lee pero no está definida

**Confirmado.**

`app/layout.tsx:38-41`:

```ts
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
```

`NEXT_PUBLIC_SITE_URL` **no está en `.env.local`** (los nueve nombres presentes
están listados en `00-auditoria.md` §8). En producción, `metadataBase` cae a
`http://localhost:3000`, así que las URLs absolutas de Open Graph y Twitter
(`app/layout.tsx:62-74`, que apuntan a `/og.png`) se resuelven contra localhost.

Situación análoga con `APP_URL` (`lib/telegram.ts:29`): tampoco está definida,
pero ahí hay cadena de fallbacks a las variables que inyecta Vercel
(`lib/telegram.ts:32-38`), así que el enlace del mensaje de Telegram sí
funciona en producción.

Severidad: **baja**. Cosmético, pero visible cuando alguien comparte el enlace.

---

## R14 — Los errores de Supabase se filtran al cliente

**Confirmado.**

`app/api/ingest/route.ts:115`:

```ts
      { ok: false, error: `No se pudo leer el área: ${errorArea.message}` },
```

e `:141` para la lectura. Lo mismo en las Server Actions: `llamados/acciones.ts`
`:72`, `:123`, `:167`; `avisos/acciones.ts` `:63`, `:125`, `:144`, `:173`.

El `message` de PostgREST puede incluir nombres de tabla, de columna y de
constraint. En `/api/ingest` el destinatario es cualquiera que tenga la
`DEVICE_KEY`; en las Server Actions, cualquier usuario con sesión.

Severidad: **baja**. Es divulgación de estructura, no de datos.

---

## R15 — Higiene del repositorio

**Confirmado, y no es cosmético.**

1. **Secretos commiteados**: `DEVICE_KEY` y `WIFI_PASS` en el firmware
   (`firmware/produccion_parque/produccion_parque.ino:51,57`), y las tres
   contraseñas de las cuentas en claro en `scripts/hash.js:10-14` y
   `sql/02_datos.sql:7-10`. Rotar cualquiera de ellas no borra el historial de
   git.
2. **30 rutas modificadas y sin commitear** al momento de la auditoría, entre
   ellas el firmware, `lib/push.ts`, `next.config.ts` y siete archivos de
   `app/(panel)/`. No hay un punto del historial que corresponda al sistema que
   funciona hoy.
3. **Historial ilegible**: los mensajes de commit son `hola`, `hol`, `......`.
   No se puede reconstruir qué cambió ni por qué.
4. **Archivos generados versionados**: `arbol_estructura.txt` pesa **2,7 MB**,
   `tsconfig.tsbuildinfo` **163 KB**, y hay un `esss.txt` de 56 bytes y un
   `app/Gemini_Generated_Image_tbcicgtbcicgtbci.jpg` sueltos dentro de `app/`.
   Los dos primeros no deberían estar bajo control de versiones.
5. **Fuentes duplicadas**: `app/fuentes/` incluye el `.zip` original
   (`alera-labs-scientific-humanistic.zip`) **además** de su contenido ya
   descomprimido (39 archivos: 18 caras en `.otf` y en `.ttf`, dos fuentes
   variables y la licencia), más otra familia completa (`gcfentura-*`, 17
   archivos) y
   `app/(panel)/nature-font-4/`, ninguna de las cuales se referencia desde
   `app/layout.tsx:13-36`, que solo carga las 18 caras `.ttf` de Alera.
6. **Un archivo con espacio en el nombre**: `app/isologo rootbox.png`, agregado
   en el índice.

Severidad: **media** por el punto 1, **baja** por el resto.

---

## Resumen ordenado por severidad

| # | Riesgo | Severidad |
|---|---|---|
| R3 | `sql/01` y `sql/02` destruyen la base entera | crítica (si se ejecutan) |
| R1 | Simulador y nodo físico comparten identidad | alta |
| R2 | `DEVICE_KEY` única, en el repositorio, que además abre `/api/vigilancia` | alta |
| R8 | Alarma por área: hoy suena en las 8 áreas por datos sembrados | alta |
| R4 | Sin ningún test automatizado | media-alta |
| R10 | Vigilancia ciega más allá de 24 h | media-alta |
| R5 | 10 s de reporte contra 90 s de umbral, sin retención de datos | media |
| R6 | `motivo` es texto libre; la base tiene 20 valores fuera del catálogo | media |
| R7 | La lectura se descarta con 404, contra lo que dice el comentario | media |
| R9 | Filtros de fecha de `/llamados` sin zona horaria | media |
| R15 | Secretos commiteados e higiene del repositorio | media / baja |
| R12 | El simulador se auto-invoca por HTTP adivinando su URL | baja-media |
| R11 | Comentarios que describen un candado de área que ya no existe | baja |
| R13 | `NEXT_PUBLIC_SITE_URL` sin definir | baja |
| R14 | Mensajes de Supabase filtrados al cliente | baja |

---

## Lo que NO se pudo verificar

Se deja constancia para que ninguna etapa siguiente lo dé por sabido:

- **Existencia real de los índices, defaults, `check` y `unique`** declarados en
  `sql/`. PostgREST no expone `pg_catalog` ni `information_schema`, y probarlos
  con una inserción inválida habría sido DML. Ver `00-auditoria.md` §4.8.
- **Existencia de triggers.** Ningún archivo `sql/` declara ninguno, pero eso no
  prueba que la base no los tenga.
- **Estado de RLS por tabla.** El comentario de `sql/01_esquema.sql:5` dice que
  no hay, y la app usa service role key, que en cualquier caso lo saltearía.
- **Si el nodo físico está encendido ahora mismo.** Su última lectura es del
  2026-09-09T18:57Z; no se pudo distinguir si es hardware o simulación (R1).
- **Comportamiento del sistema en producción bajo carga.** No se ejecutó ninguna
  prueba contra el despliegue de Vercel.
