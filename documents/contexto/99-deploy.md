# 99 — Despliegue a producción

Fecha: **2026-09-10**. Estado: **DETENIDO EN EL PASO 1**.

---

## 0. Resumen, primero lo que importa

**El despliegue no se ejecutó.** Se detuvo en el paso 1, que es el respaldo, y
el propio encargo dice *"sin este paso no se continúa"*.

Tres cosas cambiaron respecto de lo que el plan asumía, y las tres hay que
saberlas antes de leer el resto:

1. **Las migraciones ya estaban aplicadas en producción.** Los pasos 3 y 4 no
   están pendientes: están hechos. Se verificó por SQL. `20-migraciones-aplicadas.md`
   decía lo contrario y se corrigió.
2. **El nodo físico no está reportando**, y no desde hoy: su última lectura de
   hardware es del **2026-09-10T02:59:05Z**. Los pasos 6 a 9 piden observar un
   nodo que reporta sin interrupción; hoy no hay nada que observar.
3. **Hay indicios de que el nodo fue reflasheado con otro sketch.** Ver §1.3.

Lo que **sí** se hizo, entero y verificado: la observabilidad que pedía el
encargo, la corrección del documento de migraciones, el tag de git y este
runbook con los tres niveles de rollback.

### Tablero de estado

| Paso | Qué | Estado |
|---|---|---|
| 1 | Respaldo de producción, verificando restauración | **BLOQUEADO** — §1 |
| 2 | Tag de git del commit desplegado | **HECHO, con salvedad** — §2 |
| 3 | Aplicar `sql/06`, `sql/07`, `sql/08` | **YA ESTABAN APLICADAS** — §3 |
| 4 | Sembrar `NODO-INV-N-01`, su área y su credencial | **YA ESTABA SEMBRADO** — §4 |
| 5 | Encender el fallback global en Vercel | **BLOQUEADO** — §5 |
| 6 | Desplegar el código | **NO EJECUTADO** — §6 |
| 7 | Observar 30 minutos | **NO EJECUTABLE HOY** — §7 |
| 8 | Verificar en logs que autentica por credencial propia | **INSTRUMENTADO, sin ejecutar** — §8 |
| 9 | Apagar el fallback global y observar 15 minutos | **NO EJECUTADO** — §9 |
| 10 | Tag del estado final | **NO EJECUTADO** — §10 |

---

## 1. Paso 1 — Respaldo. **BLOQUEADO**

### 1.1 Por qué no se pudo

Un respaldo que sirve es uno que se probó restaurando. Para eso hace falta
`pg_dump` y una base donde restaurar. En este entorno **no hay `pg_dump`, ni
`psql`, ni Docker, ni PostgreSQL local** —lo mismo que ya constaba en
`20-migraciones-aplicadas.md` §6.2— y las únicas credenciales presentes
(`.env.local`) apuntan a **producción**.

Lo único que se podría hacer desde acá es volcar las tablas a JSON por
PostgREST. **Eso no es un respaldo**: no lleva el esquema, ni los índices, ni
las secuencias, ni las funciones, y no se puede restaurar con un comando. Sería
un archivo que da una falsa sensación de red.

**No se produjo ningún respaldo, y por eso el despliegue no siguió.**

### 1.2 Qué hay que hacer, con los comandos

Supabase tiene respaldos automáticos diarios en el panel
(*Database → Backups*). **No alcanzan solos**: no se sabe si restauran hasta
que alguien restaura. El procedimiento mínimo:

```bash
# 1. Volcado completo desde la cadena de conexión del panel de Supabase
#    (Project Settings -> Database -> Connection string -> URI).
#    Se pide por variable de entorno para que no quede en el historial.
export PGURI='postgresql://postgres:...@db.hrsfblpvvclauyqmwraf.supabase.co:5432/postgres'

pg_dump "$PGURI" --format=custom --no-owner --no-privileges \
  --file=respaldo-2026-09-10.dump

# 2. Comprobar que el archivo se puede leer y qué trae dentro
pg_restore --list respaldo-2026-09-10.dump | head -40

# 3. LA PARTE QUE NO SE PUEDE SALTEAR: restaurar en otra base y verificar.
#    Una branch de Supabase o un Postgres local sirven; produccion NO.
createdb pab_restaurado
pg_restore --dbname=pab_restaurado --no-owner --no-privileges \
  respaldo-2026-09-10.dump

# 4. Comparar los conteos contra el baseline de §3.2 de este documento.
psql pab_restaurado -c "
  select 'areas' t, count(*) from areas
  union all select 'empleados', count(*) from empleados
  union all select 'usuarios',  count(*) from usuarios
  union all select 'lecturas',  count(*) from lecturas
  union all select 'llamados',  count(*) from llamados
  union all select 'dispositivos', count(*) from dispositivos
  union all select 'dispositivo_credenciales', count(*) from dispositivo_credenciales
  order by 1;"
```

Si el punto 4 no reproduce los conteos, **el respaldo no sirve** y no se
despliega.

### 1.3 Observación sobre el nodo, que cambia el plan

Durante esta sesión, el archivo
`firmware/produccion_parque/produccion_parque.ino` apareció **reemplazado por un
sketch distinto**, de 41 líneas:

```
/*
  prueba_alerta.ino
  ESP32-S3-Zero

  Prueba aislada de buzzer + LED.
  Ambos están conectados a GPIO 7.
*/
```

Minutos después volvió a ser el firmware de producción, idéntico a `HEAD`
(`git status` sobre `firmware/` quedó limpio). Nadie de este lado tocó ese
archivo.

**La conclusión probable, y hay que confirmarla antes de desplegar:** el nodo
fue reflasheado con ese sketch de prueba para revisar el buzzer. Eso explicaría
por qué dejó de reportar a las 02:59Z y por qué sigue callado: **no está
corriendo el firmware de producción.**

Si es así, el paso 6 —*"el nodo debe seguir reportando sin interrupción"*— parte
de una premisa falsa: **ya hubo interrupción, y no la causará el despliegue.**

**Antes de desplegar hay que responder:** ¿qué sketch tiene grabado el nodo
ahora mismo? Si tiene el de prueba, hay que volver a grabarle el de producción
—que está intacto en git— **antes** del despliegue, no como parte de él.

> Ojo con el orden. Reflashear no es parte del deploy (está prohibido en el
> encargo, y con razón), pero **volver al firmware de producción no es
> reflashear para el deploy: es restaurar el estado desde el cual el deploy
> tiene sentido.** Son dos cosas distintas y conviene decirlo así.

---

## 2. Paso 2 — Tag de git. **HECHO, con una salvedad**

```bash
git tag -a produccion-pre-dispositivos-2026-09-10 0249b76 -m "..."
```

| | |
|---|---|
| Tag | `produccion-pre-dispositivos-2026-09-10` |
| Objeto | `4e63552456fc12290926d859df595b1f57dcc740` |
| Commit | `0249b76d0962664ce6fdc64e14eb0f54d072c0d6` (`n`) |
| Creado | 2026-09-10T18:45Z |
| **Empujado a origin** | **NO** |

**La salvedad, y es importante:** `0249b76` es lo que `origin/main` tiene ahora
y es el candidato natural a estar desplegado, pero **no se pudo confirmar contra
Vercel**. No hay CLI de Vercel instalada, no hay carpeta `.vercel` y no hay
token en el entorno.

**Antes de confiar en este tag para el rollback**, confirmar en el panel de
Vercel (*Deployments → el que tiene el badge Production*) que el commit es
`0249b76`. Si fuera otro, mover el tag:

```bash
git tag -d produccion-pre-dispositivos-2026-09-10
git tag -a produccion-pre-dispositivos-2026-09-10 <sha-real> -m "..."
```

Y empujarlo, que **no** se hizo desde acá:

```bash
git push origin produccion-pre-dispositivos-2026-09-10
```

---

## 3. Paso 3 — Migraciones. **YA ESTABAN APLICADAS**

### 3.1 Verificación, de solo lectura, contra producción

`2026-09-10T18:37:31Z`, contra `hrsfblpvvclauyqmwraf.supabase.co`:

```
sql/06 -> tabla dispositivos: 14 filas
sql/06 -> columna lecturas.dispositivo_id: EXISTE
sql/07 -> columnas areas.auto_*: EXISTEN
sql/08 -> tabla dispositivo_credenciales: 5 filas
sql/10 -> dispositivos_ultima_lectura(): EXISTE
sql/10 -> dispositivos_historial_areas(): EXISTE
```

**No se aplicó nada en esta sesión.** No hacía falta, y aplicarlas de nuevo
—aunque sean idempotentes— sin respaldo habría violado el paso 1.

`20-migraciones-aplicadas.md` afirmaba que ninguna estaba aplicada. Se corrigió,
con la evidencia y con una nota sobre cómo quedó desactualizado.

### 3.2 Conteos de filas — baseline del despliegue

`2026-09-10T18:37Z`:

| Tabla | Filas |
|---|---|
| `areas` | 8 |
| `empleados` | 15 |
| `usuarios` | 3 |
| `lecturas` | 5 802 |
| `llamados` | 431 |
| `dispositivos` | 14 |
| `dispositivo_credenciales` | 5 |

> **`lecturas` no es estable y no sirve como control de "nada cambió".** Sube
> con cada ingesta, incluidas las de las suites automáticas. Para comparar
> antes/después hay que acotar a un corte fijo, como hace
> `20-migraciones-aplicadas.md` §4.1:
>
> ```sql
> select count(*) from lecturas where tomada_en < '2026-09-10T18:00:00Z';
> select count(*) from llamados where creado_en < '2026-09-10T18:00:00Z';
> ```
>
> Esos dos sí tienen que ser idénticos antes y después. Si cambian, algo tocó
> filas históricas.

### 3.3 Lo único que queda por aplicar

`sql/11_observabilidad.sql`, escrito en esta sesión. Agrega **una vista de
lectura** y nada más: ni tablas, ni columnas, ni filas. Ningún camino del código
la consulta, así que **si no se aplica no se rompe nada**.

Se pega en el SQL Editor de Supabase. Es idempotente (`drop view if exists` +
`create or replace view`).

> **No fue ejecutada ni validada contra ningún Postgres.** No hay motor
> disponible en este entorno. Es el mismo estado en el que estuvieron `06`,
> `07` y `08` cuando se escribieron.

---

## 4. Paso 4 — Siembra del nodo. **YA ESTABA HECHA**

Verificado el `2026-09-10T18:37Z`, solo lectura:

```json
dispositivo: {"id":11,"codigo":"NODO-INV-N-01","nombre":"Nodo Invernadero Norte",
              "modelo":"ESP32-S3-Zero","area_id":1,"activo":true,
              "naturaleza":"FISICO","ultimo_contacto_en":"2026-09-10T15:15:47.761+00:00"}

área:        {"id":1,"codigo":"INV-N","nombre":"Invernadero Norte","activa":true,
              "temp_min":20,"temp_max":25,"hum_min":60,"hum_max":80}

credencial:  {"id":1,"dispositivo_id":11,"algoritmo":"bcrypt-v1","estado":"ACTIVA",
              "origen":"LEGADO","expira_en":null,"creada_por":"siembra"}
```

**Y la prueba que importa**, hecha comparando el hash guardado contra la clave
leída del firmware con la misma librería y las mismas rondas:

```
credencial 1 (bcrypt-v1, ACTIVA): VERIFICA la clave grabada en el firmware
```

Es decir: **el nodo puede autenticarse con la clave que ya tiene grabada, sin
reflashear.** Que era exactamente el objetivo del paso 4.

`scripts/sembrar-credencial.js` no se volvió a correr: la fila ya existe y
volver a sembrarla no haría nada (el script es idempotente por origen).

### 4.1 Ojo con `ultimo_contacto_en`

Dice `15:15:47Z`, que parece reciente. **No lo escribió el nodo.** Lo
escribieron las suites automáticas de esta sesión, que usan la credencial real
del dispositivo. Se distingue por la cadencia:

```
id 5825  2026-09-10T15:15:47.761Z  (+1.3 s)
id 5824  2026-09-10T15:15:46.468Z  (+1.3 s)
id 5823  2026-09-10T15:15:45.193Z  (+1.2 s)
...
```

El hardware reporta cada **10 s** (`INTERVALO_MS`). Esas están a 1,3 s: son
`curl`. **La última lectura de hardware real es la del 2026-09-10T02:59:05Z.**

---

## 5. Paso 5 — Fallback global en Vercel. **BLOQUEADO**

No hay CLI de Vercel instalada ni token en el entorno. **No se cargó ninguna
variable.**

Lo que hay que hacer, en *Project → Settings → Environment Variables*, alcance
**Production**:

| Variable | Valor | Cuándo |
|---|---|---|
| `INGEST_PERMITE_CLAVE_GLOBAL` | `1` | **antes** de desplegar (paso 5) |
| `INGEST_PERMITE_CLAVE_GLOBAL` | borrarla, o `0` | **después** del paso 8 |
| `DEVICE_KEY` | la clave grabada en el firmware | ya debería estar; el fallback la necesita |

Por CLI:

```bash
npx vercel login
npx vercel link
printf '1' | npx vercel env add INGEST_PERMITE_CLAVE_GLOBAL production
npx vercel env ls production        # confirmar sin imprimir valores
```

**Una variable de entorno nueva no toma efecto hasta el próximo despliegue.**
Por eso este paso va antes del 6 y no después.

### 5.1 Confirmar primero que hoy está apagada

En `.env.local` **no está definida**, y el default del código es cerrado: solo
el literal `"1"` la enciende (`app/api/ingest/route.ts`, `FLAG_CLAVE_GLOBAL`).
**No se pudo comprobar qué vale en Vercel.** Si allá ya estuviera en `"1"`, el
paso 9 —apagarla— es lo único que hace falta, y el paso 5 sobra.

### 5.2 Por qué encenderla si el nodo ya tiene credencial propia

Es red de seguridad, no necesidad. §4 demuestra que la credencial `bcrypt-v1`
verifica la clave del firmware, así que el nodo **debería** entrar por
credencial propia. Encender el fallback cubre el caso de que esa cadena falle
por algo no previsto: sin él, el nodo recibiría 401, su relé se apagaría por
failsafe a los 45 s y a los 90 s la vigilancia levantaría una emergencia.

El costo de tenerla encendida un rato es conocido y está documentado: en modo
compatibilidad la identidad se resuelve por el código declarado, y eso reabre
R1 mientras dure. Por eso el paso 9 no es opcional.

---

## 6. Paso 6 — Desplegar. **NO EJECUTADO**

No se commiteó ni se empujó nada. El árbol tiene **26 rutas modificadas o
nuevas** sin commitear, que son todo el trabajo de las etapas anteriores.

Cuando el paso 1 esté cumplido:

```bash
git add -A
git commit -m "Dispositivos, credenciales, automatizacion, simulador aislado y observabilidad"
git push origin main            # Vercel despliega main automaticamente
```

**Antes de empujar**, con el árbol como va a quedar desplegado:

```bash
yarn verificar   # lint + test + build + probar:ingest
```

Estado al 2026-09-10T18:50Z: `yarn lint` limpio · `yarn test` **160/160** ·
`yarn build` exit 0 · `yarn probar:ingest` **18/18**, exit 0 ·
`yarn probar:permisos` PASS.

---

## 7. Paso 7 — Observar 30 minutos. **NO EJECUTABLE HOY**

No hay nada que observar: el nodo lleva **más de 15 horas** sin reportar (§4.1),
por lo que parece un reflasheo con otro sketch (§1.3).

### 7.1 Qué mirar cuando el nodo esté de vuelta

| Señal | Dónde | Qué tiene que verse |
|---|---|---|
| Lecturas entrando | consulta de §7.2 | `lecturas_ultima_hora` creciendo, ~360/h |
| Último contacto | ídem | `segundos_sin_reportar` < 90, `conexion = EN_LINEA` |
| Llamados | `/llamados` | ninguno nuevo de `Sensor sin señal` para `NODO-INV-N-01` |
| Relé | logs (§8) | `rele` siguiendo la temperatura contra el umbral de INV-N |
| Latencia | logs (§8) | `ms` bien por debajo de 6000 |

### 7.2 La consulta guardada

`sql/11_observabilidad.sql` crea la vista. Con la migración aplicada:

```sql
select codigo, naturaleza, activo, area, conexion,
       segundos_sin_reportar, lecturas_ultima_hora,
       credenciales_vigentes, credencial_usada_en, ultimo_contacto_en
  from dispositivos_ultimo_contacto
 where vigilado
 order by segundos_sin_reportar nulls last;
```

**Sin aplicar la migración**, la misma respuesta, para pegar en el SQL Editor:

```sql
select
  d.codigo,
  d.naturaleza,
  d.activo,
  a.codigo as area,
  d.ultimo_contacto_en,
  floor(extract(epoch from (now() - d.ultimo_contacto_en)))::bigint
    as segundos_sin_reportar,
  case
    when d.ultimo_contacto_en is null then 'NUNCA_REPORTO'
    when extract(epoch from (now() - d.ultimo_contacto_en)) > 90 then 'SIN_SENAL'
    else 'EN_LINEA'
  end as conexion,
  (select count(*) from lecturas l
    where l.dispositivo_id = d.id
      and l.tomada_en > now() - interval '1 hour') as lecturas_ultima_hora,
  (select max(c.usada_en) from dispositivo_credenciales c
    where c.dispositivo_id = d.id) as credencial_usada_en
from dispositivos d
left join areas a on a.id = d.area_id
where d.naturaleza = 'FISICO' and d.activo
order by 6 nulls last;
```

El corte de 90 segundos es el mismo `SEGUNDOS_SIN_SENAL` que usan la vigilancia,
el tablero y la pantalla de Dispositivos, y es **estrictamente mayor**: a los 90
exactos todavía está en línea.

---

## 8. Paso 8 — Credencial propia y no fallback. **INSTRUMENTADO**

La verificación no se pudo hacer porque no hubo despliegue ni tráfico del nodo.
**Lo que sí se construyó en esta sesión es el instrumento con el que se hace.**

### 8.1 Log estructurado en `/api/ingest`

`lib/registro.ts`, nuevo. Cada petición emite **una línea JSON**. Vercel indexa
JSON por campo, así que se puede filtrar por `modo` sin expresiones regulares
sobre prosa.

Verificado en local contra la base real:

```json
{"evento":"ingest","momento":"2026-09-10T18:41:03.692Z",
 "declarado":"NODO-INV-N-01","dispositivo":"NODO-INV-N-01",
 "resultado":"CREDENCIAL_PROPIA","modo":"credencial","credencial_id":1,
 "area":"INV-N","area_declarada":"INV-N",
 "discrepancia_area":false,"discrepancia_dispositivo":false,
 "rele":true,"alarma":true,"motivos_rele":["TEMP_ALTA"],
 "temperatura":33,"humedad":70,"boton":"NORMAL","llamados":2,
 "estado_http":200,"ms":2447}
```

Discrepancia de área (el cuerpo declaró `COM-1`, la base dice `INV-N`):

```json
{"evento":"ingest","declarado":"NODO-INV-N-01","dispositivo":"NODO-INV-N-01",
 "resultado":"CREDENCIAL_PROPIA","modo":"credencial","credencial_id":1,
 "area":"INV-N","area_declarada":"COM-1","discrepancia_area":true,
 "rele":false,"alarma":true,"motivos_rele":[],"llamados":0,
 "estado_http":200,"ms":1785}
```

Rechazo y falta de cabecera:

```json
{"evento":"ingest","declarado":"NODO-INV-N-01","dispositivo":null,
 "resultado":"RECHAZADO","modo":"ninguno","estado_http":401,"ms":1054}

{"evento":"ingest","declarado":null,"dispositivo":null,
 "resultado":"SIN_CLAVE","modo":"ninguno","estado_http":401,"ms":0}
```

**Sin secretos, comprobado.** Se buscó la clave del firmware en el log completo:
no aparece. Tampoco hay `secreto_hash` ni prefijos `pab_`. Del lado de las
credenciales solo sale el **id**, que es un entero y no revela nada.

Cubre lo que pedía el encargo: dispositivo, resultado de autenticación, modo,
área resuelta, discrepancia con `body.area` y decisión de relé. Agrega
`discrepancia_dispositivo`, `motivos_rele`, `llamados` y `ms`.

### 8.2 La compuerta del paso 9

En los logs de Vercel, durante la ventana de observación:

```
evento:"ingest" AND dispositivo:"NODO-INV-N-01"
```

**La condición para apagar el fallback es una sola:**

> Todas las peticiones de `NODO-INV-N-01` durante los 30 minutos tienen
> `"modo":"credencial"` y `"resultado":"CREDENCIAL_PROPIA"`.
>
> **Ni una sola** con `"modo":"compatibilidad"`.

Con `INTERVALO_MS = 10 s`, 30 minutos son **unas 180 peticiones**. Si aparece
aunque sea una en compatibilidad, **el paso 9 no se hace**: significa que la
credencial no está resolviendo y apagar el fallback dejaría al nodo en 401.

El campo `compatibilidad` de la respuesta 200 dice lo mismo y se puede mirar sin
logs, con `curl`. El log sirve para verlo agregado y sin tocar el nodo.

---

## 9. Paso 9 — Apagar el fallback. **NO EJECUTADO**

Solo después de §8.2. Borrar `INGEST_PERMITE_CLAVE_GLOBAL` de Vercel (o ponerla
en `0`) y **volver a desplegar**, porque una variable no cambia sin despliegue:

```bash
npx vercel env rm INGEST_PERMITE_CLAVE_GLOBAL production
npx vercel --prod
```

Después, 15 minutos con la consulta de §7.2 y el filtro de §8.2. Lo que tiene
que verse: **nada cambia**. Mismas lecturas, mismo `modo:"credencial"`, ningún
401, ningún `Sensor sin señal` nuevo.

Si aparecen 401 → rollback de nivel 2 (§11.2), inmediato.

---

## 10. Paso 10 — Tag final. **NO EJECUTADO**

No hay despliegue final que taguear. Cuando lo haya:

```bash
git tag -a produccion-dispositivos-<fecha> <sha> -m "Estado desplegado final."
git push origin produccion-dispositivos-<fecha>
```

---

## 11. Rollback: tres niveles

### 11.1 Nivel 1 — Solo código. **El preferido**

Es el rápido y el que hay que intentar primero. Las migraciones son **aditivas**
y el código viejo **no usa** ninguna de las columnas ni tablas nuevas: `sql/01`
no menciona `dispositivos`, y los `select` del código viejo son con lista
explícita de columnas, nunca `select *`. Volver atrás el código no obliga a
tocar la base.

Desde el panel de Vercel: *Deployments → el despliegue del tag → ⋯ → Promote to
Production*. Por CLI:

```bash
npx vercel rollback                     # al despliegue de producción anterior
# o, apuntando al tag:
git checkout produccion-pre-dispositivos-2026-09-10
npx vercel --prod
```

**Qué pasa con el nodo:** el firmware no cambia, `/api/ingest` sigue en la misma
ruta, y `rele` y `alarma` siguen siendo booleanos en la raíz. El nodo no percibe
el rollback más allá de una respuesta perdida, y su failsafe cubre los 45 s.

**Qué se pierde:** las lecturas nuevas dejan de llevar `dispositivo_id`, y el
código viejo vuelve a resolver el área por `body.area`. Nada se borra.

### 11.2 Nivel 2 — Reencender el fallback

Si después del paso 9 el nodo empieza a recibir **401**:

```bash
printf '1' | npx vercel env add INGEST_PERMITE_CLAVE_GLOBAL production
npx vercel --prod
```

Es el rollback más barato de todos: no toca ni código ni datos. **Verificar
después** que las peticiones vuelven a entrar, y mirar en los logs si vuelven
como `modo:"compatibilidad"` —el fallback está actuando, hay que investigar la
credencial— o como `modo:"credencial"` —el problema era otro—.

Síntoma en el nodo mientras dure el 401: imprime `HTTP 401: DEVICE_KEY
incorrecta` en el monitor serie, **no cambia el relé**, y a los 45 s el failsafe
lo apaga. A los 90 s la vigilancia levanta `Sensor sin señal`.

### 11.3 Nivel 3 — Datos. **Último recurso**

Solo con pérdida de datos comprobada. El SQL está en
`20-migraciones-aplicadas.md` §1.4, §2.4 y §3.4, y **solo dropea lo nuevo**.
El orden importa: `08` antes que `06`, porque `08` referencia `dispositivos`.

```sql
-- Rollback de sql/08_credenciales_dispositivos.sql
drop table if exists dispositivo_credenciales;

-- Rollback de sql/07_automatizacion_areas.sql
alter table areas drop column if exists auto_temp_alta;
alter table areas drop column if exists auto_temp_baja;
alter table areas drop column if exists auto_hum_alta;
alter table areas drop column if exists auto_hum_baja;

-- Rollback de sql/06_dispositivos.sql (requiere 08 revertida antes)
drop index if exists idx_lecturas_dispositivo_hora;
alter table lecturas drop column if exists dispositivo_id;
drop table if exists dispositivos;

-- Rollback de sql/11_observabilidad.sql
drop view if exists dispositivos_ultimo_contacto;
```

**Qué se pierde:** solo información derivada. `lecturas.dispositivo` (el texto),
`lecturas.area_id` y todas las filas quedan intactas. Se pierden las
credenciales emitidas y la configuración de automatización por área.

**Correr el nivel 3 exige haber corrido antes el nivel 1**, o el código nuevo
quedaría consultando tablas que ya no existen.

> **NUNCA restaurar el respaldo completo salvo pérdida de datos comprobada.**
> Restaurar tira todo lo que entró desde el respaldo: lecturas del nodo,
> llamados atendidos, cambios de umbrales hechos desde el panel. El nivel 1
> resuelve casi todo, y es reversible en un clic.

---

## 12. Lo que esta sesión sí dejó hecho

| Archivo | Qué |
|---|---|
| `lib/registro.ts` | **nuevo** — log estructurado, sin secretos, verificado |
| `app/api/ingest/route.ts` | una línea JSON por petición en los ocho puntos terminales |
| `sql/11_observabilidad.sql` | **nuevo** — vista `dispositivos_ultimo_contacto`. Aditiva, idempotente, **sin aplicar** |
| `documents/contexto/20-migraciones-aplicadas.md` | corregido: decía que las migraciones no estaban aplicadas |
| `documents/contexto/99-deploy.md` | este runbook |
| Tag `produccion-pre-dispositivos-2026-09-10` | creado local, **sin empujar** |

`yarn lint` limpio · `yarn test` **160/160** · `yarn build` exit 0 ·
`yarn probar:ingest` **18/18** exit 0.

Efectos sobre la base de esta sesión: **+39 lecturas** de las suites, todas
identificables por cadencia; **llamados 431 → 431**, ninguno creado; ninguna
migración aplicada; ninguna configuración de área modificada de forma
permanente.

---

## 13. Para retomar: el orden corto

1. **Confirmar qué firmware tiene grabado el nodo** (§1.3). Si es el de prueba,
   volver a grabar el de producción y esperar a verlo reportar cada 10 s.
2. **Hacer el respaldo y probar que restaura** (§1.2). Sin esto no se sigue.
3. **Confirmar en Vercel el commit desplegado** y ajustar el tag si hace falta
   (§2).
4. **Confirmar en Vercel cuánto vale `INGEST_PERMITE_CLAVE_GLOBAL`** (§5.1).
5. Seguir desde el paso 5 con este documento.

Los pasos 3 y 4 del encargo ya están hechos y verificados: **no hay que
repetirlos.**
