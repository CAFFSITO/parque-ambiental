# 80 — El simulador, aislado

Fecha: **2026-09-10**. Cierra el riesgo **R1** de `03-riesgos.md` e implementa la
decisión 9 de `10-arquitectura.md`.

Todo lo que sigue está verificado contra el sistema corriendo, con la base real.
Donde algo quedó sin verificar o quedó pendiente, se dice.

---

## 1. El defecto que se elimina

`app/(panel)/dispositivos/gestor.tsx` tenía:

```tsx
/** Nombre de nodo que se le propone al simulador para cada área. */
function nodoDe(codigo: string): string {
  return `NODO-${codigo}-01`;
}
```

Elegir el área **INV-N** en el desplegable producía literalmente
`NODO-INV-N-01`, que es el identificador grabado en el firmware del nodo físico
(`firmware/produccion_parque/produccion_parque.ino:60`). Esa cadena viajaba como
texto libre a `simularLectura()`, que la posteaba a `/api/ingest` con la
`DEVICE_KEY` global.

**`nodoDe()` no existe más.** Un `grep` sobre el árbol no devuelve ninguna
coincidencia.

---

## 2. Qué se hizo

| Archivo | Estado |
|---|---|
| `app/(panel)/diagnostico/page.tsx` | **nuevo** — carga solo dispositivos `SIMULADO` |
| `app/(panel)/diagnostico/gestor.tsx` | **nuevo** — el simulador y la respuesta cruda del servidor |
| `app/(panel)/diagnostico/acciones.ts` | **nuevo** — `simularLectura()`, con `exigirAdmin()` |
| `lib/simulador.ts` | **nuevo** — la credencial efímera del simulador |
| `app/(panel)/dispositivos/gestor.tsx` | simulador **quitado**; queda un enlace a `/diagnostico` |
| `app/(panel)/dispositivos/acciones.ts` | `simularLectura()` **quitada**; ya no hay ninguna acción que escriba lecturas |
| `app/(panel)/layout.tsx` | ítem **Diagnóstico**, solo en `NAV_ADMINISTRADOR` |
| `app/(panel)/componentes/iconos.tsx` | ícono `diagnostico` nuevo, del mismo trazo que la familia |
| `app/(panel)/page.tsx` | el tablero marca como **Simulado** el sensor y la lectura |
| `app/(panel)/reportes/page.tsx` | leyenda de la decisión de §5 |
| `lib/credenciales.ts` | `crearCredencial()` acepta `expiraEn` |
| `lib/alertas.ts` | la vigilancia solo mira dispositivos **físicos y activos** |
| `app/api/ingest/route.ts` | `lecturas.dispositivo` guarda el código **resuelto**, no el declarado |

Los dos últimos no estaban en el encargo. Están explicados y justificados en §4
y §6: sin ellos el trabajo quedaba incompleto de una forma que se puede medir.

**No se creó ninguna migración SQL.** No hizo falta: la columna `naturaleza` de
`sql/06_dispositivos.sql` y la tabla `dispositivo_credenciales` de `sql/08`
—ambas ya aplicadas— son toda la estructura que esto necesita.

### 2.1 Sobre la ubicación de la pantalla

`10-arquitectura.md` §9.5 recomendaba mantener el simulador dentro de
`/dispositivos`, partida en dos secciones, y agregaba: *"Mover la página sería
aceptable; no mover la naturaleza a la credencial, no."*

Se movió a `/diagnostico`, que es lo que pidió esta etapa. Son dos tareas
distintas —administrar la flota y ejercitar el sistema— y mezclarlas hacía que
la pantalla de inventario tuviera un formulario que escribe datos.

**Esto es una decisión de interfaz, no un control de seguridad**, y está dicho
con todas las letras en el encabezado de `diagnostico/page.tsx` para que nadie
lo confunda. El aislamiento lo dan §3 y §4.

---

## 3. La regla, y por qué no se puede olvidar de aplicar

> El simulador solo puede escribir bajo la identidad de un dispositivo cuya
> naturaleza sea `SIMULADO`.

Se aplica en el **servidor**, en tres capas que no dependen una de otra:

**Capa 1 — la Server Action.** `simularLectura()` recibe un `dispositivoId`
numérico, nunca un código. Lee la fila de la base y corta con un mensaje
explícito si `naturaleza === "FISICO"`. Ninguna cadena de texto del navegador
termina siendo la identidad de una lectura.

**Capa 2 — la credencial.** `lib/simulador.ts` es el único módulo que fabrica
la credencial del simulador, y no emite credenciales de dispositivos físicos.
La regla vive también ahí, así acompaña a cualquier llamador futuro.

**Capa 3 — `/api/ingest`.** Desde la etapa anterior, la identidad la determina
la **credencial**, no el cuerpo (`12-contrato-ingest-objetivo.md` §8). Una
credencial pertenece a exactamente un dispositivo
(`dispositivo_credenciales.dispositivo_id` es `not null` y escalar), así que la
lectura se atribuye a ese dispositivo y a ningún otro.

La tercera es la que convierte la regla en garantía: **no se cumple porque
alguien se acordó de validar, se cumple porque no existe el camino.** Está
verificada por HTTP en §7, prueba 3.

---

## 4. La credencial del simulador

`10-arquitectura.md` §9.3 proponía una variable de entorno nueva
(`SIMULADOR_CLAVE`) con el secreto de la credencial del simulado.

**Se resolvió distinto, y conviene decir por qué.** Una variable de entorno es
un secreto para toda la flota simulada: o hay uno solo —y entonces no se sabe
cuál de los simulados escribió— o hay que sumar una variable por dispositivo y
mantenerlas a mano sincronizadas con la base. Ninguna de las dos cosas es buena.

Lo que hace `lib/simulador.ts`:

1. La primera simulación de un dispositivo **emite una credencial `sha256-v1`
   propia de ese dispositivo**, con vencimiento de **15 minutos**, y guarda el
   secreto en una variable de módulo.
2. Las simulaciones siguientes reusan ese secreto mientras siga vigente, así
   una demostración entera no deja una fila de credencial por clic.
3. Al vencer se revoca la anterior y se emite otra.

El secreto **no se persiste**: vive en el valor de retorno y en la memoria del
proceso. Nunca viaja al navegador —la pantalla muestra el prefijo— y no se
escribe en ningún log.

### 4.1 Por qué el vencimiento, y no solo la revocación

La caché es una variable de módulo. En serverless es best-effort, igual que el
rate limit de `revisarNodosCaidos()` (`lib/alertas.ts`). Si el proceso muere, el
secreto se pierde y **nadie va a revocar esa fila nunca**: quedaría una
credencial `ACTIVA` que ya nadie tiene.

Con `expira_en` la credencial huérfana deja de verificar sola. Esto se observó
en vivo durante las pruebas: al reiniciar el servidor, la credencial `id 27`
quedó `ACTIVA` con `expira_en = 14:03`, sin que nadie la tuviera, y venció sola.
Es exactamente el caso para el que se agregó el campo.

Por eso `crearCredencial()` acepta ahora `expiraEn`. Es aditivo: por omisión no
hay vencimiento, que es lo que corresponde a la credencial de un aparato.

### 4.2 La `DEVICE_KEY` global no sale más del servidor por este camino

El simulador ya no la lee. Como efecto lateral queda desacoplado del apagado del
fallback global (`10-arquitectura.md` §6.3): va a seguir funcionando después de
que `INGEST_PERMITE_CLAVE_GLOBAL` se apague para siempre.

### 4.3 R12 queda acotado, no cerrado

El simulador se sigue auto-invocando por HTTP. La URL ahora se toma, en este
orden, de `SIMULADOR_BASE_URL`, `NEXT_PUBLIC_SITE_URL`,
`VERCEL_PROJECT_PRODUCTION_URL` y recién al final de la cabecera `host`. Con
cualquiera de las tres primeras definidas, la cabecera deja de participar.

Lo que cambió de fondo: si alguien manipulara el `Host`, lo que se filtraría ya
no es la clave del nodo físico sino una credencial efímera de un dispositivo
simulado, que vence en 15 minutos y no abre nada más.

---

## 5. Decisión: las lecturas simuladas **sí** entran en el tablero y en los reportes

Es la decisión que el encargo pedía tomar y dejar por escrito.

**Entran, y en las dos pantallas se dice que son simulación.**

Las tres razones, en orden de peso:

1. **Excluirlas vaciaría los reportes.** De los 14 dispositivos registrados hoy,
   **13 son `SIMULADO`**, y prácticamente toda la serie histórica de `lecturas`
   es de ellos. Un `reporte_clima_por_dia()` que los filtrara devolvería una
   curva casi vacía. Eso no sería un reporte más honesto: sería un reporte
   inservible.
2. **El tablero tiene que mostrarlas o se contradice con la base.** Un área
   cuyo único sensor es simulado aparecería "sin lecturas" mientras la tabla
   tiene filas frescas de esa área. Sería una pantalla mintiendo sobre su propio
   dato.
3. **El problema de R1 era la atribución, no la existencia.** Antes no se podía
   saber qué fila era simulada; ahora cada lectura tiene `dispositivo_id` y cada
   dispositivo tiene `naturaleza`. Separarlas es una consulta:

```sql
select d.naturaleza, count(*), min(l.tomada_en), max(l.tomada_en)
  from lecturas l
  join dispositivos d on d.id = l.dispositivo_id
 group by d.naturaleza;
```

### 5.1 Dónde lo dice la interfaz

| Pantalla | Cómo se marca |
|---|---|
| **Tablero** | chip **Simulado** en la fila del área cuando su sensor es simulado, y otro junto al "Dispositivo de la lectura" cuando la lectura mostrada la escribió un simulado |
| **Dispositivos** | chip **Simulado** en la fila, y "Simulado — no corresponde a ningún aparato" en la ficha |
| **Áreas** | chip **Simulado** por dispositivo asignado, en la ficha del área |
| **Diagnóstico** | la pantalla entera es de simulación, y lo dice en el encabezado |
| **Reportes** | leyenda fija: los promedios de clima incluyen lecturas simuladas, y se pueden separar por naturaleza |

### 5.2 Cómo se revierte esta decisión, si alguna vez conviene

Agregando un parámetro `p_naturaleza` a `reporte_clima_por_dia()` en una
migración nueva y aditiva, con `join dispositivos`. No hace falta tocar ninguna
fila ni ninguna otra función. Hoy no se hace porque el resultado sería un
gráfico vacío, no porque sea difícil.

---

## 6. Dos cambios que el encargo no pedía

Se hacen explícitos porque tocan archivos fuera de la lista.

### 6.1 La vigilancia deja de mirar los simulados

`lib/alertas.ts`, `revisarNodosCaidos()`, ahora filtra por dispositivos con
`naturaleza = 'FISICO'` **y** `activo = true`.

**Sin esto, el simulador rompía el sistema al usarlo.** Cada simulación dejaba
al dispositivo simulado "reportando"; noventa segundos después, la barrida lo
declaraba caído y creaba un llamado de **EMERGENCIA** por un nodo que no existe.
Una demostración generaba una falsa emergencia.

Es además la regla que `10-arquitectura.md` §9.4 ya había aprobado como
acompañante de esta etapa: *"Un simulador que deja de simular no es una
emergencia."*

Si la consulta de la flota física falla, **no se crea ningún llamado**: sin esa
lista no se puede distinguir un nodo real de una simulación, y crear
emergencias a ciegas es peor que no crearlas. "No sé" es "no", el mismo criterio
que `eliminarDispositivo()`.

### 6.2 `lecturas.dispositivo` guarda el código resuelto

Esto salió de una prueba, y es el hallazgo más importante de la etapa.

`/api/ingest` atribuía correctamente `dispositivo_id` a partir de la credencial,
pero guardaba en `lecturas.dispositivo` **el texto que el cuerpo declaraba**, sin
verificarlo. Con una credencial de un dispositivo simulado y un cuerpo que
dijera `"dispositivo": "NODO-INV-N-01"`, la fila quedaba así:

```
id 5720 | dispositivo "NODO-INV-N-01" | dispositivo_id 37 (SIM-INV-N)
```

Por qué importa: **`lecturas.dispositivo` es la columna por la que agrupa
`estadoDeNodos()`** (`lib/alertas.ts`). Una fila con ese texto **mantiene "vivo"
al nodo físico en la vigilancia aunque esté apagado** — que es literalmente el
efecto combinado de R1 y R10 descrito en `03-riesgos.md`. Y además rompía el
invariante que `20-migraciones-aplicadas.md` §1.3 (d) verifica: que el texto y
el código del dispositivo vinculado coincidan siempre.

Ahora se guarda el código **resuelto**. El declarado no se pierde: si difiere,
queda en los `avisos` de la respuesta y en el log del servidor, que es donde
corresponde auditar una discrepancia. Es el mismo tratamiento que ya recibía el
área declarada.

Verificado antes y después del arreglo en §7, prueba 3.

---

## 7. Pruebas

Ejecutadas el **2026-09-10**, contra `next start` en `localhost:3210` con la
base real. Las Server Actions se invocaron **por HTTP**, con el encabezado
`Next-Action` y cookies `pab_sesion` firmadas con el `JWT_SECRET` real, que es
como las invoca el navegador.

Antes de las pruebas se creó `SIM-INV-N` (id **37**, área INV-N, `SIMULADO`,
activo), que era uno de los pendientes anotados en `30-modelo-dispositivos.md`
§12.6.

**Línea de base**, `2026-09-10T13:47Z`:

| | |
|---|---|
| Última lectura del nodo físico | id **5716**, `2026-09-10T02:59:05Z` |
| Lecturas con `dispositivo_id = 11` (NODO-INV-N-01) | **299** |
| Credenciales en la base | 1 (bcrypt heredada del nodo físico) |
| Llamados | 431 |

El nodo físico estaba **apagado** desde las 02:59, once horas antes: cualquier
lectura nueva suya durante la ventana de prueba habría sido atribuible al
simulador y se habría visto.

### Prueba 1 — simular contra un dispositivo simulado

`simularLectura({ dispositivoId: 37, temperatura: 33, humedad: 45 })` como
ADMINISTRADOR:

```json
{
  "ok": true,
  "estado": 200,
  "llamado": {
    "metodo": "POST",
    "url": "http://localhost:3210/api/ingest",
    "cabeceras": {
      "content-type": "application/json",
      "x-device-key": "pab_rzJbDl4H… (credencial de SIM-INV-N)"
    },
    "cuerpo": "{\"dispositivo\":\"SIM-INV-N\",\"temperatura\":33,\"humedad\":45,\"boton\":\"NINGUNO\"}"
  },
  "respuesta": {
    "ok": true, "rele": true, "alarma": true, "area": "INV-N",
    "llamados": [
      { "motivo": "Temperatura por encima del umbral", "tipo": "EMERGENCIA", "resultado": "actualizado" },
      { "motivo": "Humedad por debajo del umbral",     "tipo": "EMERGENCIA", "resultado": "actualizado" }
    ],
    "dispositivo": "SIM-INV-N",
    "compatibilidad": false,
    "avisos": ["Actuador encendido por: Temperatura por encima del máximo, Humedad por debajo del mínimo."]
  }
}
```

**200**, se ve el llamado HTTP generado (con la clave enmascarada al prefijo) y
se ven los dos llamados que el servidor creó. `compatibilidad: false` confirma
que **no** se usó la clave global.

Segunda corrida con `boton: "EMERGENCIA"` y magnitudes en rango: `rele: false`,
`alarma: true`, un solo llamado, `Botón de emergencia accionado`.

### Prueba 2 — simular con la identidad de un dispositivo físico

Tres variantes, todas rechazadas **por el servidor**:

| Intento | Resultado |
|---|---|
| `dispositivoId: 11` (NODO-INV-N-01) | `ok: false` — *"Rechazado por el servidor: NODO-INV-N-01 es un dispositivo FÍSICO. El simulador no puede escribir bajo la identidad de hardware real…"* |
| `dispositivoId: 37` + `dispositivo: "NODO-INV-N-01"` inyectado en el cuerpo | `ok: true`, pero el campo inyectado se **descarta**: el cuerpo que salió fue `{"dispositivo":"SIM-INV-N",…}` y la atribución fue `SIM-INV-N` |
| `dispositivoId: 99999` | `ok: false` — *"Ese dispositivo no existe."* |

La segunda es la que importa: el cuerpo lo arma el servidor con la fila de la
base, no con lo que llegó del navegador.

### Prueba 3 — la tercera capa, sin pasar por la pantalla

Se emitió a mano una credencial `sha256-v1` de `SIM-INV-N` y se posteó
directamente a `/api/ingest` con un cuerpo que **miente**:

```
POST /api/ingest
x-device-key: <credencial de SIM-INV-N>
{"dispositivo":"NODO-INV-N-01","area":"INV-N","temperatura":22,"humedad":70}
```

| | Antes del arreglo de §6.2 | Después |
|---|---|---|
| `dispositivo` atribuido en la respuesta | `SIM-INV-N` | `SIM-INV-N` |
| Fila escrita | id 5720 · texto `NODO-INV-N-01` · `dispositivo_id` **37** | id 5721 · texto **`SIM-INV-N`** · `dispositivo_id` 37 |

La credencial de prueba se revocó al terminar.

### Prueba 4 — verificación por SQL

Sobre las lecturas posteriores al corte (`id > 5716`):

```
id 5717 | SIM-INV-N     | dispositivo_id 37 | 33 °C · 45 %
id 5718 | SIM-INV-N     | dispositivo_id 37 | 33 °C · 45 %
id 5719 | SIM-INV-N     | dispositivo_id 37 | 21 °C · 70 %
id 5720 | NODO-INV-N-01 | dispositivo_id 37 | 22 °C · 70 %   <- prueba 3, ANTES del arreglo
id 5721 | SIM-INV-N     | dispositivo_id 37 | 22 °C · 70 %   <- prueba 3, DESPUÉS
id 5722 | SIM-INV-N     | dispositivo_id 37 | 21 °C · 70 %
id 5723 | SIM-INV-N     | dispositivo_id 37 | 21 °C · 70 %
```

| Comprobación | Resultado |
|---|---|
| Lecturas nuevas con `dispositivo_id = 11` | **0** |
| Total histórico del nodo físico | **299**, sin cambios |
| Última lectura del nodo físico | id **5716**, sin cambios |
| Lecturas nuevas con texto `NODO-INV-N-01` | **1** — la fila 5720, escrita a mano por la prueba 3 antes del arreglo |

**Ninguna lectura quedó atribuida al nodo físico.** La fila 5720 lleva el texto
viejo pero está correctamente vinculada al dispositivo 37; es la evidencia del
defecto de §6.2 y no se pudo producir de nuevo después del arreglo.

> **Pendiente para quien opere la base.** La fila 5720 es una fila de prueba con
> un texto engañoso. No se borró —las lecturas no se tiran— ni se editó por
> cuenta propia. Corregirla es una sentencia:
>
> ```sql
> update lecturas set dispositivo = 'SIM-INV-N'
>  where id = 5720 and dispositivo_id = 37;
> ```

### Prueba 5 — sesión de EMPLEADO

| | ADMINISTRADOR | EMPLEADO | sin sesión |
|---|---|---|---|
| `GET /diagnostico` | **200**, ve el simulador | **403** | **307** → `/login?desde=%2Fdiagnostico` |
| `POST` de `simularLectura` | **200**, `ok: true` | **403**, la acción **no se ejecuta** | **307** → `/login` |
| Ítem "Diagnóstico" en la navegación | aparece | **no aparece** | — |

El 403 del EMPLEADO lo devuelve `exigirAdmin()` → `forbidden()`, y renderiza
`app/forbidden.tsx`. Que el ítem no esté en el menú es cosmético: la puerta es
la de la Server Action.

### Prueba 6 — la vigilancia no inventa emergencias

`GET /api/vigilancia` después de simular:

```json
{"ok":true,"umbral_segundos":90,"revisados":3,"caidos":1,"creados":0,"actualizados":1}
```

El único caído es el **nodo físico**, apagado desde las 02:59, y su llamado se
actualizó en vez de duplicarse (antirrebote). Llamados totales: **431 antes y
431 después**. Llamados con `creado_por = 'SIM-INV-N'`: **ninguno**.

### Prueba 7 — el resto del panel

`yarn build` exit 0 · `yarn lint` sin hallazgos · `yarn test` **88 tests en
verde**, 3 archivos.

`/`, `/dispositivos`, `/diagnostico`, `/reportes`, `/areas` y `/llamados`
responden 200 como ADMINISTRADOR. El chip **Simulado** aparece en el tablero
—también con sesión de EMPLEADO— y en Dispositivos.

---

## 8. Lo que esta etapa NO hizo

- **No borró ninguna lectura simulada.** Las 5 703 filas previas siguen enteras.
- **No tocó `sql/`.** No hizo falta ninguna migración.
- **No cerró R12.** Lo acotó (§4.3).
- **No arregló R10.** `estadoDeNodos()` sigue barriendo `lecturas` en una
  ventana de 24 horas y sigue trayendo las filas para agrupar en memoria. El
  filtro por naturaleza se aplica después de esa barrida.
- **No arregló R8.** La alarma sigue siendo por área: `alarma: true` en las
  respuestas de §7 viene de emergencias abiertas de INV-N, en su mayoría
  sembradas.
- **No actualizó `20-migraciones-aplicadas.md`,** que sigue diciendo que `06`,
  `07` y `08` no fueron aplicadas. **Sí lo fueron**: la tabla `dispositivos`
  tiene 14 filas, `dispositivo_credenciales` existe y `sql/10` está aplicada
  (sus dos funciones responden). Ese documento quedó desactualizado y conviene
  corregirlo en la etapa que lo tome.
- **No hay tests automatizados de `lib/simulador.ts`.** Sus dos verificaciones
  puras —naturaleza y estado activo— son las mismas que ya cubren
  `tests/dispositivos.test.ts` sobre `esFisico()` y `puedeOperar()`, pero el
  ciclo de vida de la credencial efímera se probó a mano, no con vitest.

---

## 9. Invariantes que esta etapa agrega

Suman a las de `30-modelo-dispositivos.md` §4 y §12.4.

**I-16. El simulador no puede escribir bajo la identidad de un dispositivo
físico.** Tres capas independientes (§3), y la tercera lo vuelve estructural.

**I-17. El simulador no usa la `DEVICE_KEY` global.** Usa una credencial propia
del dispositivo simulado, con vencimiento.

**I-18. El secreto del simulador no se persiste ni sale del servidor.** La
pantalla muestra el prefijo; el secreto vive en memoria del proceso.

**I-19. `lecturas.dispositivo` siempre coincide con el código del dispositivo
vinculado.** El texto declarado no decide nada; una discrepancia queda en los
avisos y en el log.

**I-20. Un dispositivo simulado se muestra marcado como simulación en toda
pantalla donde aparezca.** Ver la tabla de §5.1.

**I-21. Un simulador que deja de simular no genera una emergencia.** La
vigilancia solo mira dispositivos físicos y activos.
