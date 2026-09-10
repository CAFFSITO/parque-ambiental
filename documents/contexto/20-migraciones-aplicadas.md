# 20 — Migraciones: qué agregan, cómo verificarlas y cómo revertirlas

Cubre `sql/06_dispositivos.sql`, `sql/07_automatizacion_areas.sql` y
`sql/08_credenciales_dispositivos.sql`.

## Estado

**Actualizado el 2026-09-10.** La tabla decía que ninguna migración estaba
aplicada. **Ya lo están, todas, en producción.** Lo que sigue es el estado
verificado, no el planeado.

| Migración | Escrita | **Aplicada en producción** | Verificado el |
|---|---|---|---|
| `sql/06_dispositivos.sql` | sí | **SÍ** | 2026-09-10 |
| `sql/07_automatizacion_areas.sql` | sí | **SÍ** | 2026-09-10 |
| `sql/08_credenciales_dispositivos.sql` | sí | **SÍ** | 2026-09-10 |
| `sql/09_credencial_nodo_fisico.sql` | sí | **SÍ** | 2026-09-10 |
| `sql/10_dispositivos_consultas.sql` | sí | **SÍ** | 2026-09-10 |
| `sql/11_observabilidad.sql` | sí | **NO** | — |

Evidencia de la verificación, de solo lectura, contra
`hrsfblpvvclauyqmwraf.supabase.co`:

```
sql/06 -> tabla dispositivos: 14 filas
sql/06 -> columna lecturas.dispositivo_id: EXISTE
sql/07 -> columnas areas.auto_*: EXISTEN
sql/08 -> tabla dispositivo_credenciales: 5 filas
sql/09 -> credencial 1 (bcrypt-v1, ACTIVA) del dispositivo 11:
          VERIFICA la clave grabada en el firmware
sql/10 -> dispositivos_ultima_lectura(): EXISTE
sql/10 -> dispositivos_historial_areas(): EXISTE
```

**Solo queda por aplicar `sql/11_observabilidad.sql`**, que agrega una vista de
lectura y nada más. Ningún camino del código la consulta: si no se aplica, no se
rompe nada. Ver `99-deploy.md`.

> **Cómo quedó desactualizado este documento.** Se escribió el 2026-09-09
> describiendo el plan, y las migraciones se aplicaron después sin volver acá.
> Durante casi un día el documento afirmaba lo contrario de lo que decía la
> base, y el plan de despliegue `99-deploy.md` se apoyaba en él. Queda anotado
> como precedente: un documento de estado que no se actualiza al ejecutar es
> peor que no tenerlo.

### Lo que sigue vigente de este documento

El procedimiento, las verificaciones por migración (§1.3, §2.3, §3.3), los
**rollbacks** (§1.4, §2.4, §3.4) y el baseline de §5. Los rollbacks son la
referencia del nivel 3 de `99-deploy.md`.

### Lo que ya NO aplica

§6.2 decía que las tres migraciones "no se ejecutaron contra ninguna base" y
que las pruebas estaban pendientes. Se ejecutaron contra producción. Lo que
**sigue sin hacerse** es la corrida de las mismas migraciones dos veces sobre
una base de prueba para demostrar idempotencia: en producción se aplicaron una
sola vez.

## Orden de aplicación

```
01_esquema.sql → 02_datos.sql → 03_reportes.sql → 04_multiseleccion.sql
  → 05_avisos.sql → 06_dispositivos.sql → 07_automatizacion_areas.sql
  → 08_credenciales_dispositivos.sql
```

`08` depende de `06`: su clave foránea apunta a `dispositivos`. `07` es
independiente de las otras dos, pero se numera después para respetar el orden
del plan.

> **`01_esquema.sql` y `02_datos.sql` NO se ejecutan nunca sobre una base con
> datos.** El primero hace `drop table` de las cinco tablas; el segundo hace
> `truncate … restart identity cascade`. Hoy eso borraría 5 683 lecturas, 431
> llamados y los umbrales que se editaron a mano desde el panel y que el
> archivo sembrado no refleja.

---

## 1. `sql/06_dispositivos.sql`

### 1.1 Qué agrega

| Objeto | Clase | Detalle |
|---|---|---|
| `dispositivos` | **tabla nueva** | 15 columnas. `codigo` es la identidad pública (la que viaja en `/api/ingest` y está grabada en el firmware); `id` es la interna, que referencian las otras tablas |
| `dispositivos.area_id` | columna nueva | `int references areas (id)`, **nullable**, **sin `on delete cascade`** |
| `dispositivos.naturaleza` | columna nueva | `text` con `check in ('FISICO','SIMULADO')`. Es lo que separa el hardware real del simulador |
| `dispositivos.ultimo_contacto_en` | columna nueva | materializada, derivada de `lecturas`, recalculable |
| `idx_dispositivos_codigo` | índice nuevo | **único**. Es el destino del `on conflict` del backfill |
| `idx_dispositivos_area` | índice nuevo | por `area_id` |
| `idx_dispositivos_contacto` | índice nuevo | por `ultimo_contacto_en desc` |
| `lecturas.dispositivo_id` | **columna nueva** | `int references dispositivos (id)`, **nullable** |
| `idx_lecturas_dispositivo_hora` | índice nuevo | `(dispositivo_id, tomada_en desc)`, mismo patrón que `idx_lecturas_area_hora` |

**Historial de asignación: no se crea ninguna tabla**, y es la opción elegida en
`10-arquitectura.md` §2, no un olvido. El pasado ya está congelado en
`lecturas.area_id` y `llamados.area_id`, y las cinco funciones `reporte_*`
agrupan por esas columnas: reasignar un nodo no mueve ninguna fila de ningún
reporte. El archivo lleva el bloque de comentario que lo explica.

**`lecturas.dispositivo` no se toca**: ni se borra, ni se renombra, ni cambia de
tipo.

### 1.2 Backfills

Tres, todos idempotentes:

1. **Siembra de `dispositivos`** — una fila por cada identificador distinto que
   ya exista en `lecturas.dispositivo`. `naturaleza = 'FISICO'` y `activo = true`
   **solo** para `NODO-INV-N-01`; el resto queda `SIMULADO` e inactivo. El área
   se infiere tomando el `area_id` con el que cada dispositivo más veces
   escribió, con el empate roto por `area_id` ascendente para que el resultado
   sea determinista. Cierra con `on conflict (codigo) do nothing`, así una
   segunda corrida no duplica ni pisa correcciones hechas después desde el panel.
2. **Vínculo de `lecturas`** — empareja `lecturas.dispositivo = dispositivos.codigo`,
   acotado con `where dispositivo_id is null`.
3. **`ultimo_contacto_en`** — el `max(tomada_en)` de las lecturas de cada
   dispositivo. Es también la sentencia de reparación si la columna quedara
   desfasada.

Resultado esperado con los datos de hoy: **13 dispositivos** (1 físico + 12
simulados) y **5 683 lecturas** con `dispositivo_id` completo.

### 1.3 Verificación

```sql
-- a) 13 dispositivos, y exactamente uno físico y activo
select naturaleza, activo, count(*)
  from dispositivos
 group by naturaleza, activo
 order by naturaleza, activo;
-- esperado: ('FISICO', true, 1) y ('SIMULADO', false, 12)

-- b) el nodo físico es el que está grabado en el firmware
select codigo, nombre, modelo, area_id, activo, naturaleza
  from dispositivos
 where naturaleza = 'FISICO';
-- esperado: NODO-INV-N-01 | Nodo Invernadero Norte | ESP32-S3-Zero | 1 | true | FISICO

-- c) ninguna lectura quedó sin vincular
select count(*) as sin_vincular
  from lecturas
 where dispositivo_id is null;
-- esperado: 0

-- d) el texto original no se tocó: el codigo del dispositivo vinculado
--    coincide siempre con el texto que el nodo declaró
select count(*) as incoherentes
  from lecturas l
  join dispositivos d on d.id = l.dispositivo_id
 where l.dispositivo is distinct from d.codigo;
-- esperado: 0

-- e) el área inferida coincide con el área en la que cada nodo escribió
select d.codigo, d.area_id, count(distinct l.area_id) as areas_distintas
  from dispositivos d
  join lecturas l on l.dispositivo_id = d.id
 group by d.codigo, d.area_id
 order by d.codigo;
-- esperado: areas_distintas = 1 en las 13 filas, y area_id igual a esa única área

-- f) ultimo_contacto_en coincide con la última lectura real
select count(*) as desfasados
  from dispositivos d
  left join (
    select dispositivo_id, max(tomada_en) as m
      from lecturas where dispositivo_id is not null group by dispositivo_id
  ) u on u.dispositivo_id = d.id
 where d.ultimo_contacto_en is distinct from u.m;
-- esperado: 0

-- g) los índices existen
select indexname from pg_indexes
 where tablename in ('dispositivos','lecturas')
   and indexname in ('idx_dispositivos_codigo','idx_dispositivos_area',
                     'idx_dispositivos_contacto','idx_lecturas_dispositivo_hora')
 order by indexname;
-- esperado: las cuatro filas
```

### 1.4 Rollback

Se revierte **antes** que `08`, no: `08` referencia `dispositivos`, así que hay
que revertir `08` primero. El orden es `08` → `06`.

```sql
-- Rollback de sql/06_dispositivos.sql
-- Requiere haber revertido antes sql/08_credenciales_dispositivos.sql.
drop index if exists idx_lecturas_dispositivo_hora;
alter table lecturas drop column if exists dispositivo_id;
drop table if exists dispositivos;   -- se lleva sus tres índices
```

**Qué se pierde:** solo información derivada. `lecturas.dispositivo` (el texto),
`lecturas.area_id` y todas las filas originales quedan intactas. El backfill se
puede volver a generar corriendo `06` de nuevo.

---

## 2. `sql/07_automatizacion_areas.sql`

### 2.1 Qué agrega

| Objeto | Clase | Default | Significado |
|---|---|---|---|
| `areas.auto_temp_alta` | **columna nueva** `boolean not null` | `true` | accionar cuando `temperatura > temp_max` (ventilar) |
| `areas.auto_temp_baja` | **columna nueva** `boolean not null` | `false` | accionar cuando `temperatura < temp_min` |
| `areas.auto_hum_alta` | **columna nueva** `boolean not null` | `false` | accionar cuando `humedad > hum_max` |
| `areas.auto_hum_baja` | **columna nueva** `boolean not null` | `true` | accionar cuando `humedad < hum_min` (regar) |

**`temp_min`, `temp_max`, `hum_min` y `hum_max` no se tocan**: mismo tipo, mismo
nombre, mismo significado.

### 2.2 El backfill y por qué preserva la conducta actual

El archivo agrega las columnas **sin default y aceptando null**, después corre
un `update` explícito acotado con `where … is null`, y recién entonces fija los
defaults y el `not null`. Ese orden tiene dos motivos:

- el backfill hace el trabajo de verdad y queda auditable, en vez de esconderse
  en un default;
- como el `update` solo toca filas en `null`, **volver a correr el archivo nunca
  revierte una configuración que alguien haya cambiado después** desde la
  pantalla de Áreas.

Los cuatro valores reproducen la expresión de `rele` de
`app/api/ingest/route.ts` (el cálculo inmediatamente anterior a armar la
respuesta 200):

```
auto_temp_alta = true   ->  temperatura > temp_max   ACCIONA
auto_temp_baja = false  ->  temperatura < temp_min   no acciona
auto_hum_alta  = false  ->  humedad     > hum_max    no acciona
auto_hum_baja  = true   ->  humedad     < hum_min    ACCIONA
```

Con esos valores, los dos términos del medio se anulan y la expresión nueva se
reduce a `(temperatura > temp_max) || (humedad < hum_min)`, que es la condición
vigente, con las mismas comparaciones estrictas.

### 2.3 Verificación

```sql
-- a) las ocho áreas quedaron con la combinación que replica la conducta actual
select auto_temp_alta, auto_temp_baja, auto_hum_alta, auto_hum_baja, count(*)
  from areas
 group by 1,2,3,4;
-- esperado: una sola fila -> (true, false, false, true, 8)

-- b) ninguna quedó indefinida
select count(*) from areas
 where auto_temp_alta is null or auto_temp_baja is null
    or auto_hum_alta  is null or auto_hum_baja  is null;
-- esperado: 0

-- c) los umbrales no se movieron (comparar con el baseline de §5)
select id, codigo, temp_min, temp_max, hum_min, hum_max, activa
  from areas order by id;

-- d) los defaults quedaron fijados para las áreas futuras
select column_name, column_default, is_nullable
  from information_schema.columns
 where table_name = 'areas' and column_name like 'auto\_%'
 order by column_name;
-- esperado: auto_hum_alta=false, auto_hum_baja=true,
--           auto_temp_alta=true, auto_temp_baja=false; is_nullable = NO en las cuatro
```

### 2.4 Rollback

```sql
-- Rollback de sql/07_automatizacion_areas.sql
alter table areas drop column if exists auto_temp_alta;
alter table areas drop column if exists auto_temp_baja;
alter table areas drop column if exists auto_hum_alta;
alter table areas drop column if exists auto_hum_baja;
```

**Qué se pierde:** la configuración de automatización por área. Ninguna columna
preexistente se ve afectada.

---

## 3. `sql/08_credenciales_dispositivos.sql`

### 3.1 Qué agrega

| Objeto | Clase | Detalle |
|---|---|---|
| `dispositivo_credenciales` | **tabla nueva** | 14 columnas. Guarda el **hash**, nunca el secreto |
| `dispositivo_id` | columna nueva | `int not null references dispositivos (id) **on delete cascade**` |
| `algoritmo` | columna nueva | `check in ('sha256-v1','bcrypt-v1')` |
| `estado` | columna nueva | `check in ('ACTIVA','ROTADA','REVOCADA')` |
| `usada_en` | columna nueva | auditoría de uso: durante una rotación, es lo que dice si ya es seguro revocar la vieja |
| `creada_por` / `revocada_por` / `motivo` | columnas nuevas | quién y por qué |
| `idx_credenciales_dispositivo` | índice nuevo | por `dispositivo_id` |
| `idx_credenciales_estado` | índice nuevo | por `estado` |
| `idx_credenciales_hash_sha256` | índice nuevo | **único parcial**, `where algoritmo = 'sha256-v1'` |

El `on delete cascade` acá sí corresponde, al revés que en
`dispositivos.area_id`: una credencial sin dispositivo sería un secreto válido
sin dueño.

El índice único es **parcial** porque solo tiene sentido sobre el algoritmo
determinista. Los hashes de bcrypt llevan sal, así que dos credenciales con el
mismo secreto darían hashes distintos y exigirles unicidad no significaría nada.

### 3.2 Qué NO hace

**No siembra ninguna credencial.** La del nodo físico necesita el hash bcrypt de
la clave que el firmware ya tiene, calculado con la misma librería y las mismas
10 rondas que usa el resto del sistema (`scripts/hash.js`), y eso no se puede
hacer desde SQL. Va en la etapa siguiente, con un script de Node y su propia
migración.

Mientras la tabla esté vacía, `/api/ingest` sigue autenticando con `DEVICE_KEY`
exactamente como hasta ahora.

### 3.3 Verificación

```sql
-- a) la tabla existe y está vacía
select count(*) as credenciales from dispositivo_credenciales;
-- esperado: 0

-- b) los tres índices existen, y el del hash es único y parcial
select indexname, indexdef from pg_indexes
 where tablename = 'dispositivo_credenciales' order by indexname;
-- esperado: idx_credenciales_dispositivo, idx_credenciales_estado,
--           e idx_credenciales_hash_sha256 con UNIQUE y WHERE algoritmo = 'sha256-v1'

-- c) los checks rechazan valores fuera de catálogo (probar SOLO en base de prueba)
--    Las dos sentencias tienen que FALLAR:
-- insert into dispositivo_credenciales (dispositivo_id, algoritmo, secreto_hash)
--   values (1, 'md5', 'x');
-- insert into dispositivo_credenciales (dispositivo_id, secreto_hash, estado)
--   values (1, 'x', 'VENCIDA');
```

### 3.4 Rollback

```sql
-- Rollback de sql/08_credenciales_dispositivos.sql
drop table if exists dispositivo_credenciales;   -- se lleva sus tres índices
```

**Qué se pierde:** nada, mientras la tabla siga vacía. Una vez que tenga
credenciales, revertirla obliga a volver a emitirlas.

---

## 4. Verificación transversal: que nada cambió

Estas comprobaciones son las que respaldan la afirmación "el sistema se comporta
exactamente igual". Se corren **antes** y **después**, y tienen que dar lo mismo.

### 4.1 Conteos

```sql
select 'areas' as tabla, count(*) from areas
union all select 'empleados', count(*) from empleados
union all select 'usuarios',  count(*) from usuarios
union all select 'lecturas',  count(*) from lecturas
union all select 'llamados',  count(*) from llamados
order by 1;
```

> **Ojo con `lecturas` y `llamados`.** No son estables en el tiempo: el nodo
> reporta y la vigilancia crea llamados. Entre la auditoría inicial y la captura
> del baseline de §5, `llamados` pasó de 430 a **431** sin que nadie tocara nada
> — fue la vigilancia levantando un "Sensor sin señal" porque el nodo dejó de
> reportar.
>
> Por eso la comparación seria se hace **acotada a un corte** fijado antes de
> migrar:
>
> ```sql
> select count(*) from lecturas where tomada_en < '2026-09-09T21:00:00Z';
> select count(*) from llamados where creado_en < '2026-09-09T21:00:00Z';
> ```
>
> Esos dos números **sí** tienen que ser idénticos antes y después. Si cambian,
> la migración tocó filas históricas y hay que revertir.

### 4.2 Las cinco funciones de reporte

Se llaman con los mismos parámetros antes y después y se comparan los
resultados. Con `p_hasta` fijo en el corte, son deterministas:

```sql
select * from reporte_resumen(null, null, null, '2026-09-09T21:00:00Z');
select * from reporte_por_area(null, null, null, '2026-09-09T21:00:00Z');
select * from reporte_distribucion(null, null, null, '2026-09-09T21:00:00Z');
select * from reporte_por_dia(null, null, '2026-09-01T00:00:00Z', '2026-09-09T21:00:00Z');
select * from reporte_clima_por_dia(null, '2026-09-01T00:00:00Z', '2026-09-09T21:00:00Z');
```

Ninguna de las tres migraciones toca `llamados`, ni `lecturas.area_id`, ni las
funciones, así que **cualquier diferencia es un defecto**.

### 4.3 La aplicación

```
yarn build     # tiene que seguir terminando en exit code 0
yarn dev       # y el panel entero tiene que funcionar sin cambios
```

Recorrido mínimo: tablero, `/llamados` (crear y atender uno), `/movil`,
`/areas` (editar un umbral), `/empleados`, `/usuarios`, `/dispositivos`
(incluido el simulador), `/reportes` y la exportación CSV.

El código no conoce ninguna de las estructuras nuevas: `lib/tipos.ts` no declara
las columnas nuevas y ningún `select` las pide. Las columnas agregadas a `areas`
no rompen los `select` existentes porque están todos escritos con lista
explícita de columnas (por ejemplo el de `/api/ingest`), nunca con `select *`.

---

## 5. Baseline capturado antes de migrar

Tomado el **2026-09-09**, de solo lectura, contra la base real. Corte:
**`2026-09-09T21:00:00Z`**.

### 5.1 Conteos

| Tabla | Total | Acotado al corte |
|---|---|---|
| `areas` | 8 | — |
| `empleados` | 15 | — |
| `usuarios` | 3 | — |
| `lecturas` | 5 683 | **5 683** |
| `llamados` | **431** | **430** |

Última lectura registrada: `NODO-INV-N-01`, `2026-09-09T18:57:05.983+00:00`.

### 5.2 `reporte_resumen(null, null, null, corte)`

```json
[{"total":430,"atendidos":329,"no_atendidos":101}]
```

### 5.3 `reporte_por_area(null, null, null, corte)`

| codigo | nombre | normal | emergencia |
|---|---|---|---|
| COM-1 | Playa de Compostaje | 22 | 7 |
| DEP-1 | Depósito y Taller | 21 | 11 |
| HID-1 | Hidroponía | 69 | 22 |
| INV-G | Invernadero de Germinación | 62 | 29 |
| INV-N | Invernadero Norte | 35 | 17 |
| INV-S | Invernadero Sur | 29 | 14 |
| RIE-1 | Sala de Bombas y Riego | 30 | 16 |
| VIV-1 | Vivero Forestal | 29 | 17 |

### 5.4 `reporte_distribucion(null, null, null, corte)`

| dimension | etiqueta | cantidad |
|---|---|---|
| estado | NO_ATENDIDO | 101 |
| estado | ATENDIDO | 329 |
| tipo | NORMAL | 297 |
| tipo | EMERGENCIA | 133 |
| origen | SENSOR | 280 |
| origen | EMPLEADO | 150 |

### 5.5 `reporte_por_dia(null, null, '2026-09-01', corte)`

| dia | normal | emergencia |
|---|---|---|
| 2026-08-31 | 1 | 0 |
| 2026-09-01 | 5 | 15 |
| 2026-09-02 | 0 | 1 |
| 2026-09-03 | 3 | 2 |
| 2026-09-04 … 2026-09-08 | 0 | 0 |
| 2026-09-09 | 4 | 4 |

### 5.6 `reporte_clima_por_dia(null, '2026-09-01', corte)`

| dia | temp_prom | hum_prom |
|---|---|---|
| 2026-08-31 | 21.4 | 65.7 |
| 2026-09-01 | 23.0 | 63.5 |
| 2026-09-02 | 20.8 | 76.6 |
| 2026-09-09 | 22.3 | 56.7 |

### 5.7 Resultado esperado de los backfills

| Comprobación | Valor esperado |
|---|---|
| Filas en `dispositivos` | 13 |
| `naturaleza = 'FISICO'` y `activo` | 1 (`NODO-INV-N-01`, área 1) |
| `naturaleza = 'SIMULADO'` e inactivos | 12 |
| `lecturas` con `dispositivo_id is null` | 0 |
| Áreas con `(true, false, false, true)` | 8 |
| Filas en `dispositivo_credenciales` | 0 |

---

## 6. Qué se validó y qué NO

Esto es lo que efectivamente se hizo, sin redondear.

### 6.1 Validado

| Comprobación | Método | Resultado |
|---|---|---|
| **Sintaxis PostgreSQL** de los tres archivos | parseados con la gramática real de PostgreSQL (`pg-query-emscripten`, instalado fuera del proyecto) | **pasan las tres**. `06`: 9 sentencias; `07`: 16; `08`: 4 |
| **Ausencia de sentencias prohibidas** | búsqueda de `drop table`, `truncate`, `drop column`, `rename`, `delete from`, `alter column … type` | **ninguna** en los tres archivos |
| **Idempotencia estructural** | inspección del árbol sintáctico | los 2 `create table` con `if_not_exists`; los 7 `create index` con `if_not_exists`; los 5 `add column` con `missing_ok`. Los `set default` y `set not null` son idempotentes por definición |
| **Idempotencia de los backfills** | revisión de cada sentencia | `on conflict (codigo) do nothing` en la siembra; `where … is null` en los tres `update` de vínculo y automatización; el de `ultimo_contacto_en` recalcula desde `lecturas` con `is distinct from` |
| **`yarn build`** | ejecutado | exit code 0, sin cambios respecto del estado previo |
| **Baseline** | consultas de solo lectura contra la base real | §5 |

### 6.2 NO validado

**Las tres migraciones no se ejecutaron contra ninguna base.** Las pruebas
obligatorias —aplicarlas, correrlas dos veces, comparar conteos y comparar las
cinco funciones— **están pendientes**.

El motivo es concreto: en este entorno no hay Docker, ni `psql`, ni PostgreSQL
local, y las únicas credenciales disponibles (`.env.local`) apuntan a la base de
**producción**, la que tiene las 280 lecturas del nodo físico. Probar ahí está
explícitamente prohibido, y con razón.

En consecuencia, lo que sigue sin verificar es todo lo **semántico**, que es
justamente lo que un parser no puede ver:

- que la siembra produzca 13 filas y no otra cantidad;
- que la inferencia del área por moda dé el resultado esperado;
- que el `on conflict (codigo)` resuelva contra `idx_dispositivos_codigo`;
- que el `check` de `codigo` acepte `NODO-INV-N-01` y `ESP32-INV-N` (13 y 11
  caracteres: entra holgado, pero no está probado);
- que `set not null` no falle por alguna fila en `null`;
- que la segunda corrida no falle;
- que los conteos y las cinco funciones queden idénticos.

### 6.3 Cómo completar las pruebas

Con una base de prueba disponible (branch de Supabase, o un PostgreSQL local),
en este orden:

1. Levantar una base con el esquema actual: `01` → `02` → `03` → `04` → `05`.
   **Solo ahí**, nunca contra la real.
2. Guardar el baseline: los conteos de §4.1 y las cinco consultas de §4.2.
3. Aplicar `06`, `07` y `08`.
4. **Volver a aplicar los tres, en el mismo orden.** La segunda pasada no debe
   fallar ni duplicar filas.
5. Correr las verificaciones de §1.3, §2.3 y §3.3.
6. Correr de nuevo §4.1 y §4.2 y comparar contra el baseline del punto 2.
7. `yarn build` y el recorrido de §4.3.

Si algo falla, los rollbacks están en §1.4, §2.4 y §3.4, en el orden
`08` → `07` → `06`.
