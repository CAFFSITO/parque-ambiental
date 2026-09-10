# 13 — Matriz de permisos: ACTUAL vs OBJETIVO

Columna ACTUAL: verificada en `00-auditoria.md` §7, contra `app/` y `lib/`.
Columna OBJETIVO: decisión 10 de `10-arquitectura.md`.

**Principio rector: no se inventan permisos.** El objetivo reusa los tres
mecanismos que ya existen —`exigirSesion()`, `exigirAdmin()` y la credencial de
dispositivo— y no agrega un cuarto. Los dos únicos cambios de permiso van en el
sentido de **restringir**, no de ampliar.

---

## 1. Rutas

| Ruta | ADMIN actual | EMPLEADO actual | ADMIN objetivo | EMPLEADO objetivo | Cambio |
|---|---|---|---|---|---|
| `/` (tablero) | sí | sí | sí | sí | **ninguno** en permisos. Suma la frescura del sensor (§4) |
| `/llamados` | sí | sí | sí | sí | ninguno |
| `/movil` | sí | sí | sí | sí | ninguno |
| `/avisos` | sí | sí | sí | sí | ninguno |
| `/areas` | sí | **403** | sí | **403** | ninguno |
| `/empleados` | sí | **403** | sí | **403** | ninguno |
| `/usuarios` | sí | **403** | sí | **403** | ninguno |
| `/dispositivos` | sí | **403** | sí | **403** | **ninguno** (§3) |
| `/reportes` | sí | **403** | sí | **403** | ninguno |
| `/reportes/imprimir` | sí | **403** | sí | **403** | ninguno |
| `/login` | redirige a `/` | redirige a `/` | ídem | ídem | ninguno |
| `/api/exportar/csv` | sí | **403** | sí | **403** | ninguno |
| `/api/ingest` | credencial de dispositivo | ídem | credencial de dispositivo | ídem | el **mecanismo** cambia (clave global → credencial por dispositivo); el permiso no |
| `/api/vigilancia` | **cualquier sesión**, o `x-device-key` | **sí** (cualquier sesión) | ADMIN, o credencial de dispositivo | **403** | **se RESTRINGE** (§5) |

Guardias en el código, para referencia:

- Rutas de sesión: `exigirSesion()` en `llamados/page.tsx:34`, `movil/page.tsx:19`,
  `avisos/page.tsx:16`; `getSesion()` + `redirect` en `page.tsx:153-154` y
  `layout.tsx:43-44`.
- Rutas de administración: `exigirAdmin()` en `areas/page.tsx:24`,
  `empleados/page.tsx:29`, `usuarios/page.tsx:14`, `dispositivos/page.tsx:15`,
  `reportes/page.tsx:59`, `reportes/imprimir/page.tsx:75`, `csv/route.ts:70`.
- `exigirAdmin()` dispara `forbidden()` (`lib/auth.ts:110`), que devuelve **403
  real** y renderiza `app/forbidden.tsx`, habilitado por
  `experimental.authInterrupts` (`next.config.ts:11`).

**El proxy no cambia.** `RUTAS_PUBLICAS` sigue siendo
`["/login", "/api/ingest", "/api/vigilancia"]` (`proxy.ts:12`) y el matcher
(`proxy.ts:49-53`) tampoco se toca. Cero rutas nuevas ⇒ cero cambios en
`proxy.ts`.

---

## 2. Server Actions

### 2.1 Existentes: sin ningún cambio

| Server Action | Archivo:línea | Guardia | ADMIN | EMPLEADO | Cambio |
|---|---|---|---|---|---|
| `cerrarSesion` | `(panel)/acciones.ts:8` | ninguna | sí | sí | ninguno |
| `accionLogin` | `login/acciones.ts:25` | ninguna (es el login) | — | — | ninguno |
| `atenderLlamado` | `llamados/acciones.ts:36` | `exigirSesion()` | sí | sí | ninguno |
| `cancelarAtencion` | `llamados/acciones.ts:87` | `exigirSesion()` | sí | sí | ninguno |
| `crearLlamado` | `llamados/acciones.ts:133` | `exigirSesion()` | sí | sí | ninguno |
| `guardarSuscripcion` | `avisos/acciones.ts:38` | `exigirSesion()` | sí | sí | ninguno |
| `asegurarSuscripcion` | `avisos/acciones.ts:80` | `exigirSesion()` | sí | sí | ninguno |
| `borrarSuscripcion` | `avisos/acciones.ts:133` | `exigirSesion()` | sí | sí | ninguno |
| `cambiarSuscripcion` | `avisos/acciones.ts:160` | `exigirSesion()` | sí | sí | ninguno |
| `probarPush` | `avisos/acciones.ts:185` | `exigirSesion()` | sí | sí | ninguno |
| `cambiarTelegram` | `avisos/acciones.ts:211` | `exigirAdmin()` | sí | **403** | ninguno |
| `crearArea` | `areas/acciones.ts:109` | `exigirAdmin()` | sí | **403** | ninguno |
| `actualizarArea` | `areas/acciones.ts:132` | `exigirAdmin()` | sí | **403** | ninguno · **suma los 4 flags de automatización al payload** |
| `cambiarActivaArea` | `areas/acciones.ts:159` | `exigirAdmin()` | sí | **403** | ninguno |
| `crearEmpleado` | `empleados/acciones.ts:167` | `exigirAdmin()` | sí | **403** | ninguno |
| `actualizarEmpleado` | `empleados/acciones.ts:196` | `exigirAdmin()` | sí | **403** | ninguno |
| `cambiarEstadoEmpleado` | `empleados/acciones.ts:232` | `exigirAdmin()` | sí | **403** | ninguno |
| `crearUsuario` | `usuarios/acciones.ts:109` | `exigirAdmin()` | sí | **403** | ninguno |
| `cambiarRolUsuario` | `usuarios/acciones.ts:148` | `exigirAdmin()` | sí | **403** | ninguno |
| `cambiarActivoUsuario` | `usuarios/acciones.ts:190` | `exigirAdmin()` | sí | **403** | ninguno |
| `resetearPassword` | `usuarios/acciones.ts:216` | `exigirAdmin()` | sí | **403** | ninguno |
| `eliminarUsuario` | `usuarios/acciones.ts:245` | `exigirAdmin()` | sí | **403** | ninguno |
| `simularLectura` | `dispositivos/acciones.ts:45` | `exigirAdmin()` | sí | **403** | **guardia sin cambios**; cambia la implementación (§6) |

**Ninguna acción existente cambia de guardia.** `actualizarArea` cambia de
*payload* —recibe cuatro booleanos más— pero no de permiso: sigue siendo
`exigirAdmin()`.

### 2.2 Nuevas: todas `exigirAdmin()`

| Server Action nueva | Qué hace | Guardia | ADMIN | EMPLEADO |
|---|---|---|---|---|
| `crearDispositivo` | alta en `dispositivos`; fija `codigo` y `naturaleza` | `exigirAdmin()` | sí | **403** |
| `actualizarDispositivo` | nombre, modelo, capacidades, observaciones. **Nunca incluye `naturaleza`** | `exigirAdmin()` | sí | **403** |
| `asignarAreaDispositivo` | fija o limpia `area_id` (0 o 1 área) | `exigirAdmin()` | sí | **403** |
| `cambiarActivoDispositivo` | prende o apaga `activo` | `exigirAdmin()` | sí | **403** |
| `crearCredencial` | genera el secreto, guarda el hash, **lo muestra una sola vez** | `exigirAdmin()` | sí | **403** |
| `rotarCredencial` | marca `ROTADA` con `expira_en` y emite la nueva | `exigirAdmin()` | sí | **403** |
| `revocarCredencial` | marca `REVOCADA`, con motivo | `exigirAdmin()` | sí | **403** |

Justificación (`10-arquitectura.md` §10.2), en dos puntos:

1. **Todo esto es administración**, del mismo tipo que `/areas`, `/empleados` y
   `/usuarios`, que ya son exclusivas de ADMINISTRADOR. No se inventa un
   criterio: se aplica el vigente.
2. **Las credenciales son secretos.** Aunque el valor completo se vea una sola
   vez, la pantalla expone prefijos, estados y fechas de uso: material de
   auditoría.

`naturaleza` se fija al crear y **nunca viaja en el payload de actualización**
(`10-arquitectura.md` §9.4). Es una garantía de aplicación, no de motor, porque
`00-auditoria.md` §4.8 no pudo verificar el estado de los triggers en esta base.
Queda dicho, no disimulado.

---

## 3. Por qué `/dispositivos` sigue siendo exclusiva de ADMINISTRADOR

La pregunta del encargo era si EMPLEADO gana visibilidad de solo lectura y por
qué superficie. **La respuesta es que no gana una sección, y sí gana el dato.**

Contra la alternativa de darle `/dispositivos` en modo lectura:

| | Sección nueva o `/dispositivos` en lectura | Dato en el tablero (**elegido**) |
|---|---|---|
| Rutas nuevas | 1 | **0** |
| Cambios en `proxy.ts` | posibles | **ninguno** |
| Guardias nuevas | al menos una | **ninguna** |
| Caminos de 403 nuevos | sí | **ninguno** |
| Riesgo de exponer prefijos y estados de credenciales | sí, hay que filtrar por rol dentro de la pantalla | **no existe** |
| Responde la pregunta real del empleado | de forma indirecta, en otra pantalla | **sí, donde ya está mirando** |

La pregunta real del empleado en el campo es una sola: *"¿el sensor de mi área
está vivo, o la temperatura que veo es vieja?"*. Eso no necesita un inventario
de hardware; necesita que el dato esté donde ya mira.

---

## 4. Lo que EMPLEADO **sí** gana: frescura del sensor en el tablero

Sin cambiar un solo permiso.

**Hoy** el tablero marca "Sensor sin reportar" a los **30 minutos**
(`app/(panel)/page.tsx:17`, `MINUTOS_LECTURA_VIGENTE = 30`, usado en `:49-51`),
mientras la vigilancia declara un nodo caído a los **90 segundos**
(`lib/alertas.ts:18`, `SEGUNDOS_SIN_SENAL = 90`). **Dos umbrales distintos para
la misma pregunta**, dentro del mismo sistema — la contradicción de
`03-riesgos.md` R5.

**Objetivo:** el tablero muestra, por área, el estado del dispositivo asignado
con **el mismo umbral de 90 segundos**.

| | ACTUAL | OBJETIVO |
|---|---|---|
| Umbral en el tablero | 30 minutos | **90 segundos** |
| Umbral en la vigilancia | 90 segundos | 90 segundos |
| Umbral en `/dispositivos` | 90 segundos (`dispositivos/page.tsx:33`) | 90 segundos |
| ¿Cuántos umbrales hay en el sistema? | **dos** | **uno** |
| Permiso necesario para verlo | sesión (ya lo tiene) | **sesión (sin cambios)** |

Sale gratis por la decisión 1.6 de `10-arquitectura.md`: con
`dispositivos.ultimo_contacto_en` materializada, el tablero obtiene la frescura
leyendo una tabla de una decena de filas, sin tocar `lecturas`.

**Efecto visible que hay que avisar a quien opera:** un sensor callado 5 minutos
ahora se marca; antes había que esperar 30. Es más ruido, y es el ruido
correcto.

---

## 5. El permiso que se **restringe**: `/api/vigilancia`

### 5.1 La situación actual

`app/api/vigilancia/route.ts:12-16`:

```ts
async function autorizado(request: NextRequest): Promise<boolean> {
  const clave = process.env.DEVICE_KEY;
  if (clave && request.headers.get("x-device-key") === clave) return true;
  return (await getSesion()) !== null;
}
```

Acepta **cualquier sesión válida**, incluida la de un EMPLEADO. Y su efecto es
**escribir**: fuerza la barrida (`:27`, `revisarNodosCaidos(true)`) y crea
llamados de EMERGENCIA (`lib/alertas.ts:305-322`).

Eso desentona con el resto de la matriz, donde todo lo que escribe fuera de
llamados y avisos exige ADMINISTRADOR.

### 5.2 Verificado: restringirla no rompe nada

`grep` de `api/vigilancia` sobre `app/`, `lib/`, `public/` y `proxy.ts` devuelve
**solo tres coincidencias**, ninguna de las cuales es una llamada:

- el encabezado del propio archivo de la ruta;
- un comentario en `lib/alertas.ts:270`;
- la lista de rutas públicas de `proxy.ts:12`.

**Ningún cliente la invoca.** El tablero llama `revisarNodosCaidos()` **en
proceso** (`app/(panel)/page.tsx:159`), sin pasar por HTTP.

### 5.3 El objetivo

| | ACTUAL | OBJETIVO |
|---|---|---|
| Con credencial de dispositivo | sí (clave global) | sí (credencial por dispositivo) |
| Sesión ADMINISTRADOR | sí | sí |
| Sesión EMPLEADO | **sí** | **403** |
| Sin sesión | 401 | 401 |

**Esto no inventa un permiso: quita uno que nadie ejerce**, y lo alinea con el
patrón que el sistema ya usa para todo lo demás que escribe.

Se ejecuta en el paso 9 del plan (`11-plan-migracion.md`), junto con el apagado
del fallback global, porque las dos cosas cierran el mismo riesgo: **R2**.

---

## 6. El aislamiento del simulador **no** es un permiso

Vale aclararlo, porque es fácil confundirlo con uno.

`simularLectura` exige `exigirAdmin()` hoy (`dispositivos/acciones.ts:45`) y lo
seguirá exigiendo. **Esa guardia nunca fue el problema.**

El problema es que la acción arma la request con `dispositivo` recibido por
parámetro (`:53-54`), y `gestor.tsx:98` lo llena con
`nodoDe(simulacion.area)` — que para el área INV-N produce literalmente
`NODO-INV-N-01`, el código del nodo físico (`gestor.tsx:39-42`, y `.ino:60`).
Un administrador legítimo, haciendo exactamente lo que la pantalla ofrece,
contamina los datos del hardware real. Eso es el riesgo R1, y **ningún permiso
lo evita**: quien simula ya tiene el permiso más alto que existe.

La garantía viene del modelo, no de la autorización
(`10-arquitectura.md` §9.3):

> Una credencial pertenece a **exactamente un** dispositivo. El simulador se
> autentica con la credencial de un dispositivo `SIMULADO`, así que la lectura
> se atribuye a ese dispositivo y a ningún otro. `body.dispositivo` deja de
> decidir la identidad.
>
> **El requisito "un simulador nunca escribe bajo un código físico" se cumple
> porque no existe el camino, no porque haya un chequeo que alguien podría
> olvidar escribir.**

---

## 7. Resumen de cambios en la matriz

| # | Cambio | Dirección | Dónde |
|---|---|---|---|
| 1 | `/api/vigilancia` deja de aceptar sesión de EMPLEADO | **restringe** | `app/api/vigilancia/route.ts:12-16` |
| 2 | 7 Server Actions nuevas de dispositivos y credenciales, todas `exigirAdmin()` | agrega superficie **admin** | `dispositivos/acciones.ts` |
| 3 | `/api/ingest` pasa de clave global a credencial por dispositivo | **restringe** (atribuye) | `app/api/ingest/route.ts` |
| 4 | EMPLEADO ve la frescura del sensor en el tablero, con el umbral de 90 s | **no es un permiso**: mejora un dato que ya veía | `app/(panel)/page.tsx` |

**Ningún rol gana acceso a una ruta que hoy no tenga.** Los cambios 1 y 3
cierran el riesgo R2; el 4 cierra la contradicción de umbrales de R5; el 2
sostiene el patrón administrativo vigente.

---

## 8. Dónde se aplica el permiso: la capa de servidor de dispositivos

Agregado al escribirse `lib/dispositivos.ts` y `lib/credenciales.ts`
(ver `30-modelo-dispositivos.md`).

**Nada de la matriz cambió.** Esos módulos no crean rutas ni Server Actions: son
la capa que las siete acciones previstas en §2.2 van a usar cuando se escriban.
Esta sección deja asentado dónde tiene que estar la puerta.

### 8.1 Los módulos nuevos NO verifican rol

`lib/dispositivos.ts` y `lib/credenciales.ts` **no llaman `exigirAdmin()` ni
`exigirSesion()`**, y es deliberado: es el patrón del resto del proyecto. La
puerta está en la página y en la Server Action.

Duplicar la verificación adentro haría que ninguno de los dos lugares sea
claramente el responsable, y en la práctica lleva a que uno se relaje porque
"el otro ya chequea".

Los dos módulos son **server-only**, marcados con el comentario de cabecera
igual que `lib/db.ts`, `lib/auth.ts` y `lib/push.ts`.

### 8.2 Qué función escribe, y con qué guardia tiene que llamarse

Toda función de esta lista debe invocarse **únicamente** desde una Server Action
que ya haya llamado `exigirAdmin()`:

| Módulo | Función | Efecto |
|---|---|---|
| `lib/dispositivos.ts` | `crearDispositivo` | alta; fija `codigo` y `naturaleza` |
| | `actualizarDispositivo` | edición; **no** acepta `codigo` ni `naturaleza` |
| | `asignarArea` | asigna o desasigna el área |
| | `cambiarActivo` | baja lógica |
| | `registrarContacto` | telemetría |
| `lib/credenciales.ts` | `crearCredencial` | emite; **devuelve el secreto una vez** |
| | `rotarCredencial` | cierra las anteriores y emite |
| | `revocarCredencial` | revoca; no borra la fila |
| | `registrarUso` | telemetría |

Las de lectura (`leerDispositivos`, `resolverArea`, `ultimaLecturaDe`,
`listarCredenciales`, …) no exponen secretos: `listarCredenciales` devuelve
`CredencialPublica`, que **no incluye el hash**.

### 8.3 Las dos telemetrías son la excepción

`registrarContacto()` y `registrarUso()` están en la lista de escritura, pero en
régimen las va a llamar **`/api/ingest`**, que no tiene sesión: se autentica con
la credencial del dispositivo. Es coherente con la matriz —`/api/ingest` nunca
dependió del rol— y con `§1`, donde esa ruta se autentica por credencial y no
por sesión.

### 8.4 `autenticarDispositivo()` no es una guardia de rol

Resuelve **qué aparato** está detrás de una clave. No dice nada sobre personas
ni roles, y no reemplaza a `exigirAdmin()` en ningún lado. Es el mecanismo que,
cuando se reescriba `/api/ingest`, va a sustituir a la comparación contra la
`DEVICE_KEY` global — el cambio 3 de §7.

---

## 9. Actualización: las Server Actions de Dispositivos ya existen

**2026-09-09.** §2.2 las anticipaba como previstas. Están escritas, y se
verificó **por HTTP** que rechazan al EMPLEADO — no por inspección del código ni
porque el botón no se vea. Detalle en `60-pruebas-dispositivos.md` §2.

### 9.1 Las nueve acciones de `app/(panel)/dispositivos/acciones.ts`

Todas arrancan con `exigirAdmin()` como primera línea.

| Server Action | Qué hace | ADMIN | EMPLEADO |
|---|---|---|---|
| `crearDispositivoNuevo` | alta; fija `codigo` y `naturaleza` | sí | **403** |
| `guardarDispositivo` | edición; **no** arma `codigo` ni `naturaleza` | sí | **403** |
| `cambiarAreaDispositivo` | asigna, reasigna o desasigna (`null`) | sí | **403** |
| `cambiarActivoDispositivo` | baja y alta lógica | sí | **403** |
| `eliminarDispositivoSinLecturas` | borra, solo si tiene 0 lecturas | sí | **403** |
| `emitirCredencial` | emite; **devuelve el secreto una vez** | sí | **403** |
| `rotarCredencialDispositivo` | cierra las anteriores y emite | sí | **403** |
| `revocarCredencialDispositivo` | revoca; no borra la fila | sí | **403** |
| `simularLectura` | sin cambios respecto de antes | sí | **403** |

Los nombres difieren de los previstos en §2.2 (`crearDispositivo`,
`asignarAreaDispositivo`, …) para no colisionar con las funciones homónimas de
`lib/dispositivos.ts`, que el mismo archivo importa. El permiso es el mismo.

### 9.2 Cómo se verificó

Se firmaron dos cookies `pab_sesion` con el `JWT_SECRET` real —una de ADMIN y
una de EMPLEADO— y se invocaron **las once acciones registradas en la página**
por `POST /dispositivos` con la cabecera `Next-Action`.

Resultado: **las nueve devuelven 403 al EMPLEADO y 200 al ADMIN**. Las otras dos
son `cerrarSesion` (sin guardia, correcto) y `asegurarSuscripcion`
(`exigirSesion()`, correcto), que pertenecen a otros módulos y que un EMPLEADO
sí puede usar.

La página, además, devuelve **403 con `app/forbidden.tsx`** a una sesión de
EMPLEADO, y **307 a `/login`** sin sesión.

### 9.3 Dos reglas que se sostienen en el servidor, no en la interfaz

Se probaron mandando valores prohibidos a mano:

- **El código es inmutable.** Se envió `"codigo":"IGNORADO"` en una edición y la
  fila conservó su código. `guardarDispositivo()` no arma ese campo.
- **La naturaleza es inmutable.** Se envió `"naturaleza":"FISICO"` sobre un
  dispositivo `SIMULADO` y no cambió, por lo mismo.

Deshabilitar los campos en el formulario es una cortesía; la garantía es que la
acción no los construye.

### 9.4 `/api/ingest` no cambió de permiso

Sigue autenticándose por credencial de dispositivo, sin sesión. Lo que sí se
verificó es la consecuencia de las acciones nuevas: **desactivar un dispositivo
o revocar su credencial hace que sus reportes dejen de entrar**, sin tocar
`/api/ingest`.

---

## 10. Cierre de autorización — 2026-09-09

Las columnas ACTUAL de las secciones anteriores conservan el estado de la
auditoría inicial; no deben leerse como descripción del código posterior al
cierre. El inventario vigente y la matriz **esperado vs observado**, con las
31 Server Actions y las 10 páginas del panel, están en
`70-pruebas-permisos.md`. Se reproducen con `scripts/pruebas-permisos.mjs`.

### 10.1 Guardias y rutas

- Todas las páginas del panel comienzan por `exigirSesion()` o `exigirAdmin()`.
  Tablero y layout unifican el chequeo que antes hacían con getSesion/redirect.
- Todas las acciones protegidas comienzan por la guardia correspondiente.
  `cerrarSesion` suma `exigirSesion()`: para ambos roles sigue cerrando sesión
  y sin sesión sigue volviendo al login. Actualiza la excepción de §2.1/§9.2;
  no amplía ningún permiso.
- `accionLogin` sigue siendo pública por necesidad: exigir una sesión antes
  de iniciar sesión impediría entrar al sistema.
- `/api/vigilancia`, tanto GET como POST, acepta ADMINISTRADOR **o** credencial
  vigente de un dispositivo activo. Sesión EMPLEADO **sin credencial de
  dispositivo válida**: 403. Sin ninguno de esos mecanismos: 401. La credencial
  es una vía independiente del rol, también si la petición trae una cookie.
- Vigilancia usa `autenticarDispositivo()`, no compara contra DEVICE_KEY.
  Para el legado bcrypt, `x-device-code` solo localiza el hash: sigue siendo
  obligatorio verificar la clave. SHA-256 no necesita ese encabezado.
- `proxy.ts` no se modifica. Sus únicas rutas públicas siguen siendo `/login`,
  `/api/ingest` y `/api/vigilancia`. Ingest no exige sesión de una persona.
- Sin cambios en roles, check de usuarios.rol, payload JWT ni navegación por
  rol. EMPLEADO no gana sección de dispositivos; solo ve la frescura del sensor
  en el tablero existente con el umbral compartido de 90 segundos.

### 10.2 Propiedad de avisos y límites de datos

La regla documentada de Avisos es **suscripciones propias**, no suscripciones
de cualquier usuario. Se corrigen dos caminos que la incumplían:

- `guardarSuscripcion` ya no hace upsert que cambie el dueño de un endpoint
  existente. Inserta ignorando conflicto y actualiza filtrando por usuario_id.
- `asegurarSuscripcion` rechaza un endpoint de otra cuenta y vuelve a filtrar
  por dueño al actualizar. No reactiva una suscripción apagada por su dueño.
- `borrarSuscripcion` y `cambiarSuscripcion` conservan su filtro de usuario_id.
  Las cuatro acciones se prueban con un endpoint ajeno y se relee la fila.
- Avisos deja de enviar `auth` y `p256dh` por props. Las consultas de usuarios
  y credenciales tampoco envían hashes al navegador. Los secretos recién
  emitidos/rotados solo vuelven en la respuesta de su acción administrativa,
  una vez; esa es la excepción explícita ya aprobada en §2.2.
- `lib/db.ts` y `lib/credenciales.ts` ahora tienen `import "server-only"`, un
  límite comprobado por el compilador, no solamente el comentario de §8.1.
  El análisis de imports transitivos de los módulos cliente excluye imports
  de tipos y respeta la frontera RPC de las Server Actions.

### 10.3 Cómo interpretar las pruebas

El guion usa HTTP real de Next y registros temporales en Supabase real. Un
gateway limita los datos a esos registros para evitar que la vigilancia y los
reportes alcancen la operación; no suplanta JWT, guardias ni acciones. Los
envíos externos se deshabilitan solo en ese proceso. Las particularidades de
aislamiento, redirecciones Flight, resultados de negocio y limpieza están
explicitadas en `70-pruebas-permisos.md` junto con los resultados reales.

Esto cierra la autorización, **no el aislamiento productivo del simulador R1**,
ni certifica el despliegue remoto. El simulador de la prueba usa una credencial
temporal propia, sin tocar la credencial del nodo físico ni el firmware.
