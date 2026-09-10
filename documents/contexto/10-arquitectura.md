# 10 — Arquitectura objetivo

Fecha: **2026-09-09**. Documento de diseño. No hay código en esta etapa.

Base: `00-auditoria.md`, `01-contrato-ingest.md`, `02-contrato-firmware.md` y
`03-riesgos.md`, los cuatro leídos antes de escribir esto. Toda decisión se
justifica contra el esquema **real** verificado en Supabase, no contra los
archivos `sql/`.

---

## 0. Estado previo: qué quedó NO VERIFICADO y cómo afecta este diseño

`00-auditoria.md` §4.8 marca como no verificados: **índices, defaults, `check`,
`unique`, triggers y RLS**. `03-riesgos.md` cierra con la misma lista.

Reviso uno por uno si bloquean el diseño. **Ninguno lo bloquea**, pero dos
fuerzan supuestos que hay que confirmar antes de ejecutar migraciones. No me
detengo; lo dejo explícito.

| No verificado | ¿Afecta el diseño? | Supuesto que fuerza |
|---|---|---|
| `unique` en `areas.codigo` | **Sí, marginalmente** | La FK `dispositivos.area_id → areas.id` apunta a la **PK** (`id`), que sí está verificada como Primary Key en el documento OpenAPI, no a `codigo`. Ninguna decisión de este documento depende de que `codigo` sea único. **Verificación adicional hecha hoy:** los 8 `areas.codigo` son distintos entre sí (consulta `GET /rest/v1/areas?select=codigo`), así que aunque el `unique` no existiera, no hay duplicados que rompan el `.maybeSingle()` actual (`app/api/ingest/route.ts:110`). |
| Índices declarados en `sql/` | **No** | El argumento de costo de la decisión 1 **no depende** de que `idx_lecturas_area_hora` exista: `estadoDeNodos()` filtra por `tomada_en` sin `area_id` (`lib/alertas.ts:221-222`), así que ese índice no la ayuda ni existiendo. El diseño propone índices nuevos con `create index if not exists`, que es correcto exista o no el anterior. |
| Triggers | **Sí** | La inmutabilidad de `dispositivos.naturaleza` (decisión 9) se especifica **a nivel de aplicación**, no con trigger, precisamente porque no puedo afirmar que la base tenga o no infraestructura de triggers. Se anota el trigger como refuerzo a evaluar, no como parte del diseño. |
| RLS por tabla | **No** | Todo el acceso es server-side con service role key (`lib/db.ts:1-4`), que saltea RLS en cualquier caso. Las tablas nuevas heredan el mismo modelo. |
| Defaults de columnas existentes | **No** | Las columnas nuevas traen sus propios `default`, y el backfill de la decisión 7 se apoya en el default de la columna **nueva**, no en ninguno preexistente. |

**Verificaciones adicionales que corrí hoy** (todas de solo lectura, vía
PostgREST) porque el diseño se apoya en ellas:

| Consulta | Resultado | Para qué la necesito |
|---|---|---|
| `lecturas?select=id&dispositivo=is.null` | **0 filas** | El backfill de `lecturas.dispositivo_id` puede emparejar por texto sin casos nulos (decisión 4). |
| `lecturas?select=id&area_id=is.null` | **0 filas** | Nada histórico queda huérfano de área. |
| `llamados?select=id&area_id=is.null` | **0 filas** | Ídem para llamados. |
| `lecturas?dispositivo=like.ESP32-*` | 5 384 filas | 8 nodos sembrados × 673. |
| `lecturas?dispositivo=like.NODO-*` | 299 filas | 5 identificadores del simulador y del nodo real. 5 384 + 299 = 5 683 = total. |
| `areas?select=codigo` | 8 códigos, **sin duplicados** | Ver arriba. |
| `lecturas` agrupado por `(dispositivo, area_id)` | **cada dispositivo escribió siempre en una sola área** | Decisivo: el backfill de `dispositivos.area_id` es **inequívoco**. Ningún identificador cambió de área nunca. Ver decisión 2. |

Ese último resultado es el que más peso tiene en este diseño y conviene dejarlo
a la vista:

```
ESP32-COM-1 -> 5      NODO-COM-1-01 -> 5
ESP32-DEP-1 -> 8      NODO-DEP-1-01 -> 8
ESP32-HID-1 -> 4      NODO-INV-N-01 -> 1
ESP32-INV-G -> 3      NODO-INV-S-01 -> 2
ESP32-INV-N -> 1      NODO-VIV-1-01 -> 6
ESP32-INV-S -> 2
ESP32-RIE-1 -> 7
ESP32-VIV-1 -> 6
```

Ningún dispositivo aparece con más de un `area_id`.

---

## 1. Tabla `dispositivos` — **NUEVA**

### 1.1 Definición propuesta

| Columna | Tipo | Nulo | Default | Clase | Referencia |
|---|---|---|---|---|---|
| `id` | `serial` | NOT NULL | — | **nueva**, PK | — |
| `codigo` | `text` | NOT NULL | — | **nueva**, `unique` | — |
| `nombre` | `text` | NOT NULL | — | **nueva** | — |
| `modelo` | `text` | NULL | — | **nueva** | — |
| `area_id` | `int` | **NULL** | — | **nueva**, FK | → `areas.id` (**existente**, PK verificada) |
| `activo` | `boolean` | NOT NULL | `true` | **nueva** | — |
| `naturaleza` | `text` | NOT NULL | `'FISICO'` | **nueva**, `check in ('FISICO','SIMULADO')` | — |
| `reporta_temperatura` | `boolean` | NOT NULL | `true` | **nueva** | — |
| `reporta_humedad` | `boolean` | NOT NULL | `true` | **nueva** | — |
| `reporta_boton` | `boolean` | NOT NULL | `true` | **nueva** | — |
| `acciona_rele` | `boolean` | NOT NULL | `true` | **nueva** | — |
| `acciona_alarma` | `boolean` | NOT NULL | `true` | **nueva** | — |
| `ultimo_contacto_en` | `timestamptz` | NULL | — | **nueva**, materializada | derivable de `lecturas` |
| `observaciones` | `text` | NULL | — | **nueva** | — |
| `creado_en` | `timestamptz` | NOT NULL | `now()` | **nueva** | — |

Índices nuevos: `unique (codigo)`, `(area_id)`, `(ultimo_contacto_en desc)`.

Constraint sobre `codigo`: `check (codigo = btrim(codigo) and length(codigo) between 1 and 64)`.
**Deliberadamente sin regex de formato.**

### 1.2 Identidad: por qué `codigo` es texto libre acotado

**Requisito duro del encargo, y es correcto:** `codigo` tiene que poder valer
exactamente `NODO-INV-N-01`, porque ese valor está grabado en
`firmware/produccion_parque/produccion_parque.ino:60` y no se puede cambiar sin
reflashear.

Pero además tiene que aceptar `ESP32-INV-N` (los 8 sembrados, `sql/02_datos.sql:202`).
Los dos formatos conviven en la base hoy. Un `check` con regex tipo
`^NODO-[A-Z0-9-]+-\d{2}$` rechazaría los 8 sembrados y haría imposible el
backfill de la decisión 4. Por eso el único `check` es de higiene: sin espacios
al borde, largo razonable.

`id` serial interno separado de `codigo` porque `codigo` es la identidad
*pública* (viaja por la red, está en el firmware, aparece en
`llamados.creado_por`) y una identidad pública no debe ser la clave foránea de
nada: si algún día hay que renombrar un nodo, se cambia `codigo` y las 5 683
filas de `lecturas` siguen apuntando al mismo `id`.

### 1.3 Naturaleza: la columna que resuelve R1

`naturaleza in ('FISICO','SIMULADO')` es el eje del arreglo del riesgo R1
(`03-riesgos.md`). Es **una columna de dos valores**, no un booleano
`es_simulado`, por dos razones:

- Un booleano llamado `es_simulado` con default `false` hace que cualquier fila
  creada sin pensar quede marcada como física. Un `text` con `check` y default
  explícito obliga a que el valor sea siempre uno de los dos declarados.
- Si mañana aparece una tercera naturaleza (`ESPEJO` para un nodo de laboratorio,
  `IMPORTADO` para datos migrados de otro sistema), se agrega al `check` sin
  migrar el tipo de la columna.

Alternativa descartada: **una tabla `dispositivos_simulados` separada**. La
descarté porque duplicaría toda la estructura (código, área, credencial,
telemetría) y porque `/api/ingest` tendría que consultar dos tablas para
resolver una identidad, con el riesgo de que un código exista en las dos. Una
sola tabla con un discriminador hace imposible esa colisión: `codigo` es
`unique` en toda la flota.

### 1.4 Asignación: `area_id` nullable

`NULL` es un estado legítimo y necesario, no un hueco:

- Un nodo recién registrado, todavía en el taller, no tiene área.
- Un nodo de repuesto en depósito no tiene área.
- Un nodo que se retira de un área y todavía no se instala en otra pasa por
  `NULL`.

Hoy eso no se puede representar: `/api/ingest` deriva el área del cuerpo, y un
nodo sin área simplemente recibiría 404 (`01-contrato-ingest.md` §2). La
decisión 8 define qué responde el servidor en cada uno de esos estados.

### 1.5 Capacidades: cinco booleanos, y qué hace cada uno hoy

Las capacidades salen del contrato real del firmware, no de una lista genérica:

| Columna | De dónde sale | Efecto en la etapa 1 |
|---|---|---|
| `reporta_temperatura` | `.ino:562` manda `temperatura` | **descriptivo**: alimenta la UI de `/dispositivos` |
| `reporta_humedad` | `.ino:568` manda `humedad` | descriptivo |
| `reporta_boton` | `.ino:571` manda `boton` | descriptivo |
| `acciona_rele` | `.ino:604-610` lee `rele` y lo aplica | **efectivo**: si es `false`, el servidor devuelve `rele: false` siempre |
| `acciona_alarma` | `.ino:607-608` lee `alarma` | **efectivo**: si es `false`, el servidor devuelve `alarma: false` siempre |

**Soy explícito con la asimetría**: los tres `reporta_*` son documentación
estructurada en esta etapa; no filtran ni validan nada. Los dos `acciona_*` sí
tienen efecto, y son la forma limpia de tener un nodo que mide pero no acciona
(un sensor testigo en un pasillo) sin inventar un tipo de dispositivo.

Alternativa descartada: **`capacidades jsonb`**. Mismo razonamiento que en la
decisión 7, más uno específico: `acciona_rele` y `acciona_alarma` entran en el
camino caliente de `/api/ingest`, que corre cada 10 segundos por nodo. Leer un
booleano de columna es gratis; parsear jsonb en cada request es trabajo
innecesario en un handler que ya tiene un presupuesto de 6 segundos
(`02-contrato-firmware.md` §6.2, punto 15).

### 1.6 Telemetría derivada: `ultimo_contacto_en` **materializada**

Esta es la decisión con más justificación de costo, así que la desarmo.

**Costo del camino actual.** `estadoDeNodos()` (`lib/alertas.ts:216-252`):

```ts
  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await db()
    .from("lecturas")
    .select("dispositivo, area_id, tomada_en")
    .gte("tomada_en", desde)
    .order("tomada_en", { ascending: false })
```

Trae **todas** las lecturas de 24 horas y agrupa en JavaScript, porque
"PostgREST no agrupa" (`lib/alertas.ts:213-215`). Con `INTERVALO_MS = 10000`
(`.ino:93`) eso son **8 640 filas por nodo por día**.

Y se llama seguido:

- desde el tablero, en cada carga (`app/(panel)/page.tsx:159` →
  `revisarNodosCaidos()` → `estadoDeNodos()`);
- desde `/dispositivos` (`app/(panel)/dispositivos/page.tsx:18`), que **se
  refresca solo cada 10 segundos** (`gestor.tsx:17`, `MS_SONDEO = 10_000`, y el
  `setInterval` de `:68-71`).

O sea: con una pestaña de `/dispositivos` abierta, hoy se hace **un barrido
completo de 24 horas de `lecturas` cada 10 segundos**. Con 5 nodos físicos en
régimen serían ~43 000 filas transferidas de Supabase a la función, seis veces
por minuto. El rate limit de `lib/alertas.ts:257-258` limita la *revisión de
caídos* a una cada 20 s, pero **no** limita `estadoDeNodos()`, que
`/dispositivos` llama directo.

**Tres opciones evaluadas:**

| Opción | Costo por barrido | Round-trips | Riesgo |
|---|---|---|---|
| (a) Seguir derivando de `lecturas` como hoy | N × 8 640 filas | 1 | crece sin techo con el tiempo y con la flota |
| (b) Derivar con una consulta por dispositivo: `where dispositivo_id = X order by tomada_en desc limit 1`, con índice `(dispositivo_id, tomada_en desc)` | N filas | **N** | N round-trips por barrido; cada 10 s, con N creciendo |
| (c) **Materializar `dispositivos.ultimo_contacto_en`** | ~10 filas (la tabla entera de dispositivos) | **1** | denormalización: puede quedar desfasada |

**Elijo (c).** El barrido pasa de "leer un día entero de telemetría" a "leer una
tabla de una decena de filas", y deja de depender del volumen de `lecturas`, que
es la tabla que crece 8 640 filas por nodo por día sin política de retención
(`03-riesgos.md` R5).

El costo que agrega es **un `UPDATE` por POST de ingesta**, que se paga en el
lugar correcto: dentro de `after()`, fuera del camino crítico de la respuesta,
igual que ya se hace con los avisos (`lib/avisos.ts:93-97`). El firmware corta a
los 6 segundos (`.ino:102`, `:527-528`), así que todo lo que no sea imprescindible
para armar `rele` y `alarma` tiene que ir a `after()`.

**Mitigación del riesgo de desfasaje**, que es real y hay que nombrarlo:

1. La columna es **advisory**: alimenta el semáforo "sin señal" y la UI. **No es
   fuente de verdad de nada.** Los reportes siguen leyendo `lecturas` y
   `llamados` (decisión 2).
2. Es **recomputable en cualquier momento** desde `lecturas`, con una sentencia
   que sirve tanto de backfill inicial como de reparación:
   *"para cada dispositivo, poner `ultimo_contacto_en` igual al máximo
   `tomada_en` de las lecturas que le pertenecen"*.
3. Un desfasaje solo puede subestimar la frescura (si el `after()` falla, la
   columna queda vieja), y subestimar la frescura genera un llamado "Sensor sin
   señal" de más — que es el lado seguro del error, y que el antirrebote
   (`lib/alertas.ts:128-191`) colapsa en un solo llamado.

**Qué NO materializo, y por qué:** `ultima_temperatura` y `ultima_humedad`. El
tablero ya las obtiene con `ultimaLectura(area.id)`, una consulta por área
acotada con `limit 1` que sí se beneficia del índice declarado
`idx_lecturas_area_hora (area_id, tomada_en desc)` (`sql/01_esquema.sql:101`).
Duplicar los valores medidos en `dispositivos` sería copiar datos de medición
fuera de la tabla de mediciones: es exactamente el tipo de denormalización que
después nadie sabe cuál de las dos copias creer.

---

## 2. Historial de asignación — decisión: **opción (b)**

### 2.1 Las dos opciones

- **(a)** Tabla `dispositivo_asignaciones (dispositivo_id, area_id, desde, hasta)`.
- **(b)** Solo `dispositivos.area_id` vigente, apoyándose en que `lecturas.area_id`
  y `llamados.area_id` ya congelan el área del momento.

### 2.2 Por qué (b) alcanza: el pasado ya está congelado

Esto no es una suposición, está en el código:

- `/api/ingest` escribe `area_id: area.id` en cada lectura
  (`app/api/ingest/route.ts:130`) y en cada llamado (`:157`, `:181`). El valor
  queda **grabado en la fila**, no calculado después.
- Las cinco funciones de reporte agrupan por esa columna congelada, nunca por el
  dispositivo ni por una asignación vigente:
  - `reporte_resumen`: `l.area_id = p_area` (`sql/03_reportes.sql:50`)
  - `reporte_por_area`: `left join llamados l on l.area_id = a.id` (`:83`)
  - `reporte_distribucion`: `l.area_id = p_area` (`:113`)
  - `reporte_por_dia`: `l.area_id = p_area` (`:148`)
  - `reporte_clima_por_dia`: `le.area_id = p_area` (`:203`)

**Ninguna menciona `dispositivo` ni `dispositivo_id`.** Por lo tanto la
propiedad que el encargo exige —*"el histórico de reportes NO debe depender de
la asignación vigente"*— **ya se cumple hoy y se seguirá cumpliendo sola**,
siempre que se respete una regla que dejo escrita como invariante:

> **Invariante R-1.** Las funciones `reporte_*` no se modifican y **nunca** deben
> resolver el área a través de `dispositivos.area_id`. El área de un hecho
> histórico es la que quedó grabada en la fila del hecho.

Reasignar `NODO-INV-N-01` de INV-N a COM-1 no mueve ni una fila de reporte: las
280 lecturas viejas conservan `area_id = 1` y las nuevas nacen con `area_id = 5`.

### 2.3 Qué se pierde con (b), dicho sin adornos

Se pierde **la fecha del cambio**, no el dato. Con (b) no se puede responder
"¿en qué área estaba el nodo X el 5 de septiembre?" mirando una tabla de
asignaciones. Sí se puede responder por aproximación, mirando qué `area_id`
tienen sus lecturas de ese día — que es la misma respuesta, obtenida de los
hechos en vez de una declaración.

Hoy ninguna pantalla, ningún reporte y ninguna función hace esa pregunta.
Verificado: `grep` sobre `app/`, `lib/` y `sql/` no encuentra ninguna consulta
por historial de asignación, porque la noción de dispositivo asignado todavía no
existe.

### 2.4 Por qué descarto (a) *por ahora*, no para siempre

(a) es una tabla más, con dos escrituras por reasignación (cerrar el tramo
anterior poniendo `hasta`, abrir el nuevo), un invariante de no-solapamiento que
hay que sostener sin triggers —y los triggers son justamente lo que
`00-auditoria.md` §4.8 no pudo verificar— y una consulta temporal
(`where desde <= t and (hasta is null or hasta > t)`) que nadie va a escribir
bien la primera vez.

Todo eso para responder una pregunta que el sistema no hace, en un parque con
**un nodo físico**.

Y lo importante: **(a) se puede agregar después de forma puramente aditiva**,
sin tocar nada de (b). `dispositivos.area_id` seguiría siendo el puntero
vigente; la tabla nueva sería el registro histórico, y se sembraría con un tramo
abierto por cada dispositivo. No hay deuda que se acumule por esperar.

**Cuándo revisar esta decisión:** cuando haya más de un nodo por área y empiecen
a rotar entre áreas, o cuando alguien tenga que auditar una asignación
equivocada ("este nodo estuvo tres días midiendo el área que no era"). Ahí (a)
deja de ser ceremonia y pasa a ser necesaria.

### 2.5 El backfill sale gratis

Como cada dispositivo escribió **siempre en una sola área** (verificado en §0),
`dispositivos.area_id` se puede sembrar sin ambigüedad: el área de cualquiera de
sus lecturas es *la* área. Si el resultado hubiera mostrado un dispositivo con
dos áreas, esta decisión habría sido otra.

---

## 3. Cardinalidad

### 3.1 La regla

- **Un dispositivo tiene 0 o 1 área operativa vigente.** Se implementa como una
  sola columna `area_id` nullable en `dispositivos`. No hace falta constraint:
  una columna escalar no puede tener dos valores.
- **Un área puede tener N dispositivos.** Se implementa **no** poniendo un
  `unique` sobre `dispositivos.area_id`.

### 3.2 Por qué 0-o-1 y no N áreas por dispositivo

Un nodo es un objeto físico atornillado en un lugar. Mide el aire de *ese*
lugar. Que un dispositivo reportara para dos áreas obligaría a
`lecturas.area_id` a ser un arreglo o a duplicar la fila, y rompería el
invariante R-1 y las cinco funciones de reporte.

Nota de contraste: `empleados` **sí** es multivaluado (`areas_ids int[]`,
`sql/04_multiseleccion.sql:19-20`), porque una persona sí recorre varias áreas.
La asimetría es correcta y deliberada: personas se mueven, sensores no.

### 3.3 Verificación: ¿hay hoy algo que asuma 1 área = 1 dispositivo?

Revisé las cuatro estructuras que tocan la relación. **Ninguna asume lo
contrario**, pero tres cambian de significado con N > 1 y hay que decirlo:

| Estructura | ¿Soporta N dispositivos por área? | Consecuencia con N > 1 |
|---|---|---|
| `estadoDeNodos()` (`lib/alertas.ts:230-247`) | **Sí**. Agrupa por `dispositivo` y arrastra `area_id` por dispositivo. | Ninguna. Devuelve una fila por nodo. |
| `revisarNodosCaidos()` (`lib/alertas.ts:305-322`) | Sí itera por nodo, **pero** | El antirrebote agrupa por `(area_id, motivo)` (`lib/alertas.ts:140-142`). Si **dos** nodos de la misma área se caen, el segundo **no genera un llamado propio**: solo reescribe el `detalle` del primero (`:155-164`). **La caída del segundo nodo queda invisible.** |
| `ultimaLectura(area.id)` del tablero (`app/(panel)/page.tsx:191`) | Sí | Muestra la lectura del nodo que reportó último, **mezclando** dos sensores distintos en la misma celda sin decir cuál. |
| `hayEmergenciaAbierta(area.id)` (`lib/alertas.ts:194-203`) | Sí | **Todos** los nodos del área reciben `alarma: true` cuando cualquier llamado del área está abierto. Es la R8 amplificada. |

**Decisión sobre esas tres consecuencias:** se aceptan en esta etapa, porque hoy
hay **un** nodo físico y ninguna se manifiesta. Quedan anotadas como deuda con
disparador explícito:

> **Deuda C-1.** Cuando se instale el segundo nodo físico en un área que ya
> tenga uno, la clave del antirrebote para el motivo `Sensor sin señal`
> (`lib/catalogos.ts:142`) tiene que pasar de `(area_id, motivo)` a
> `(area_id, motivo, dispositivo_id)`. Los otros motivos, que describen el
> **ambiente** y no el **aparato**, siguen agrupando por área: dos sensores del
> mismo invernadero midiendo la misma temperatura alta son un solo problema.

Esa distinción —motivos del aparato vs. motivos del ambiente— es la regla, y
conviene que quede escrita ahora que se está pensando el modelo, no después
cuando aparezca el síntoma.

---

## 4. Vínculo `lecturas` ↔ `dispositivos`

### 4.1 La propuesta

| Columna | Tabla | Clase | Definición |
|---|---|---|---|
| `dispositivo_id` | `lecturas` (**existente**) | **nueva** | `int NULL references dispositivos (id)` |
| `dispositivo` | `lecturas` (**existente**) | **se conserva intacta** | `text NULL`, sin cambios de tipo, nombre ni contenido |

Índice nuevo: `(dispositivo_id, tomada_en desc)`.

Backfill: emparejar por igualdad exacta `lecturas.dispositivo = dispositivos.codigo`.
Verificado en §0 que **no hay `dispositivo` nulo** en las 5 683 filas y que los
13 valores distintos van a existir como dispositivos, así que el backfill deja
`dispositivo_id` completo, sin huérfanas.

### 4.2 Por qué `dispositivo_id` nace **nullable** y no NOT NULL

Tres razones concretas:

1. Durante la migración, la columna existe antes de que el backfill corra. NOT
   NULL exigiría un default falso.
2. Es el mecanismo de observación de la transición de autenticación: cuando el
   fallback global esté activo (decisión 6), las lecturas que entran por ese
   camino **no tienen dispositivo resuelto** y quedan con `dispositivo_id NULL`.
   Contar esas filas es la señal medible que autoriza a apagar el fallback.
   Ver `11-plan-migracion.md`, paso 7.
3. Volverla NOT NULL más adelante es una migración de una línea, una vez que el
   fallback esté apagado y el contador esté en cero de forma sostenida.

### 4.3 Por qué NO se borra ni se renombra `lecturas.dispositivo`

Es una columna de texto que sigue siendo **load-bearing** en cinco lugares
verificados. Borrarla o renombrarla rompe todos a la vez:

1. **`estadoDeNodos()`** la lee y la usa como clave del `Map`
   (`lib/alertas.ts:221`, `:233-246`). Aunque el barrido pase a leer
   `dispositivos` (decisión 1.6), la función devuelve `NodoVigilado.dispositivo`
   (`lib/alertas.ts:206`) y ese campo alimenta la UI.
2. **`revisarNodosCaidos()`** la mete en el texto del llamado y en el autor:
   `` `El nodo ${nodo.dispositivo} no reporta hace ${nodo.segundos} segundos.` ``
   (`lib/alertas.ts:315`) y `creadoPor: nodo.dispositivo` (`:317`).
3. **`/api/ingest`** la escribe (`route.ts:129`) y usa `cuerpo.dispositivo` para
   el detalle del desvío (`detalleDeDesvio(desvio, cuerpo.dispositivo, momento)`,
   `route.ts:162`) y para `creadoPor` (`:163`, `:191`).
4. **El tablero** muestra el dispositivo de la última lectura de cada área
   (`app/(panel)/page.tsx`, sobre el objeto `Lectura` de `lib/tipos.ts:59-66`,
   cuyo campo `dispositivo: string | null` es exactamente esta columna).
5. **La exportación CSV**, con una precisión importante: `/api/exportar/csv`
   **no lee `lecturas`**, exporta `llamados` (`csv/route.ts:88-109`). Pero su
   columna "Creado por" vuelca `llamados.creado_por` (`csv/route.ts:104`), que
   para los llamados de origen SENSOR contiene **el código del dispositivo como
   texto suelto** — verificado en la base: 269 llamados con `ESP32-*` y 14 con
   `NODO-*` (`00-auditoria.md` §5).

El punto 5 es el que cierra el argumento: **`llamados.creado_por` es texto libre
y no tiene FK a nada**. Guarda indistintamente códigos de dispositivo
(`ESP32-INV-G`), nombres de usuario (`admin`, `lbarrios`) y legajos
(`PAB-0001`). No se puede normalizar sin partirla en tres, y no está en el
alcance de esta etapa. Mientras esa columna siga siendo texto, la identidad
textual del dispositivo **tiene que seguir existiendo** en `lecturas` para poder
cruzar una cosa con la otra.

Y hay un argumento de datos: los 5 384 registros `ESP32-<codigo>` son ficción
sembrada por `sql/02_datos.sql:202`. Su única identidad es esa cadena. Si se
borra la columna de texto, se pierde la trazabilidad de qué era sembrado y qué
era real —justo el problema que estamos tratando de arreglar.

**Regla resultante:**

> **Invariante R-2.** `lecturas.dispositivo` es el **testimonio de lo que el
> nodo dijo ser**. `lecturas.dispositivo_id` es **a quién lo atribuyó el
> servidor**. Se escriben las dos, siempre, y nunca se sincronizan
> retroactivamente. Si difieren, esa diferencia es información, no un error a
> corregir.

Esa regla es la que hace auditable la transición: se puede consultar
"lecturas donde el texto dice una cosa y la credencial resolvió otra".

### 4.4 Nota honesta sobre las 280 filas de `NODO-INV-N-01`

El backfill va a atribuir esas 280 filas al dispositivo físico
`NODO-INV-N-01`. **Son una mezcla irrecuperable de hardware real y simulaciones**
(`03-riesgos.md` R1): el simulador escribía exactamente ese código
(`dispositivos/gestor.tsx:98`, `dispositivo: nodoDe(simulacion.area)`).

No hay forma de separarlas a posteriori, y este diseño **no pretende que la
haya**. Lo que corresponde es dejar constancia: en `dispositivos.observaciones`
del nodo físico se anota la fecha de corte de la migración y la leyenda de que
las lecturas anteriores tienen identidad ambigua. A partir del corte, la
naturaleza queda garantizada por construcción (decisión 9).

---

## 5. Credenciales por dispositivo — tabla `dispositivo_credenciales` (**NUEVA**)

### 5.1 Definición propuesta

| Columna | Tipo | Nulo | Default | Clase | Referencia |
|---|---|---|---|---|---|
| `id` | `serial` | NOT NULL | — | **nueva**, PK | — |
| `dispositivo_id` | `int` | NOT NULL | — | **nueva**, FK `on delete cascade` | → `dispositivos.id` (**nueva**) |
| `algoritmo` | `text` | NOT NULL | `'sha256-v1'` | **nueva**, `check in ('sha256-v1','bcrypt-v1')` | — |
| `secreto_hash` | `text` | NOT NULL | — | **nueva** | — |
| `prefijo` | `text` | NULL | — | **nueva** | — |
| `estado` | `text` | NOT NULL | `'ACTIVA'` | **nueva**, `check in ('ACTIVA','ROTADA','REVOCADA')` | — |
| `origen` | `text` | NOT NULL | `'GENERADA'` | **nueva**, `check in ('GENERADA','LEGADO')` | — |
| `expira_en` | `timestamptz` | NULL | — | **nueva** | — |
| `usada_en` | `timestamptz` | NULL | — | **nueva** | auditoría de uso |
| `creada_en` | `timestamptz` | NOT NULL | `now()` | **nueva** | — |
| `creada_por` | `text` | NULL | — | **nueva** | usuario de la sesión |
| `revocada_en` | `timestamptz` | NULL | — | **nueva** | — |
| `revocada_por` | `text` | NULL | — | **nueva** | — |
| `motivo` | `text` | NULL | — | **nueva** | por qué se revocó o rotó |

Índices nuevos:
- `unique (secreto_hash) where algoritmo = 'sha256-v1'` — parcial, es el que
  habilita la búsqueda directa por hash.
- `(dispositivo_id)`.

### 5.2 El problema que condiciona todo: el header no dice quién es

El firmware manda **solo** `x-device-key` (`.ino:546-549`). El identificador del
dispositivo viaja en el **cuerpo** (`.ino:553`), que es dato no confiable.

Eso deja dos formas de verificar:

- **(A)** Leer `body.dispositivo` → buscar el dispositivo → verificar la clave
  contra sus credenciales. Funciona con cualquier algoritmo, incluso salado.
  Pero hace que la identidad dependa de un campo del cuerpo.
- **(B)** Hashear la clave presentada y buscar **directamente por el hash**. El
  header solo determina el dispositivo, sin tocar el cuerpo. Requiere un hash
  **determinista** (sin sal por fila).

**(B) es estrictamente mejor**: no confía en el cuerpo para nada, y es una sola
consulta indexada. Pero (B) es incompatible con bcrypt, que es salado por
diseño.

### 5.3 Por qué SHA-256 y no bcrypt, para los secretos generados

Elijo **SHA-256 sobre un secreto de alta entropía generado por el servidor**.
La justificación es que bcrypt resuelve un problema que acá no existe:

1. **Bcrypt existe para resistir fuerza bruta offline de contraseñas elegidas
   por humanos**, que tienen 20-40 bits de entropía. Un secreto generado por el
   servidor con 32 bytes aleatorios tiene **256 bits**. No hay nada que
   bruteforcear: recorrer ese espacio es físicamente imposible, con o sin
   función lenta. El "factor de trabajo" no compra seguridad, compra factura.

2. **El costo es real y recurrente.** Bcrypt con costo 10 son decenas de
   milisegundos de CPU pura por verificación. El nodo postea cada 10 segundos
   (`.ino:93`), o sea **8 640 verificaciones por nodo por día**, en un entorno
   serverless donde se paga el tiempo de CPU. Y compite con el presupuesto de 6
   segundos del cliente (`.ino:102`).

3. **Bajar el costo de bcrypt es lo peor de los dos mundos:** se paga la
   complejidad de una función lenta sin obtener la lentitud que la justifica.
   Descarto explícitamente esa opción del encargo.

4. **Bcrypt fuerza el camino (A).** Al ser salado por fila, no se puede indexar
   ni buscar por hash: hay que identificar primero el dispositivo desde el
   cuerpo. SHA-256 determinista permite el camino (B) y una búsqueda de una sola
   fila por índice único.

Formato del secreto generado: prefijo legible `pab_` + 32 bytes aleatorios en
base64url. El prefijo hace que el secreto sea reconocible si aparece en un log o
en un repositorio, que es lo que hace la diferencia entre detectar una fuga y no
detectarla.

`prefijo` guarda los primeros 8 caracteres para que la UI pueda mostrar
`pab_A7xK…` e identificar la credencial sin revelarla. Sobre un secreto de 256
bits, exponer 8 caracteres deja intacta la seguridad.

**Nunca texto plano.** El secreto completo se muestra **una sola vez**, en la
respuesta de la Server Action que lo crea, y no se persiste en ningún lado.

### 5.4 Por qué igual existe `bcrypt-v1`: la clave que ya está grabada

Acá hay que ser honesto sobre un límite: la clave que el nodo ya tiene grabada
(`.ino:57`) es de **siete caracteres**. Eso son unos 36 bits de entropía en
el mejor caso.

**Ninguna función de hash arregla un secreto de siete caracteres.** Si la tabla
se filtrara y ese secreto estuviera guardado como SHA-256 sin sal, se recupera
en microsegundos. Bajo bcrypt costo 10, recuperarlo cuesta órdenes de magnitud
más. La diferencia no es decisiva, pero es gratis, y **es exactamente el caso de
uso para el que bcrypt fue inventado**: un secreto de baja entropía que no
elegimos nosotros y que no podemos cambiar todavía.

Por eso la tabla soporta **dos algoritmos**, con caminos distintos:

| Algoritmo | Búsqueda | Cuándo se usa | Costo por request |
|---|---|---|---|
| `sha256-v1` | **(B)** directa por `secreto_hash`, índice único parcial | todo secreto generado por el servidor | despreciable |
| `bcrypt-v1` | **(A)** vía `body.dispositivo` → dispositivo → sus credenciales | **solo** el secreto heredado del firmware | un bcrypt, y solo para dispositivos que tengan una credencial de ese tipo |

El camino lento está **acotado por construcción**: se intenta únicamente si la
búsqueda rápida falló, y solo hay **un** dispositivo con credencial
`bcrypt-v1`. Un bcrypt cada 10 segundos es ~1 % de un núcleo. Y desaparece solo:
en cuanto el nodo se reflashee con un secreto generado (decisión 6, paso c), esa
fila se revoca y el soporte de `bcrypt-v1` se puede quitar del código.

Detalle: para la credencial legada, **`prefijo` queda `NULL`**. Guardar los
primeros 8 caracteres de un secreto de 7 sería publicar el secreto entero.

### 5.5 Estados y rotación

- **`ACTIVA`** — verifica. Es el estado normal.
- **`ROTADA`** — verifica **mientras `expira_en > now()`**. Es la ventana de
  gracia: se crea la credencial nueva, se marca la vieja como rotada con
  vencimiento, y el nodo sigue funcionando con la vieja hasta que alguien vaya
  físicamente a reflashearlo. Sin esta ventana, rotar una clave implicaría
  dejar el nodo mudo entre el cambio en la base y el viaje al invernadero.
- **`REVOCADA`** — **nunca** verifica, sin importar fechas. Es el freno de mano.

Que dos credenciales del mismo dispositivo verifiquen a la vez durante la
ventana es el comportamiento buscado, no un defecto.

Regla de verificación completa:

> Una credencial verifica si y solo si:
> `estado = 'ACTIVA'`, **o** (`estado = 'ROTADA'` **y** `expira_en > now()`);
> y además, si `expira_en` no es nulo, `expira_en > now()`.
> `REVOCADA` no verifica jamás.

### 5.6 Auditoría de uso

`usada_en` se actualiza en cada verificación exitosa, **dentro de `after()`**,
junto con `dispositivos.ultimo_contacto_en`. Las dos escrituras son telemetría:
no pueden estar en el camino que le responde al nodo, por el presupuesto de 6
segundos (`02-contrato-firmware.md` §6.2, punto 15).

Para qué sirve concretamente: durante una ventana de rotación, `usada_en` de la
credencial vieja es **la** señal que dice si ya es seguro revocarla. Si hace 48
horas que nadie la usa, el nodo ya está con la nueva.

Lo que **no** hago en esta etapa, y lo digo para que no se dé por hecho: no hay
contador de intentos fallidos, ni bloqueo por fuerza bruta, ni registro de IP de
origen. Se anota como trabajo posterior; con un secreto de 256 bits el bloqueo
por intentos aporta poco, pero el registro de fallos sí serviría para detectar
que alguien está probando.

---

## 6. Transición de autenticación **sin reflashear el nodo**

Este es el requisito que ordena todo el plan de migración. El nodo tiene su
clave grabada y `SERVIDOR` apuntando a producción (`.ino:54,57`), y
`02-contrato-firmware.md` §6.1 documenta que rotar la clave sin reflashear lo
deja respondiendo 401 en silencio, sin reintentos y sin avisar a nadie.

### 6.1 (a) Sembrar el dispositivo con el hash de la clave que ya tiene

Se crea la fila en `dispositivos`:

- `codigo = 'NODO-INV-N-01'` — **idéntico** al `DISPOSITIVO` del firmware
  (`.ino:60`). Este es el requisito duro de la decisión 1.
- `nombre = 'Nodo Invernadero Norte'`, `modelo = 'ESP32-S3-Zero'` (`.ino:6`).
- `area_id` = el id de `INV-N`, que es **1** (verificado, `00-auditoria.md` §4.11).
- `naturaleza = 'FISICO'`, `activo = true`.
- `acciona_rele = true`, `acciona_alarma = true` (el firmware lee los dos,
  `.ino:604-608`).

Y una fila en `dispositivo_credenciales`:

- `algoritmo = 'bcrypt-v1'`, `origen = 'LEGADO'`, `estado = 'ACTIVA'`,
  `prefijo = NULL`.
- `secreto_hash` = bcrypt de la clave actual, generado aparte y pegado en la
  migración.
- `expira_en` = una fecha límite explícita, para que la deuda tenga vencimiento
  en vez de quedar para siempre.

**Resultado: el nodo pasa a autenticarse por credencial propia sin cambiar una
sola línea de firmware.** Manda el mismo header con el mismo valor; lo que
cambia es que el servidor ahora lo resuelve a un dispositivo concreto en vez de
a "alguien que sabe la clave global". Eso es la atribución, y es todo el punto.

**Detalle de orden que importa:** durante la ventana de transición, el valor
grabado en `.ino:57` va a ser simultáneamente la credencial del dispositivo **y** el
`DEVICE_KEY` global. La cascada tiene que probar **primero la credencial del
dispositivo**. Si probara primero el fallback global, el nodo seguiría entrando
como anónimo y la migración no habría servido de nada.

### 6.2 (b) El fallback global detrás de un flag

Variable de entorno: **`INGEST_PERMITE_CLAVE_GLOBAL`**.

**Default seguro: apagado.** Ausente, vacía o distinta de `"1"` ⇒ el fallback
**no** existe. Solo el valor literal `"1"` lo enciende.

Justificación del default cerrado, contra el riesgo obvio de que apagarse de más
deje el nodo mudo:

1. La alternativa (default encendido) es el modo clásico de que una medida
   temporal se vuelva permanente: nadie apaga lo que ya funciona, y `DEVICE_KEY`
   quedaría abriendo `/api/ingest` para siempre. Eso es R2 sin arreglar.
2. **Fallar cerrado acá es observable, no silencioso.** Si el fallback estuviera
   apagado y la credencial no estuviera sembrada, el nodo recibiría 401; por
   `02-contrato-firmware.md` §5.1 eso **no rearma el failsafe**, así que a los 45
   segundos el relé se apaga solo (estado seguro), y a los 90 segundos el
   servidor crea un llamado de EMERGENCIA "Sensor sin señal"
   (`lib/alertas.ts:18`, `:313`). El sistema **grita**. Ese es exactamente el
   comportamiento que se quiere de un fallo de autenticación.
3. El orden del plan de migración elimina la ventana de riesgo: la base se
   siembra **antes** de desplegar el código, y las migraciones de este repo se
   corren a mano en el editor SQL de Supabase, así que el orden es imponible.

Comportamiento cuando el fallback está encendido **y se usa**: la request no
resuelve ningún dispositivo, así que **cae exactamente en la conducta de hoy** —
el área se busca por `body.area` contra `areas.codigo`, la lectura se guarda con
`dispositivo_id = NULL` y `dispositivo = body.dispositivo`. No es un camino
nuevo que haya que diseñar y probar: es el camino viejo, intacto, detrás de una
llave.

### 6.3 (c) Apagar el fallback, con una compuerta medible

La señal que autoriza a apagarlo no es una impresión, es una consulta:

> *Contar las lecturas de las últimas 24 horas cuyo `dispositivo_id` sea nulo.*

Mientras dé cero de forma sostenida, **nadie está entrando por el fallback** y
apagarlo no rompe nada. Si da distinto de cero, esas filas dicen exactamente qué
`dispositivo` (texto) todavía no tiene credencial propia.

Esa compuerta funciona gracias a la decisión 4.2: `dispositivo_id` nullable no
es una concesión, es el instrumento de medición.

**Dependencia que hay que ver antes de llegar acá:** el simulador usa
`process.env.DEVICE_KEY` (`app/(panel)/dispositivos/acciones.ts:47`). Si se
apaga el fallback global sin haberle dado credencial propia al simulador,
**el simulador deja de funcionar**. Por eso en el plan de migración la
credencial del simulador (decisión 9) va **antes** del apagado, no después.

Apagado definitivo: quitar la variable de Vercel, redesplegar, y sacar del
código la lectura de `DEVICE_KEY` en el camino de ingesta. Recién ahí R2 queda
cerrado.

---

## 7. Automatización separada de las alertas

### 7.1 Qué hace hoy, literal

`app/api/ingest/route.ts:200-203`:

```ts
  const rele =
    (cuerpo.temperatura !== null &&
      cuerpo.temperatura > Number(area.temp_max)) ||
    (cuerpo.humedad !== null && cuerpo.humedad < Number(area.hum_min));
```

Dos de las cuatro condiciones posibles accionan, las otras dos no. La elección
está cableada y no se puede cambiar por área.

### 7.2 La propuesta: cuatro booleanos en `areas` (**tabla existente, columnas nuevas**)

| Columna | Tipo | Nulo | **Default** | Significado |
|---|---|---|---|---|
| `auto_temp_alta` | `boolean` | NOT NULL | **`true`** | accionar cuando `temperatura > temp_max` (ventilar) |
| `auto_temp_baja` | `boolean` | NOT NULL | **`false`** | accionar cuando `temperatura < temp_min` (calefaccionar) |
| `auto_hum_alta` | `boolean` | NOT NULL | **`false`** | accionar cuando `humedad > hum_max` (extraer) |
| `auto_hum_baja` | `boolean` | NOT NULL | **`true`** | accionar cuando `humedad < hum_min` (regar) |

Expresión objetivo, término por término:

```
rele =
     (temperatura != null && auto_temp_alta && temperatura > temp_max)
  || (temperatura != null && auto_temp_baja && temperatura < temp_min)
  || (humedad     != null && auto_hum_alta  && humedad     > hum_max)
  || (humedad     != null && auto_hum_baja  && humedad     < hum_min)
```

Se conservan las **comparaciones estrictas** (`>` y `<`) y las **guardas de
null**, tal como están hoy (`01-contrato-ingest.md` §4). Estar exactamente en el
límite sigue dejando el relé apagado.

### 7.3 El backfill, en prosa, y por qué reproduce la conducta actual **exactamente**

> **El backfill no necesita ninguna sentencia `UPDATE`: el `default` de cada
> columna nueva *es* el backfill.**
>
> Al agregar las cuatro columnas como `not null default <valor>`, Postgres
> completa **todas las filas existentes** de `areas` con ese valor. Las ocho
> áreas que hay hoy quedan, sin excepción, con `auto_temp_alta = true`,
> `auto_temp_baja = false`, `auto_hum_alta = false`, `auto_hum_baja = true`.
>
> Reemplazando esos cuatro valores en la expresión objetivo, los dos términos
> centrales se anulan —una conjunción con `false` es `false`, y una disyunción
> con `false` es el otro operando— y lo que queda es:
>
> `rele = (temperatura != null && temperatura > temp_max) || (humedad != null && humedad < hum_min)`
>
> que es **carácter por carácter la misma condición** de
> `app/api/ingest/route.ts:200-203`.
>
> En castellano: *"temperatura por encima del máximo" y "humedad por debajo del
> mínimo" quedan marcadas por defecto en todas las áreas existentes; las otras
> dos, desmarcadas.* Cualquier área que se cree después nace con la misma
> configuración, porque hereda el mismo default.

Que el backfill sea "no hacer nada" es la propiedad más fuerte que se le puede
pedir a una migración de compatibilidad: no hay una sentencia que pueda correr a
medias, ni un orden que se pueda equivocar, ni filas que se puedan saltear.

### 7.4 Cuatro booleanos vs. un `jsonb`: la justificación

| Criterio | 4 columnas `boolean` | `automatizacion jsonb` |
|---|---|---|
| **Validación en la Server Action** | `areas/acciones.ts` ya valida campo por campo y ya maneja un booleano, `activa` (`cambiarActivaArea`, `:155-175`). Cuatro más son cuatro lecturas del `FormData` con el mismo patrón. | Hay que escribir un parser y un validador de forma para el objeto, y decidir qué hacer con claves desconocidas o faltantes. Código nuevo, sin precedente en el repo. |
| **Backfill de compatibilidad** | El `default` de la columna lo resuelve solo (§7.3). | Hay que escribir un `update` que arme el objeto en cada fila, y que sea idempotente. Una sentencia que puede fallar. |
| **Tipado** | `lib/tipos.ts:10-21` (`Area`) suma cuatro `boolean`. TypeScript los ve. | Hay que declarar un tipo anidado y sostener a mano que coincida con lo que hay guardado. El compilador no puede verificarlo contra la base. |
| **Modal de edición** | Cada flag mapea 1:1 a un checkbox. | Igual en pantalla, pero con serialización y deserialización en el medio. |
| **Integridad** | `not null` + tipo booleano: no existe el estado inválido. | Postgres no valida la forma de un `jsonb` sin escribir un `check` con expresiones sobre el objeto. |
| **Camino caliente** | Cuatro booleanos leídos en el mismo `select` del área (`route.ts:106-108`), costo cero. | Parseo de `jsonb` en cada POST, cada 10 s por nodo. |
| **Agregar una quinta automatización** | `alter table areas add column if not exists ... default ...` — que es **el estilo de migración que este repo ya usa** (`sql/04_multiseleccion.sql:19-26`, `sql/05_avisos.sql`). | Una clave nueva en el objeto y código que tolere las filas viejas que no la tienen. |

**Elijo cuatro columnas booleanas.** El único argumento a favor del `jsonb` —no
migrar el esquema cuando se agrega un flag— es débil en un repositorio cuya
convención declarada es que *"todo SQL es una migración nueva, aditiva e
idempotente"*: agregar una columna con default no es un costo, es el
procedimiento normal.

### 7.5 El invariante que le da sentido al título

> **Invariante R-3.** Los cuatro flags gobiernan **únicamente la actuación**
> (el campo `rele` de la respuesta). **No** intervienen en la generación de
> llamados. `evaluarDesvios()` (`lib/alertas.ts:40-101`) sigue evaluando las
> cuatro condiciones contra los cuatro umbrales, sin cambios, y sigue creando
> los mismos llamados con los mismos motivos.
>
> Dicho de otro modo: **desmarcar un flag apaga una bomba, nunca apaga una
> alarma.** Un área con `auto_hum_baja = false` que se seca sigue generando el
> llamado "Humedad por debajo del umbral" (`lib/catalogos.ts:141`); lo que no
> hace es abrir el riego sola.

Eso es exactamente lo que hoy está conflacionado: la única expresión de
`route.ts:200-203` mezcla "vale la pena accionar" con un subconjunto arbitrario
de "está fuera de rango". Separarlas es el objetivo de esta decisión.

Y queda dicho explícitamente, porque el encargo lo exige: **`temp_min`,
`temp_max`, `hum_min` y `hum_max` no cambian de significado ni de tipo.** Siguen
definiendo la normalidad, siguen alimentando `evaluarDesvios()` y siguen siendo
los mismos `numeric not null` de siempre.

### 7.6 Una conducta que **no** cambio, y por qué

Hoy `rele` y `alarma` se calculan **fuera** del `if (area.activa)`
(`route.ts:150` abre el bloque, `:196` lo cierra, y `:200-205` quedan afuera).
O sea: un área dada de baja igual recibe órdenes de actuación.

Se podría argumentar que un área inactiva no debería accionar nada. Es una
mejora defendible. **No la incluyo en esta etapa**, y lo dejo asentado como
decisión consciente: la regla de este rediseño es que la migración no cambia
conducta observable salvo donde el encargo lo pide explícitamente. Cambiar esto
haría que un área dada de baja pase de "el riego sigue andando" a "el riego se
corta", que es un efecto físico en el parque, y merece decidirse por separado y
con la persona que opera. Queda anotado como **pregunta abierta A-1**.

---

## 8. Resolución de área del lado del servidor

### 8.1 La cascada

```
x-device-key
   → credencial (sha256-v1 directa | bcrypt-v1 vía body.dispositivo)
      → dispositivo
         → dispositivos.area_id
            → areas: temp_min, temp_max, hum_min, hum_max   (umbrales, sin cambios)
                     auto_temp_alta/baja, auto_hum_alta/baja (automatización, decisión 7)
                     activa
```

**`body.area` deja de participar de la resolución de identidad.** El propio
firmware lo pide: `.ino:23-27` y `:62-63` dicen que el campo está "SOLO por
compatibilidad" y que "el backend nuevo debe ignorarlo al decidir a que area
pertenece el nodo". Este diseño hace exactamente eso.

`body.dispositivo` tampoco determina la identidad, **salvo** como pista para
ubicar la credencial legada `bcrypt-v1` (decisión 5.4) — y aun ahí, la clave
sigue siendo lo que autoriza: nombrar un dispositivo sin tener su secreto no
sirve de nada.

### 8.2 El principio que ordena los códigos de respuesta

Del contrato del firmware salen dos hechos que no se pueden ignorar:

1. **Cualquier 200 con JSON legible rearma el failsafe** (`.ino:599-602`). El
   nodo pasa a considerar al servidor vivo.
2. **Cualquier respuesta que no sea 200 deja el relé en su último estado** hasta
   que pasen los 45 segundos del failsafe (`.ino:326-348`). No es apagado
   inmediato, es apagado diferido.

De ahí la herramienta correcta para cada intención:

| Lo que quiero que pase con el relé | Qué tengo que responder |
|---|---|
| **Apagarlo ya**, manteniendo al nodo sano | **200 con `rele: false`** |
| Que el nodo trate al servidor como caído (apagado en 45 s) | **cualquier cosa que no sea 200** |

Esto invierte una intuición común: ante un dispositivo mal configurado, el
reflejo sería devolver un 4xx. **Es peor.** Un 4xx tarda 45 segundos en apagar
el relé y, mientras tanto, el nodo tampoco confirma el botón pendiente
(`.ino:612-622`, que solo se limpia con 200) y lo reintenta cada 10 segundos.
Un `200 + rele:false` apaga en el acto y deja todo lo demás sano.

### 8.3 Tabla de casos

| # | Caso | HTTP | `rele` | `alarma` | ¿Guarda lectura? | `dispositivo_id` | `area_id` de la lectura | ¿Genera llamados? |
|---|---|---|---|---|---|---|---|---|
| 1 | Credencial válida · dispositivo activo · área asignada y **activa** | **200** | calculado (decisión 7) | `hayEmergenciaAbierta(area)` | **sí** | el resuelto | el del dispositivo | sí |
| 2 | Credencial válida · dispositivo activo · área asignada pero **inactiva** | **200** | calculado | calculado | **sí** | el resuelto | el del dispositivo | **no** (conducta de hoy, `route.ts:150`) |
| 3 | Credencial válida · **dispositivo inactivo** (`activo = false`) | **200** | **`false`** | **`false`** | **sí** | el resuelto | el del dispositivo (puede ser null) | **no** |
| 4 | Credencial válida · dispositivo activo · **sin área** (`area_id is null`) | **200** | **`false`** | **`false`** | **sí** | el resuelto | **null** | **no** |
| 5 | Credencial válida · `body.area` **distinta** de la asignada | **200** | calculado sobre **la asignada** | ídem | **sí** | el resuelto | el del dispositivo | sí |
| 6 | Header ausente, clave incorrecta, credencial **REVOCADA** o vencida | **401** | — | — | **no** | — | — | no |
| 7 | Cuerpo no es JSON, o `boton` inválido, o falta `dispositivo` | **400** | — | — | **no** | — | — | no |
| 8 | Fallback global encendido y usado (transición) | **200** | calculado sobre el área de `body.area` | ídem | **sí** | **null** | el de `body.area` | sí |
| 9 | Fallback global encendido, usado, y `body.area` **no existe** | **404** | — | — | **no** | — | — | no |
| 10 | `DEVICE_KEY` no configurada **y** fallback encendido | **500** | — | — | no | — | — | no |
| 11 | Error de base al leer o escribir | **500** | — | — | no | — | — | no |

Los casos 6, 7, 9, 10 y 11 son **idénticos a hoy** (`01-contrato-ingest.md` §2).
Los casos 8, 9 y 10 desaparecen cuando se apaga el fallback (decisión 6.3), y
con ellos desaparece el 404 del endpoint.

### 8.4 Justificación de los casos nuevos

**Caso 3, dispositivo inactivo → 200 + `rele:false`.** Dar de baja un nodo en el
panel tiene que **apagar su relé en el acto**, no dentro de 45 segundos y no
"cuando alguien vaya a desenchufarlo". Y la lectura se guarda igual, porque el
hecho de que un aparato dado de baja siga hablando es información operativa que
alguien tiene que poder ver.

**Caso 4, sin área → 200 + `rele:false`.** Sin área no hay umbrales, y sin
umbrales no hay nada que calcular. Accionar sería inventar. La lectura se guarda
con `area_id = null` —lo que hoy no puede pasar porque el endpoint responde 404
antes— y por eso queda fuera de toda la maquinaria de alertas, que ya filtra los
nulos: `revisarNodosCaidos()` descarta explícitamente los nodos con
`area_id === null` (`lib/alertas.ts:290`), y las funciones de reporte comparan
contra `p_area` o hacen `left join`, así que los nulos no ensucian.

**Caso 5, `body.area` distinta de la asignada → se ignora, gana el dispositivo.**
Es lo que pide el firmware (`.ino:23-27`). Pero un nodo que dice pertenecer a un
área distinta de la que tiene asignada es un síntoma —alguien lo mudó
físicamente y no lo reasignó en el panel, o al revés—, así que la discrepancia
**no se silencia**:

- Se registra una advertencia en el log del servidor.
- **La respuesta ya la delata sin cambios de contrato:** el campo `area` de la
  respuesta 200 devuelve `area.codigo` **resuelto** (`route.ts:213`), no el que
  mandó el nodo. Quien mire con `curl` o desde el simulador ve que le contestan
  un código distinto del que envió. Ese canal de diagnóstico ya existe y se
  conserva.

Lo que **no** hago: crear un llamado por la discrepancia. Agregaría un motivo al
catálogo cerrado (`lib/catalogos.ts:137-149`) cuya clave de deduplicación es el
texto (`lib/alertas.ts:141`), y ensuciaría la bandeja operativa con un problema
de configuración, no de campo. Queda como **pregunta abierta A-2**: si la
discrepancia merece superficie propia en `/dispositivos`.

### 8.5 Lo que esta decisión **no** arregla

`alarma` sigue siendo `hayEmergenciaAbierta(area.id)`, o sea **por área, no por
dispositivo** (`lib/alertas.ts:194-203`). El riesgo R8 sigue en pie: hoy las
ocho áreas tienen emergencias abiertas, así que todos los nodos reciben
`alarma: true` de forma permanente, en buena medida por datos sembrados.

No lo cambio acá porque cambiaría cuándo suena una sirena física, y eso es una
decisión operativa, no arquitectónica. Lo que sí hace este diseño es **volverlo
arreglable**: con `dispositivos` y `lecturas.dispositivo_id` existiendo, una
alarma por dispositivo pasa a ser expresable. Queda como **pregunta abierta
A-3**, y R8 sigue abierto hasta que se resuelva.

---

## 9. Aislamiento del simulador

### 9.1 El requisito duro

> Un simulador **nunca** puede escribir lecturas bajo el código de un
> dispositivo cuya naturaleza sea física.

### 9.2 Por qué mover la página a `/diagnostico` no alcanza

Miro el código real. `simularLectura()`
(`app/(panel)/dispositivos/acciones.ts:42-116`) hace un `fetch` HTTP a
`/api/ingest` con la clave global y un `dispositivo` que le llega por parámetro
(`:53-54`). Y `gestor.tsx:98` lo llena así:

```tsx
        dispositivo: nodoDe(simulacion.area),
```

con `nodoDe(codigo) => `NODO-${codigo}-01`` (`gestor.tsx:39-42`). O sea: **elegir
el área INV-N en el desplegable produce literalmente `NODO-INV-N-01`**, el
código del nodo físico. Ese es el mecanismo exacto de R1, y está a la vista en
`gestor.tsx:234`, donde el campo se muestra en pantalla.

Mover ese archivo a `/diagnostico` cambia la URL y nada más. La Server Action
seguiría pudiendo postear cualquier cadena como `dispositivo`, y `/api/ingest`
seguiría aceptándola sin validar (`route.ts:56-58`). **La ubicación de la página
no es un control de seguridad.**

### 9.3 La decisión: naturaleza, y la garantía viene de la credencial

Elijo **(b) marcar por naturaleza**, con el refuerzo que lo vuelve una garantía
en vez de una convención: **la identidad la determina la credencial, no el
cuerpo** (decisión 5.2, camino B).

De ahí sale la propiedad fuerte:

> Una credencial pertenece a **exactamente un** dispositivo
> (`dispositivo_credenciales.dispositivo_id` es `NOT NULL` y escalar). El
> simulador se autentica con la credencial de un dispositivo `SIMULADO`. Por lo
> tanto la lectura se atribuye a ese dispositivo y **a ningún otro**. El campo
> `body.dispositivo` ya no decide nada.
>
> **El requisito no se cumple por una validación que alguien podría olvidar
> escribir: se cumple porque no existe el camino.**

Concretamente:

- Se crean dispositivos `SIMULADO` propios —por ejemplo `SIM-INV-N`,
  `SIM-HID-1`— con `naturaleza = 'SIMULADO'`, y con área asignada para que la
  demo siga siendo realista.
- Se les emite una credencial `sha256-v1`, cuyo secreto vive en una variable de
  entorno nueva (`SIMULADOR_CLAVE`) en lugar de reusar `DEVICE_KEY`.
- `simularLectura()` manda **esa** clave, no la global. Eso además desacopla el
  simulador del apagado del fallback (decisión 6.3): puede seguir funcionando
  después de que `DEVICE_KEY` deje de existir.
- `gestor.tsx` deja de derivar el nombre del área y pasa a **elegir entre los
  dispositivos `SIMULADO` registrados**. `nodoDe()` se elimina.

### 9.4 Dos reglas que acompañan

**Inmutabilidad de la naturaleza.** Un dispositivo no puede pasar de `SIMULADO`
a `FISICO` ni al revés: eso blanquearía historia simulada como real, que es
justo lo que estamos arreglando. Se establece **a nivel de aplicación**:
`naturaleza` se fija al crear y **nunca se incluye en el payload de
actualización** de la Server Action correspondiente. Un trigger `before update`
sería un control más fuerte, pero `00-auditoria.md` §4.8 no pudo verificar el
estado de los triggers en esta base, así que lo dejo como refuerzo a evaluar y
no como parte del diseño. Que la garantía sea de aplicación queda dicho, no
disimulado.

**Los simulados no entran en la vigilancia.** `revisarNodosCaidos()` pasa a
considerar únicamente dispositivos con `naturaleza = 'FISICO'` **y**
`activo = true`. Un simulador que deja de simular no es una emergencia. Como
efecto colateral bienvenido, esto retira de la vigilancia a los ocho fantasmas
`ESP32-*`, que se van a registrar como `SIMULADO` e `inactivo` porque eso es
literalmente lo que son: ficción sembrada por `sql/02_datos.sql:202`.

### 9.5 Sobre la ubicación de la página

Recomiendo **mantener `/dispositivos`** y partirla en dos secciones: el
inventario de la flota arriba y el simulador abajo, en un bloque rotulado que
liste **solo** dispositivos `SIMULADO`. Razones: `gestor.tsx` ya tiene esa forma
(lista de nodos en `:146-149` y formulario de simulación en `:209` y
siguientes), la página ya es exclusiva de ADMINISTRADOR
(`dispositivos/page.tsx:15`), y partirla en dos rutas obligaría a duplicar la
carga de áreas y dispositivos.

Lo digo con todas las letras: esto es una decisión de **interfaz**, no de
seguridad. El aislamiento lo da §9.3. Mover la página sería aceptable; no
mover la naturaleza a la credencial, no.

---

## 10. Roles: matriz objetivo

El detalle ruta por ruta y acción por acción está en `13-matriz-permisos.md`.
Acá va la decisión de fondo y su justificación.

### 10.1 El punto de partida

`00-auditoria.md` §7: `/dispositivos` exige `exigirAdmin()`
(`dispositivos/page.tsx:15`) y no figura en `NAV_EMPLEADO`
(`layout.tsx:27-32`). Un EMPLEADO no la ve ni entrando a mano: recibe 403 real.

### 10.2 La decisión: **no** se crea una sección nueva para EMPLEADO

`/dispositivos` sigue siendo exclusiva de ADMINISTRADOR, y todas las Server
Actions nuevas —alta y edición de dispositivos, asignación de área, emisión y
revocación de credenciales, simulación— exigen `exigirAdmin()`.

Razones:

1. **Todo lo que hay ahí es administración.** Registrar hardware, asignar áreas
   y emitir secretos es el mismo tipo de tarea que gestionar `/areas`,
   `/empleados` y `/usuarios`, que ya son admin (`00-auditoria.md` §7.1). No
   inventa un criterio nuevo: aplica el que ya rige.
2. **Los secretos no se muestran a quien no los administra.** Aunque la
   credencial completa solo se vea una vez al crearla, la pantalla igual expone
   prefijos, estados y fechas de uso: es material de auditoría.

### 10.3 Pero la necesidad del EMPLEADO es real, y se atiende donde ya está parado

Un empleado en el campo necesita saber **una** cosa: *"¿el sensor de mi área
está vivo, o la temperatura que veo es vieja?"*. Eso no requiere una sección de
dispositivos; requiere que el dato aparezca donde ya mira.

Hoy lo tiene, pero mal: el tablero marca "Sensor sin reportar" recién a los **30
minutos** (`app/(panel)/page.tsx:17`, `MINUTOS_LECTURA_VIGENTE = 30`), mientras
la vigilancia usa **90 segundos** (`lib/alertas.ts:18`). **Dos umbrales
distintos para la misma pregunta**, en el mismo sistema — es la contradicción
que ya señalé en `03-riesgos.md` R5.

**Propuesta:** el tablero —que EMPLEADO ya ve, sin cambiar ningún permiso—
muestra, por área, el estado del dispositivo asignado usando **el mismo umbral
de 90 segundos** que usa la vigilancia.

Por qué esto es mejor que darle `/dispositivos` en modo lectura:

- **No agrega superficie de permisos.** Cero rutas nuevas, cero cambios en
  `proxy.ts`, cero `exigirAdmin`/`exigirSesion` nuevos, cero caminos de 403
  nuevos. La matriz de `00-auditoria.md` §7 se conserva entera.
- **Sale gratis por la decisión 1.6.** Con `dispositivos.ultimo_contacto_en`
  materializada, el tablero obtiene la frescura leyendo una tabla de una decena
  de filas, sin tocar `lecturas`. Si la telemetría fuera derivada, esta mejora
  costaría una consulta más por área.
- **Arregla una inconsistencia en lugar de agregar un permiso.** Después del
  cambio hay **un solo** umbral de "sin señal" en todo el sistema.
- **Respeta la consigna de no inventar permisos.** El EMPLEADO no gana acceso a
  nada nuevo: ve mejor lo que ya veía.

### 10.4 Un permiso que conviene **restringir**, no ampliar

`/api/vigilancia` acepta hoy **cualquier sesión válida**, incluida la de un
EMPLEADO (`app/api/vigilancia/route.ts:15`, `return (await getSesion()) !== null`),
y su efecto es **escribir**: fuerza la barrida y crea llamados de EMERGENCIA
(`:27` → `lib/alertas.ts:305-322`).

Eso desentona con el resto de la matriz, donde todo lo que escribe fuera de
llamados y avisos es admin.

**Verifiqué que restringirla no rompe nada:** un `grep` de `api/vigilancia`
sobre `app/`, `lib/`, `public/` y `proxy.ts` devuelve **solo** el propio archivo
de la ruta, un comentario en `lib/alertas.ts:270` y la lista de rutas públicas
de `proxy.ts:12`. **Ningún cliente la llama.** El tablero invoca
`revisarNodosCaidos()` en proceso (`app/(panel)/page.tsx:159`), sin pasar por
HTTP.

**Propuesta:** que `/api/vigilancia` acepte solo credencial de dispositivo o
sesión de ADMINISTRADOR. Es *quitar* un permiso que nadie ejerce, alineándolo
con el patrón vigente. No es un permiso nuevo.

---

## 11. Resumen de decisiones

| # | Decisión | Alternativa descartada | Motivo principal |
|---|---|---|---|
| 1 | Tabla `dispositivos` con `codigo` texto acotado, `naturaleza`, 5 capacidades booleanas y `ultimo_contacto_en` **materializada** | Telemetría derivada de `lecturas`; capacidades en `jsonb`; tabla aparte para simulados | El barrido actual lee 8 640 filas por nodo por día **cada 10 s** con `/dispositivos` abierto |
| 2 | **(b)** Solo `area_id` vigente; el pasado ya está congelado en `lecturas.area_id` y `llamados.area_id` | **(a)** `dispositivo_asignaciones` con desde/hasta | Las 5 funciones `reporte_*` ya agrupan por la columna congelada; (a) responde una pregunta que el sistema no hace, y se puede agregar después de forma aditiva |
| 3 | 0-o-1 área por dispositivo; N dispositivos por área | Dispositivo multi-área | Un sensor mide un lugar. Se documenta la deuda C-1 del antirrebote |
| 4 | `lecturas.dispositivo_id` nullable + FK, **conservando** `lecturas.dispositivo` | Renombrar o eliminar la columna de texto | 5 consumidores verificados, y `llamados.creado_por` es texto libre sin FK |
| 5 | SHA-256 sobre secreto de 256 bits generado por el servidor, con búsqueda directa por hash; `bcrypt-v1` solo para el secreto heredado | bcrypt para todo; bcrypt de costo reducido; texto plano | Bcrypt protege contraseñas humanas de baja entropía; acá no hay nada que brutefor­cear, y su sal impide la búsqueda por hash |
| 6 | Sembrar la credencial legada con el hash de la clave ya grabada (`.ino:57`); fallback global tras `INGEST_PERMITE_CLAVE_GLOBAL`, **default apagado** | Default encendido | Fallar cerrado acá es **observable**: 401 → failsafe a 45 s → "Sensor sin señal" a 90 s |
| 7 | 4 columnas `boolean` en `areas` con defaults `true/false/false/true` | `automatizacion jsonb` | El **default es el backfill**: reproduce la expresión de hoy sin ejecutar ningún `UPDATE` |
| 8 | Cascada credencial → dispositivo → área; **200 + `rele:false`** para apagar ya; nunca 4xx para eso | 4xx ante dispositivo mal configurado | Un 4xx tarda 45 s en apagar el relé y deja el botón sin confirmar |
| 9 | **(b)** naturaleza, con la garantía en la credencial | **(a)** mover a `/diagnostico` | Mover la página no impide postear cualquier `dispositivo`; la credencial sí |
| 10 | `/dispositivos` sigue siendo admin; el EMPLEADO gana frescura del sensor **en el tablero**, con el umbral de 90 s | Sección nueva o `/dispositivos` en modo lectura | Cero superficie de permisos nueva; unifica dos umbrales que hoy se contradicen |

## 12. Invariantes y preguntas abiertas

**Invariantes** (reglas que ninguna etapa posterior debe romper):

- **R-1** — `reporte_*` no se modifican y nunca resuelven el área vía
  `dispositivos.area_id`. El área de un hecho es la grabada en la fila del hecho.
- **R-2** — `lecturas.dispositivo` es lo que el nodo **dijo ser**;
  `lecturas.dispositivo_id` es a quién lo **atribuyó** el servidor. Se escriben
  las dos y no se sincronizan retroactivamente.
- **R-3** — Los flags de automatización gobiernan solo la actuación. Desmarcar
  un flag apaga una bomba, nunca una alarma.
- **R-4** — `rele` y `alarma` no cambian de nombre ni de tipo en la respuesta
  200. Ver `12-contrato-ingest-objetivo.md`.

**Deudas con disparador:**

- **C-1** — Al instalar el segundo nodo físico en un área que ya tiene uno, la
  clave del antirrebote de `Sensor sin señal` debe incluir `dispositivo_id`.

**Preguntas abiertas** (requieren decisión operativa, no arquitectónica):

- **A-1** — ¿Un área dada de baja debe dejar de accionar el relé? Hoy acciona;
  este diseño lo preserva.
- **A-2** — ¿La discrepancia entre `body.area` y el área asignada merece
  superficie propia en `/dispositivos`, además del log?
- **A-3** — ¿`alarma` debe pasar de ser por área a ser por dispositivo? Hasta
  resolverlo, **R8 sigue abierto**.
