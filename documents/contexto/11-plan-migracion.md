# 11 — Plan de migración

Compañero de `10-arquitectura.md`. Define el **orden exacto**, los backfills y
qué queda compatible en cada paso.

## Reglas que gobiernan todo el plan

1. **Todo SQL es una migración nueva, aditiva e idempotente.** Ningún paso
   modifica `sql/01`…`sql/05`. Los archivos nuevos se numeran a continuación:
   `sql/06_…`, `sql/07_…`, `sql/08_…`, `sql/09_…`.
2. **`sql/01_esquema.sql` y `sql/02_datos.sql` NO se ejecutan nunca.** Son
   destructivos (`03-riesgos.md` R3): borrarían 5 683 lecturas, 430 llamados y
   los umbrales editados a mano que la base tiene hoy y el archivo no.
3. **La base va siempre antes que el código.** Cada migración se corre en el
   editor SQL de Supabase y se verifica **antes** de desplegar el código que la
   usa. Es lo que permite que `INGEST_PERMITE_CLAVE_GLOBAL` tenga default
   cerrado (`10-arquitectura.md` §6.2).
4. **En ningún paso el nodo `NODO-INV-N-01` deja de funcionar.** Cada paso
   declara por qué. Si un paso no puede garantizarlo, no está en este plan.
5. **Ningún paso cambia `rele` ni `alarma` de nombre o de tipo.** Ver
   `12-contrato-ingest-objetivo.md`.

## Resumen del orden

| Paso | Qué | Toca base | Toca código | Toca entorno |
|---|---|---|---|---|
| 0 | Verificaciones previas (solo lectura) | lee | no | no |
| 1 | `sql/06` — estructura de dispositivos y credenciales | **sí** | no | no |
| 2 | `sql/07` — semilla de la flota y backfills | **sí** | no | no |
| 3 | `sql/08` — automatización en `areas` | **sí** | no | no |
| 4 | `sql/09` — credenciales (legada + simulador) | **sí** | no | **sí** |
| 5 | Deploy A — la ingesta **escribe** identidad y telemetría | no | **sí** | no |
| 6 | Deploy B — la lectura pasa a `dispositivos` | no | **sí** | no |
| 7 | Deploy C — cascada de autenticación y automatización | no | **sí** | no |
| 8 | Ventana de observación (compuerta medible) | lee | no | no |
| 9 | Apagado del fallback global | no | **sí** | **sí** |
| 10 | Rotación de la credencial legada (requiere acceso físico) | **sí** | **sí** | no |
| 11 | Endurecimiento opcional | **sí** | no | no |

---

## Paso 0 — Verificaciones previas

**No modifica nada.** Cierra los huecos que `00-auditoria.md` §4.8 dejó marcados
como NO VERIFICADOS y que tocan este plan.

En el editor SQL de Supabase, solo lectura:

1. **Confirmar que `areas.codigo` tiene `unique`.** Consultar las restricciones
   de la tabla `areas`. Si no existiera, no bloquea nada de este plan
   (`10-arquitectura.md` §0), pero conviene saberlo antes de tocar la ingesta.
2. **Confirmar los índices declarados en `sql/01`, `sql/04` y `sql/05`.**
   Listar los índices de `lecturas`, `llamados`, `empleados` y
   `suscripciones_push`. Si alguno falta, los pasos 1 y 2 lo crean con
   `if not exists` de todos modos.
3. **Confirmar si existen triggers.** Si la base **sí** tiene triggers, se abre
   la opción de reforzar la inmutabilidad de `dispositivos.naturaleza` con uno
   (`10-arquitectura.md` §9.4). Si no, la regla queda a nivel de aplicación,
   como está diseñada.
4. **Reconfirmar el mapeo dispositivo → área.** Agrupar `lecturas` por
   `(dispositivo, area_id)` y verificar que ningún dispositivo aparezca con más
   de un área. Al 2026-09-09 ninguno lo hace, y de eso depende que el backfill
   del paso 2 sea inequívoco. Si entre hoy y la ejecución alguien simulara el
   mismo código en otra área, ese dispositivo pasaría a necesitar decisión
   manual.

**Compatibilidad:** total. No se escribe nada.

---

## Paso 1 — `sql/06_dispositivos.sql`: estructura

**Crea, sin poblar:**

- Tabla `dispositivos` (`create table if not exists`) con las columnas de
  `10-arquitectura.md` §1.1: `id`, `codigo` (unique, con `check` de higiene),
  `nombre`, `modelo`, `area_id` (FK a `areas.id`, nullable), `activo`,
  `naturaleza` (`check in ('FISICO','SIMULADO')`), los cinco booleanos de
  capacidades, `ultimo_contacto_en`, `observaciones`, `creado_en`.
- Tabla `dispositivo_credenciales` (`create table if not exists`) con las
  columnas de §5.1: FK `on delete cascade` a `dispositivos.id`, `algoritmo`
  (`check in ('sha256-v1','bcrypt-v1')`), `secreto_hash`, `prefijo`, `estado`
  (`check in ('ACTIVA','ROTADA','REVOCADA')`), `origen`, `expira_en`,
  `usada_en`, y las columnas de auditoría.
- Columna **`lecturas.dispositivo_id`** (`alter table … add column if not
  exists`), `int NULL references dispositivos (id)`. Nace **nullable**, y eso es
  deliberado: es el instrumento de medición del paso 8.
- Índices (`create index if not exists`): `dispositivos (area_id)`,
  `dispositivos (ultimo_contacto_en desc)`,
  `dispositivo_credenciales (dispositivo_id)`,
  índice **único parcial** sobre `dispositivo_credenciales (secreto_hash)
  where algoritmo = 'sha256-v1'`, y
  `lecturas (dispositivo_id, tomada_en desc)`.

**No** crea ninguna fila. **No** toca `lecturas.dispositivo`.

**Qué queda compatible:** absolutamente todo. Ninguna línea de `app/` ni de
`lib/` conoce estas tablas todavía. `/api/ingest` sigue siendo el de
`01-contrato-ingest.md`, palabra por palabra. `yarn build` no cambia.

**Rollback:** `drop table dispositivo_credenciales`, `drop table dispositivos`,
`alter table lecturas drop column dispositivo_id`. Sin pérdida de datos, porque
todavía no hay ninguno.

---

## Paso 2 — `sql/07_dispositivos_datos.sql`: semilla y backfills

### 2.1 Semilla de la flota: 13 dispositivos

Los 13 códigos salen del inventario verificado (`00-auditoria.md` §5), no de una
lista inventada. **Un `insert … on conflict (codigo) do nothing`**, para que el
archivo sea idempotente.

| `codigo` | `naturaleza` | `activo` | `area_id` | Por qué |
|---|---|---|---|---|
| `NODO-INV-N-01` | **FISICO** | **true** | 1 (INV-N) | Es el hardware. `codigo` **idéntico** a `.ino:60`. `modelo = 'ESP32-S3-Zero'` (`.ino:6`) |
| `ESP32-INV-N` | SIMULADO | **false** | 1 | Sembrado por `sql/02_datos.sql:202`. Ficción, y última lectura del 2026-09-01 |
| `ESP32-INV-S` | SIMULADO | false | 2 | ídem |
| `ESP32-INV-G` | SIMULADO | false | 3 | ídem |
| `ESP32-HID-1` | SIMULADO | false | 4 | ídem |
| `ESP32-COM-1` | SIMULADO | false | 5 | ídem |
| `ESP32-VIV-1` | SIMULADO | false | 6 | ídem |
| `ESP32-RIE-1` | SIMULADO | false | 7 | ídem |
| `ESP32-DEP-1` | SIMULADO | false | 8 | ídem |
| `NODO-INV-S-01` | SIMULADO | false | 2 | 7 lecturas del simulador, 2026-09-01 |
| `NODO-VIV-1-01` | SIMULADO | false | 6 | 9 lecturas del simulador |
| `NODO-DEP-1-01` | SIMULADO | false | 8 | 2 lecturas del simulador |
| `NODO-COM-1-01` | SIMULADO | false | 5 | 1 lectura del simulador |

Los `area_id` no se adivinan: son los que esos identificadores **efectivamente
escribieron**, verificado en el paso 0.4 y en `10-arquitectura.md` §0.

Marcarlos `activo = false` los deja fuera de la vigilancia desde el primer
momento y evita que el paso 6 genere doce llamados de "Sensor sin señal" por
fantasmas históricos.

En `observaciones` de `NODO-INV-N-01` se anota la fecha de corte y la leyenda de
que **las lecturas anteriores a la migración tienen identidad ambigua**
(`10-arquitectura.md` §4.4): mezclan hardware real y simulaciones, y no hay
forma de separarlas.

### 2.2 Semilla de los dispositivos del simulador

Se crean los dispositivos `SIMULADO` **nuevos**, activos, que va a usar el
simulador de ahora en más — uno por área en la que tenga sentido demostrar; por
ejemplo `SIM-INV-N`, `SIM-HID-1`. Códigos **deliberadamente distintos** del
patrón `NODO-…-01`, para que no se puedan confundir a simple vista con hardware.

### 2.3 Backfill de `lecturas.dispositivo_id`

En prosa:

> *Para cada fila de `lecturas` cuyo `dispositivo_id` todavía sea nulo, buscar
> en `dispositivos` la fila cuyo `codigo` sea exactamente igual al texto de
> `lecturas.dispositivo`, y guardar su `id`.*

Es idempotente por la condición `dispositivo_id is null`: correrlo dos veces no
cambia nada la segunda.

Cobertura esperada: **las 5 683 filas**. Verificado en el paso 0 que no hay
`dispositivo` nulo y que los 13 valores distintos existen todos como
dispositivos. Al terminar, contar las filas que hayan quedado con
`dispositivo_id` nulo: **tiene que dar cero**. Si no da cero, apareció un
identificador nuevo entre la auditoría y la ejecución, y hay que registrarlo
antes de seguir.

**`lecturas.dispositivo` no se toca.** Invariante R-2 (`10-arquitectura.md`
§4.3): el texto es lo que el nodo dijo ser, la FK es a quién lo atribuyó el
servidor.

### 2.4 Backfill de `dispositivos.ultimo_contacto_en`

En prosa:

> *Para cada dispositivo, poner `ultimo_contacto_en` igual al `tomada_en` más
> alto de las lecturas que le pertenecen; dejarlo nulo si no tiene ninguna.*

La misma sentencia sirve después como **reparación** si la columna materializada
quedara desfasada (`10-arquitectura.md` §1.6). Vale la pena guardarla en el
archivo con un comentario que lo diga.

**Qué queda compatible:** todo. Sigue sin haber código que lea estas tablas.
`estadoDeNodos()` sigue barriendo `lecturas` como siempre.

**Rollback:** borrar las filas de `dispositivos` y poner
`lecturas.dispositivo_id` en nulo. Ningún dato original se perdió: los backfills
solo **agregan** información derivada.

---

## Paso 3 — `sql/08_automatizacion.sql`: los cuatro flags en `areas`

`alter table areas add column if not exists`, cuatro veces, con **estos**
defaults y `not null`:

| Columna | Default |
|---|---|
| `auto_temp_alta` | **`true`** |
| `auto_temp_baja` | **`false`** |
| `auto_hum_alta` | **`false`** |
| `auto_hum_baja` | **`true`** |

**El backfill es el default.** No hay ninguna sentencia `UPDATE` en este
archivo, y no debe agregarse: al declarar las columnas `not null default`,
Postgres completa las ocho áreas existentes con esos valores, y la expresión
objetivo se reduce a la expresión de hoy
(`10-arquitectura.md` §7.3, demostrado término por término).

Verificación después de correrlo: consultar las ocho áreas y comprobar que las
ocho tienen exactamente `true, false, false, true`. Si alguna tuviera otra
combinación, alguien agregó un `update` que no corresponde.

**Qué queda compatible:** todo. `/api/ingest` sigue calculando `rele` con la
expresión cableada de `route.ts:200-203` y **ni siquiera lee** las columnas
nuevas. `lib/tipos.ts` todavía no las declara, y el `select` del área
(`route.ts:106-108`) las omite. El comportamiento es idéntico.

**Rollback:** `alter table areas drop column …` las cuatro. Nada depende de
ellas todavía.

---

## Paso 4 — `sql/09_credenciales.sql`: la credencial legada y la del simulador

Este es el paso que hace posible que **el nodo no se reflashee**.

### 4.1 Generar los hashes fuera de la base

Con un script local, al estilo del que ya existe (`scripts/hash.js`, que usa
bcryptjs con 10 rondas):

- **Credencial legada:** bcrypt de la clave que el firmware **ya tiene**
  (`.ino:57`), 10 rondas.
- **Credencial del simulador:** generar un secreto nuevo de 32 bytes aleatorios
  con el prefijo `pab_`, y calcular su SHA-256.

**Advertencia operativa:** el archivo de migración lleva **solo los hashes**. El
secreto del simulador se copia a la variable de entorno y no se guarda en el
repositorio. La clave legada ya está en el repositorio desde antes
(`03-riesgos.md` R15), pero **no se agrega una copia nueva**.

### 4.2 Insertar las credenciales

- Para `NODO-INV-N-01`: una fila con `algoritmo = 'bcrypt-v1'`,
  `origen = 'LEGADO'`, `estado = 'ACTIVA'`, **`prefijo = NULL`** (guardar los
  primeros 8 caracteres de un secreto de 7 sería publicarlo entero,
  `10-arquitectura.md` §5.3) y un `expira_en` con **fecha límite explícita**,
  para que la deuda tenga vencimiento.
- Para cada dispositivo `SIM-…`: una fila con `algoritmo = 'sha256-v1'`,
  `origen = 'GENERADA'`, `estado = 'ACTIVA'`, `prefijo` con los primeros 8
  caracteres del secreto.

Idempotencia: `on conflict do nothing` sobre el índice único parcial de
`secreto_hash`, más una guarda para no duplicar la fila `bcrypt-v1` del
dispositivo legado.

### 4.3 Variables de entorno

En `.env.local` y en Vercel, **antes** del paso 5:

| Variable | Valor | Estado |
|---|---|---|
| `SIMULADOR_CLAVE` | el secreto del simulador, en claro | **nueva** |
| `INGEST_PERMITE_CLAVE_GLOBAL` | `"1"` | **nueva**, temporal |
| `DEVICE_KEY` | sin cambios | existente, se retira en el paso 9 |

`INGEST_PERMITE_CLAVE_GLOBAL` se pone explícitamente en `"1"` **ahora**, aunque
todavía no haya código que la lea. Así, cuando el paso 7 despliegue el código
que sí la lee, el fallback ya está encendido y no hay una ventana en la que el
default cerrado deje al nodo afuera.

**Qué queda compatible:** todo. Las credenciales están en la base y nadie las
consulta. El simulador sigue usando `DEVICE_KEY`.

**Rollback:** borrar las filas de `dispositivo_credenciales` y quitar las
variables.

---

## Paso 5 — Deploy A: la ingesta **escribe** identidad y telemetría

Primer cambio de código. **Solo agrega escrituras. No cambia ninguna decisión ni
ninguna respuesta.**

En `/api/ingest`, después de resolver el área como hasta ahora:

1. Buscar en `dispositivos` la fila cuyo `codigo` sea igual a
   `body.dispositivo`. Si existe, guardar su `id` en el `insert` de `lecturas`
   como `dispositivo_id`. Si no existe, dejarlo nulo — que es exactamente lo que
   pasa hoy con las filas nuevas.
2. Dentro de **`after()`**, actualizar `dispositivos.ultimo_contacto_en` con el
   momento de la lectura.

**La autenticación no cambia** (sigue el `DEVICE_KEY` global). **El área no
cambia** (sigue saliendo de `body.area`). **`rele` y `alarma` no cambian**
(sigue la expresión cableada de `route.ts:200-203`).

Por qué `after()` y no en línea: el firmware corta a los 6 segundos
(`.ino:102`, `:527-528`) y ya hay precedente en el repositorio para esto
(`lib/avisos.ts:93-97`). La telemetría no puede competir con el presupuesto de
la respuesta.

**Qué queda compatible:**

- La respuesta 200 es **byte por byte la misma**. El firmware no percibe nada.
- Si el `after()` falla, la lectura ya se guardó y la respuesta ya salió.
- Si `body.dispositivo` no coincide con ningún `codigo`, `dispositivo_id` queda
  nulo y todo sigue igual que hoy.

**Por qué este paso va antes del 6:** el paso 6 hace que la vigilancia lea
`ultimo_contacto_en`. Si la columna no se estuviera actualizando en vivo,
quedaría congelada en el valor del backfill y **el sistema declararía caídos a
todos los nodos**. Este paso enciende la fuente antes de que alguien la consuma.

**Rollback:** redesplegar el commit anterior. Las columnas quedan pobladas pero
nadie las lee.

---

## Paso 6 — Deploy B: la lectura pasa a `dispositivos`

Ahora sí se cosecha la mejora de costo (`10-arquitectura.md` §1.6).

1. **`estadoDeNodos()`** deja de barrer 24 horas de `lecturas` y pasa a leer
   `dispositivos`: una tabla de una decena de filas, con `ultimo_contacto_en` ya
   calculado. Se conserva la forma del tipo `NodoVigilado`
   (`lib/alertas.ts:205-210`) para no tocar a sus consumidores.
2. **`revisarNodosCaidos()`** pasa a considerar **solo** dispositivos con
   `naturaleza = 'FISICO'` **y** `activo = true` (`10-arquitectura.md` §9.4).
3. **`/dispositivos`** muestra la flota real: código, nombre, modelo, área,
   naturaleza, estado, último contacto, credenciales. Sigue siendo exclusiva de
   ADMINISTRADOR (`13-matriz-permisos.md`).
4. **El tablero** muestra la frescura del sensor por área con el **umbral de 90
   segundos**, el mismo de la vigilancia, reemplazando el de 30 minutos de
   `app/(panel)/page.tsx:17` (`10-arquitectura.md` §10.3).

**Qué queda compatible:**

- `/api/ingest` **no se toca en este paso**. El nodo no percibe nada.
- El punto 2 tiene un efecto visible y buscado: los doce dispositivos históricos
  quedan fuera del barrido y **dejan de ser candidatos a "Sensor sin señal"**.
  Hoy tampoco lo son, por otro motivo —la ventana de 24 horas los excluye
  (`03-riesgos.md` R10)—, así que en la práctica no cambia lo que se ve. La
  diferencia es que ahora es una regla explícita y no un efecto colateral.
- El punto 4 **cambia lo que ve el usuario**: un sensor que estuvo callado 5
  minutos ahora se marca, cuando antes había que esperar 30. Es el arreglo de la
  contradicción de R5, y hay que avisarlo a quien opera.

**Rollback:** redesplegar el commit anterior. `estadoDeNodos()` vuelve a barrer
`lecturas`, que nunca dejaron de escribirse.

---

## Paso 7 — Deploy C: cascada de autenticación y automatización

El paso central. Tres cambios que **tienen que ir juntos** porque comparten el
mismo handler.

### 7.1 Cascada de autenticación e identidad

Orden exacto en `/api/ingest` (`10-arquitectura.md` §5.2 y §8.1):

1. Leer el header `x-device-key`. Si falta → **401**.
2. **Camino rápido:** calcular SHA-256 de la clave y buscar la credencial por
   `secreto_hash` con `algoritmo = 'sha256-v1'`. Una consulta indexada.
3. **Camino legado:** si el rápido no encontró nada, leer el cuerpo (con tope de
   tamaño), tomar `body.dispositivo`, buscar ese dispositivo y verificar con
   bcrypt **solo si tiene una credencial `bcrypt-v1`**. Es el camino que usa
   `NODO-INV-N-01`, y es el único dispositivo que lo usa.
4. **Fallback global:** si ninguno de los dos resolvió y
   `INGEST_PERMITE_CLAVE_GLOBAL === "1"`, comparar contra `DEVICE_KEY`. Si
   coincide, **no hay dispositivo resuelto** y la request cae en la conducta de
   hoy: área por `body.area`, lectura con `dispositivo_id` nulo.
5. Si nada resolvió → **401**.

En todos los casos, la credencial que verificó tiene que estar `ACTIVA`, o
`ROTADA` con `expira_en` en el futuro; `REVOCADA` no verifica jamás
(`10-arquitectura.md` §5.5).

**El orden 2 → 3 → 4 no es negociable.** Durante la transición, el valor
grabado en `.ino:57` es simultáneamente la credencial legada y el `DEVICE_KEY` global. Si
el fallback se probara primero, el nodo seguiría entrando como anónimo y la
migración no habría servido de nada (`10-arquitectura.md` §6.1).

Con dispositivo resuelto: el área sale de `dispositivos.area_id` y **`body.area`
se ignora**, como pide el propio firmware (`.ino:23-27`). Los casos borde
—dispositivo inactivo, sin área, área inactiva, `body.area` discrepante— siguen
la tabla de `10-arquitectura.md` §8.3.

En `after()`: `dispositivos.ultimo_contacto_en` y
`dispositivo_credenciales.usada_en`.

### 7.2 Automatización

`rele` pasa a calcularse con los cuatro flags
(`10-arquitectura.md` §7.2). Como las ocho áreas tienen los defaults del paso 3,
**el resultado es idéntico al de hoy en las ocho**. Los flags se agregan al
`select` del área (`route.ts:106-108`) y al tipo `Area` de `lib/tipos.ts:10-21`.

`evaluarDesvios()` **no se toca**: invariante R-3.

### 7.3 Simulador

`simularLectura()` deja de usar `process.env.DEVICE_KEY`
(`dispositivos/acciones.ts:47`) y pasa a mandar `SIMULADOR_CLAVE`. `gestor.tsx`
elimina `nodoDe()` (`:39-42`) y su uso en `:98` y `:234`, y pasa a **elegir
entre los dispositivos `SIMULADO` registrados**.

Desde acá, el requisito duro se cumple **por construcción**: la credencial
pertenece a un solo dispositivo, así que el simulador no puede escribir bajo un
código físico aunque lo nombre en el cuerpo (`10-arquitectura.md` §9.3).

### 7.4 Verificación de que el nodo sigue vivo — el chequeo que importa

Después de desplegar, mirar `NODO-INV-N-01` y confirmar los cinco:

1. `dispositivos.ultimo_contacto_en` avanza (debería moverse cada 10 segundos).
2. Las lecturas nuevas tienen **`dispositivo_id` no nulo**.
3. `dispositivo_credenciales.usada_en` de la fila `bcrypt-v1` avanza — prueba de
   que entró por **su credencial** y no por el fallback.
4. `lecturas.area_id` de las filas nuevas sigue siendo **1** (INV-N).
5. En el monitor serie, el nodo sigue imprimiendo líneas con `rele=` y
   `alarma=`, sin `HTTP 401` ni `HTTP 404` (`.ino:633-649`).

Si el punto 3 no avanza pero el 2 sí, algo está entrando por el fallback: revisar
el orden de la cascada.

**Qué queda compatible:**

- **`NODO-INV-N-01` sigue funcionando sin reflashear.** Manda el mismo header
  con el mismo valor, y ahora resuelve a su propio dispositivo. Misma área,
  mismos umbrales, mismos defaults de automatización ⇒ mismo `rele`. Misma
  `hayEmergenciaAbierta(1)` ⇒ misma `alarma`.
- **La respuesta 200 conserva nombres y tipos.** Ver
  `12-contrato-ingest-objetivo.md`.
- El fallback global sigue encendido, así que cualquier cosa que todavía use
  `DEVICE_KEY` sigue entrando — degradado, pero entrando.

**Rollback:** redesplegar el commit anterior. La base queda con tablas y columnas
de más, que nadie lee. El nodo vuelve a autenticarse por la clave global, que
sigue siendo la misma cadena.

---

## Paso 8 — Ventana de observación: la compuerta medible

**No se toca nada.** Se mide.

La consulta, en prosa:

> *Contar las lecturas de las últimas 24 horas cuyo `dispositivo_id` sea nulo.*

- **Da cero, de forma sostenida durante al menos 48 horas** → nadie entra por el
  fallback global. Se puede apagar.
- **Da distinto de cero** → esas filas dicen, en `lecturas.dispositivo`, **qué**
  está entrando sin credencial propia. Se le crea dispositivo y credencial, y se
  vuelve a esperar.

Segunda comprobación, complementaria: que `usada_en` de la credencial legada de
`NODO-INV-N-01` esté fresca. Si `dispositivo_id` no es nulo **y** `usada_en`
avanza, el nodo está autenticándose por sí mismo.

Esta compuerta funciona gracias a que `dispositivo_id` nació nullable
(`10-arquitectura.md` §4.2): no es una concesión del esquema, es el instrumento.

---

## Paso 9 — Apagado del fallback global

**Precondición:** el paso 8 en cero sostenido. Y una dependencia que hay que
tener presente: **el simulador ya tiene que estar usando `SIMULADOR_CLAVE`**
(paso 7.3). Si se apaga el fallback antes, el simulador deja de funcionar
(`10-arquitectura.md` §6.3).

1. Quitar `INGEST_PERMITE_CLAVE_GLOBAL` de Vercel (o ponerla en `"0"`).
   Redesplegar.
2. Observar 24 horas. Si el nodo sigue reportando y `dispositivo_id` sigue sin
   nulos, el fallback no hacía falta.
3. Quitar del código la lectura de `DEVICE_KEY` en el camino de ingesta y el
   propio flag. Redesplegar.
4. Retirar `DEVICE_KEY` de las variables de entorno.
5. **Restringir `/api/vigilancia`**: pasa a aceptar solo credencial de
   dispositivo o sesión de ADMINISTRADOR, en lugar de cualquier sesión
   (`app/api/vigilancia/route.ts:12-16`). Verificado que **ningún cliente la
   llama** (`10-arquitectura.md` §10.4), así que restringirla no rompe nada.

**Qué se cierra acá:** el riesgo **R2** queda resuelto para `/api/ingest` y para
`/api/vigilancia`. Ya no existe una clave global que abra las dos rutas, y cada
lectura queda atribuida a un dispositivo concreto.

**Qué NO se cierra todavía:** la clave grabada en `.ino:57` sigue siendo válida, sigue
teniendo 7 caracteres y sigue estando en el repositorio desde el commit del
firmware. Eso se cierra en el paso 10.

**Rollback:** volver a poner la variable en `"1"` y redesplegar. Por eso los
puntos 3 y 4 van después de las 24 horas de observación del punto 2: mientras el
código todavía sepa leer el flag, el rollback es una variable de entorno; después
del punto 3, es un despliegue.

---

## Paso 10 — Rotación de la credencial legada (requiere acceso físico)

Único paso que necesita ir hasta el invernadero. Se hace en la primera ventana
de mantenimiento disponible, antes del `expira_en` fijado en el paso 4.

1. Emitir una credencial nueva `sha256-v1` para `NODO-INV-N-01` desde
   `/dispositivos`. El secreto se muestra **una sola vez**.
2. Marcar la credencial `bcrypt-v1` como **`ROTADA`**, con `expira_en` unos días
   adelante. Durante esa ventana **las dos verifican**, así que el nodo sigue
   funcionando con la vieja mientras se coordina la visita
   (`10-arquitectura.md` §5.5).
3. Reflashear el firmware cambiando **solo** `DEVICE_KEY` (`.ino:57`) por el
   secreto nuevo. Ninguna otra línea cambia: ni `SERVIDOR`, ni `DISPOSITIVO`, ni
   `AREA_COMPATIBILIDAD`.
4. Confirmar que `usada_en` de la credencial **nueva** avanza y la de la vieja
   se congela.
5. Marcar la vieja como **`REVOCADA`**, con motivo.
6. Quitar el soporte de `bcrypt-v1` del código de verificación y del `check` de
   la columna `algoritmo`. Desde acá solo existe el camino rápido.

**Qué se cierra acá:** el secreto de 7 caracteres deja de ser válido. Como sigue
en el historial de git, revocarlo es la única forma real de neutralizarlo —
borrar el archivo no alcanza (`03-riesgos.md` R15).

**Oportunidad, no obligación:** ya que se reflashea, es el momento de considerar
`INTERVALO_MS` (hoy 10 s contra un umbral de 90 s, R5) y la validación de TLS
(hoy `setInsecure()`, `.ino:523`). Ninguna de las dos es parte de este plan; se
anotan porque abrir el equipo dos veces cuesta el doble.

---

## Paso 11 — Endurecimiento opcional

Solo cuando el paso 9 lleve semanas estable:

- `lecturas.dispositivo_id` pasa a **`not null`**. Precondición: cero filas
  nulas. A partir de ahí, es imposible escribir una lectura sin identidad
  atribuida.
- Si el paso 0.3 confirmó que la base soporta triggers, evaluar un trigger
  `before update` sobre `dispositivos` que impida cambiar `naturaleza`
  (`10-arquitectura.md` §9.4), convirtiendo esa regla de aplicación en una
  garantía de motor.

---

## Compatibilidad, paso por paso, en una tabla

| Paso | ¿El nodo sigue funcionando? | ¿La respuesta 200 cambia? | ¿Cambia lo que ve el usuario? |
|---|---|---|---|
| 0 | sí, nada se toca | no | no |
| 1 | sí, nadie lee las tablas nuevas | no | no |
| 2 | sí, solo se agregan filas y backfills | no | no |
| 3 | sí, el código ignora las columnas nuevas | no | no |
| 4 | sí, nadie consulta las credenciales | no | no |
| 5 | sí, solo se agregan escrituras | **no** (byte por byte igual) | no |
| 6 | sí, `/api/ingest` no se toca | no | **sí**: umbral de sensor pasa de 30 min a 90 s |
| 7 | **sí, por la credencial legada, sin reflashear** | **no** (nombres y tipos intactos) | sí: `/dispositivos` muestra la flota real |
| 8 | sí, no se toca nada | no | no |
| 9 | sí, ya usa credencial propia desde el paso 7 | no | no |
| 10 | sí, ventana de gracia con dos credenciales válidas | no | no |
| 11 | sí | no | no |

## Qué NO hace este plan

Para que ninguna etapa posterior lo dé por hecho:

- **No arregla R8.** `alarma` sigue siendo por área. Las ocho áreas siguen
  teniendo emergencias abiertas y todos los nodos siguen recibiendo
  `alarma: true`. Es la pregunta abierta A-3.
- **No toca los datos sembrados.** Los 430 llamados y las 5 384 lecturas
  `ESP32-*` siguen ahí, ahora **etiquetados** como simulados. Limpiarlos es una
  decisión operativa aparte, y sería la primera vez que este plan borra algo.
- **No introduce retención de `lecturas`.** La tabla sigue creciendo 8 640 filas
  por nodo por día (R5). Lo que sí hace es que el barrido de vigilancia deje de
  depender de ese volumen.
- **No normaliza `llamados.creado_por`.** Sigue siendo texto libre con códigos
  de dispositivo, nombres de usuario y legajos mezclados
  (`10-arquitectura.md` §4.3).
- **No toca las funciones `reporte_*`.** Invariante R-1: son intocables en este
  plan.
