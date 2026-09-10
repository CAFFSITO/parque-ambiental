# 60 — Pruebas de la pantalla de Dispositivos

Ejecutadas el **2026-09-09** contra el servidor local (`yarn dev`, puerto 3000),
que apunta a la base real de Supabase.

## Método: cookies firmadas, no clics

Las Server Actions no se prueban desde la pantalla: que un botón no se vea no
demuestra nada. Se invocan **directamente por HTTP**, como lo haría alguien que
no pasa por la interfaz.

Para eso hacen falta dos cosas.

**1. Sesiones reales.** Se firman dos cookies `pab_sesion` con el `JWT_SECRET`
del proyecto y el mismo algoritmo que `lib/sesion.ts` (HS256, 8 h):

```js
const admin    = await firmar({ id: 1, usuario: "admin",    rol: "ADMINISTRADOR", area_id: null });
const empleado = await firmar({ id: 2, usuario: "lbarrios", rol: "EMPLEADO",      area_id: 1 });
```

**2. Los identificadores de acción.** Next los genera al compilar. Se extraen
del manifiesto y se cruzan con el nombre de la función en el chunk del servidor:

```bash
node -e 'const m=require("./.next/dev/server/app/(panel)/dispositivos/page/server-reference-manifest.json");
         console.log(Object.keys(m.node).join(" "))'
```

Con eso, una acción se invoca así:

```bash
curl -s -X POST http://localhost:3000/dispositivos \
  -H "Cookie: pab_sesion=$TOKEN" \
  -H "Next-Action: <id>" \
  -H "content-type: application/json" \
  -d '[<argumentos>]'
```

**Cero residuo:** todo el ciclo funcional se hizo sobre un dispositivo
descartable (`SIM-PRUEBA-01`) que al final se eliminó. Los conteos volvieron
exactamente al valor previo. Ver §5.

---

## 1. Acceso a la página

| Sesión | Resultado | Verificado |
|---|---|---|
| **EMPLEADO** | **HTTP 403** | El HTML contiene "Error 403" y "No tenés permisos para acceder a esta sección" — es `app/forbidden.tsx` |
| ADMINISTRADOR | HTTP 200 | Renderiza "Crear dispositivo", `NODO-INV-N-01` y los chips "Simulado" |
| sin sesión | HTTP 307 | → `/login?desde=%2Fdispositivos` |

---

## 2. Cada Server Action, invocada como EMPLEADO

Se invocaron **las 11 acciones registradas** en la página, con las dos cookies:

| id | acción | EMPLEADO | ADMIN |
|---|---|---|---|
| `40b01d92…` | `crearDispositivoNuevo` | **403** | 200 |
| `602a17e8…` | `guardarDispositivo` | **403** | 200 |
| `60fe8b80…` | `cambiarAreaDispositivo` | **403** | 200 |
| `6046c29f…` | `cambiarActivoDispositivo` | **403** | 200 |
| `40cbc670…` | `eliminarDispositivoSinLecturas` | **403** | 200 |
| `603d33e0…` | `emitirCredencial` | **403** | 200 |
| `709f4fc0…` | `rotarCredencialDispositivo` | **403** | 200 |
| `604a58ee…` | `revocarCredencialDispositivo` | **403** | 200 |
| `4020b243…` | `simularLectura` | **403** | 200 |
| `00e158aa…` | `cerrarSesion` | 200 | 200 |
| `4000919d…` | `asegurarSuscripcion` | 200 | 200 |

**Las nueve acciones de `dispositivos/acciones.ts` rechazan al EMPLEADO.** Las
dos que no son de este archivo: `cerrarSesion` (sin guardia, cualquiera puede
cerrar su sesión) y `asegurarSuscripcion` (`exigirSesion()`, cualquiera puede
suscribir su dispositivo a los avisos). Verificado en el chunk compilado:

```
registerServerReference"])(cerrarSesion, "00e158aa…
registerServerReference"])(asegurarSuscripcion, "4000919d…
```

---

## 3. Ciclo funcional completo, como ADMINISTRADOR

### 3.1 Crear

```bash
-d '[{"codigo":"SIM-PRUEBA-01","nombre":"Nodo de prueba","modelo":"maqueta",
      "area_id":null,"naturaleza":"SIMULADO","reporta_temperatura":true,
      "reporta_humedad":true,"reporta_boton":false,"acciona_rele":true,
      "acciona_alarma":false,"observaciones":"Creado por la prueba de PROMPT 8."}]'
```

→ `{"ok":true,"mensaje":"Dispositivo SIM-PRUEBA-01 creado. Emitile una credencial…"}`

En la base:

```json
{"id":14,"codigo":"SIM-PRUEBA-01","area_id":null,"activo":true,
 "naturaleza":"SIMULADO","reporta_boton":false,"acciona_alarma":false}
```

Los cinco booleanos de capacidades entraron tal como se enviaron.

### 3.2 Editar — y la prueba de inmutabilidad

Se enviaron **a propósito** un código y una naturaleza distintos:

```bash
-d '[14,{"codigo":"IGNORADO","naturaleza":"FISICO","nombre":"Nodo de prueba editado",
      "modelo":"maqueta v2","reporta_boton":true,"acciona_alarma":true,
      "observaciones":"editado", …}]'
```

→ `{"ok":true,"mensaje":"Dispositivo actualizado."}`

En la base:

```json
{"id":14,"codigo":"SIM-PRUEBA-01","naturaleza":"SIMULADO",
 "nombre":"Nodo de prueba editado","modelo":"maqueta v2",
 "reporta_boton":true,"acciona_alarma":true,"observaciones":"editado"}
```

**El código y la naturaleza no cambiaron.** No es que el formulario los
deshabilite: `guardarDispositivo()` **no arma esos campos**, así que no hay
forma de mandarlos aunque se invoque la acción a mano. Todo lo demás sí se
actualizó.

### 3.3 Asignar, reasignar, desasignar

| Acción | Argumentos | Resultado | `area_id` en la base |
|---|---|---|---|
| Asignar | `[14, 1]` | "Área asignada. Rige desde la próxima lectura." | **1** |
| Reasignar | `[14, 5]` | ídem | **5** |
| Desasignar | `[14, null]` | "Dispositivo sin área. No va a tener umbrales ni automatización…" | **null** |

Los conteos de `lecturas` y `llamados` no se movieron en ninguno de los tres
pasos: **reasignar no toca nada histórico**.

### 3.4 Emitir credencial y reportar

```
{"ok":true,"mensaje":"Credencial emitida.","secreto":"pab_K07ClRkZ…"}   (47 caracteres)
```

`POST /api/ingest` con ese secreto, dispositivo activo y área INV-N:

```json
{"ok":true,"rele":false,"alarma":true,"area":"INV-N","llamados":[],
 "dispositivo":"SIM-PRUEBA-01","compatibilidad":false,"avisos":[]}
```

Es la **primera vez que se ejercita el camino rápido `sha256-v1` de punta a
punta**: hasta ahora solo existía la credencial heredada del nodo físico, que
usa el camino de bcrypt. El área salió de la base, no del cuerpo.

### 3.5 Desactivar → el nodo deja de poder reportar

```
{"ok":true,"mensaje":"Dispositivo dado de baja: sus lecturas dejan de guardarse
 y su relé queda apagado."}
```

`POST /api/ingest` con la **misma credencial, que sigue siendo válida**:

```json
{"ok":true,"rele":false,"alarma":false,"area":null,"llamados":[],
 "avisos":["El dispositivo está dado de baja: la lectura no se guarda."]}
```

Y en la base, el contador de lecturas del dispositivo **no subió**.

Es 200 y no 4xx a propósito: con `rele:false` el relé se apaga en el acto en vez
de esperar los 45 segundos del failsafe del nodo.

### 3.6 Reactivar

```
{"ok":true,"mensaje":"Dispositivo reactivado: vuelve a poder autenticarse."}
```

### 3.7 Rotar

Sobre un dispositivo **simulado**, así que sin ventana de gracia:

```
{"ok":true,"mensaje":"Credencial rotada. La anterior quedó revocada en el acto.",
 "secreto":"pab_PUq6x4eY…"}
```

| Secreto | `POST /api/ingest` |
|---|---|
| **viejo** | `401 {"ok":false,"error":"Clave de dispositivo inválida."}` |
| **nuevo** | `200 {"ok":true,"rele":false,"alarma":true,…}` |

En un dispositivo **físico** la pantalla rota con 48 horas de gracia, para que
haya tiempo de ir a reflashear el firmware antes de que el nodo quede afuera.

### 3.8 Revocar

```
{"ok":true,"mensaje":"Credencial revocada. El nodo que la use va a recibir 401
 y su relé se apaga por failsafe a los 45 segundos."}
```

`POST /api/ingest` con esa credencial → `401`.

Y la fila **no se borró**:

```json
[{"id":2,"estado":"REVOCADA","prefijo":"pab_K07ClRkZ","usada_en":"…T23:54:14Z"},
 {"id":3,"estado":"REVOCADA","prefijo":"pab_PUq6x4eY","usada_en":"…T23:54:33Z"}]
```

Quedan las dos como registro de auditoría, con su prefijo y su último uso. **El
hash no aparece en ninguna respuesta**: las consultas piden `COLUMNAS_PUBLICAS`,
que no lo incluye.

### 3.9 Eliminar — las dos ramas

Con lecturas registradas:

```
{"ok":false,"error":"El dispositivo tiene 2 lecturas registradas.
 Dalo de baja en vez de borrarlo: la historia no se tira."}
```

Después de borrar esas dos lecturas de prueba, sin lecturas:

```
{"ok":true,"mensaje":"Dispositivo eliminado."}
```

Las dos credenciales se fueron con él por el `on delete cascade` de
`sql/08_credenciales_dispositivos.sql`, verificado en el conteo final.

---

## 4. La pantalla sin `sql/10_dispositivos_consultas.sql`

La migración **todavía no está aplicada** (el RPC devuelve 404). La pantalla
igual funciona, y lo dice:

| Dato | Con `sql/10` | Sin `sql/10` |
|---|---|---|
| Última lectura | 1 consulta para toda la flota | 1 por dispositivo (camino de respaldo) |
| Historial de asignación | tramos por área | "Falta correr sql/10_dispositivos_consultas.sql" |
| Eliminar | se ofrece si tiene 0 lecturas | **no se ofrece**: sin el conteo no se puede afirmar que esté vacío |

Renderizado hoy, con la migración ausente: las 13 filas muestran capacidades,
última lectura y el aviso del historial; 12 de 13 muestran el chip "Sin
credencial"; el botón "Crear dispositivo" está arriba.

---

## 5. Efectos sobre la base: ninguno

| | Antes | Después |
|---|---|---|
| `lecturas` | 5 693 | **5 693** |
| `llamados` | 431 | **431** |
| `dispositivos` | 13 | **13** |
| `dispositivo_credenciales` | 1 | **1** |

El dispositivo de prueba se eliminó con la propia acción, y sus dos lecturas se
borraron a mano antes —eran filas creadas por esta prueba, no datos del parque—.
La única credencial que queda es la heredada de `NODO-INV-N-01`.

Ningún dispositivo real cambió de estado, de área ni de credencial.

---

## 6. Lo que no se probó

- **La pantalla con `sql/10` aplicada.** El historial de asignación y el camino
  rápido de última lectura están escritos y degradan bien, pero no se vieron
  con la función presente.
- **El navegador.** Todo se probó por HTTP. El renderizado del HTML se verificó
  buscando los textos esperados, no abriendo la página.
- **El simulador.** Quedó tal como estaba, incluido el nombre de nodo derivado
  del área, que es el riesgo R1. Se rehace en la etapa siguiente.
