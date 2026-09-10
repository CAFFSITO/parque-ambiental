# 30 — Modelo de dispositivos y credenciales

Capa de servidor construida sobre `sql/06`, `sql/07`, `sql/08` y `sql/09`.

> **Nota de vigencia.** Este documento se escribió cuando la capa todavía no
> estaba conectada a nada. Ya lo está: `/api/ingest` identifica el dispositivo
> por su credencial y resuelve el área desde la base (ver
> `12-contrato-ingest-objetivo.md` §8), y `/dispositivos` es una pantalla de
> administración real (ver **§12**, al final). Las secciones 1 a 11 describen la
> capa de servidor, que sigue siendo válida.

Archivos: `lib/dispositivos.ts`, `lib/credenciales.ts`,
`scripts/sembrar-credencial.js`, `tests/dispositivos.test.ts`,
`tests/credenciales.test.ts`.

---

## 1. Dos capas, a propósito

Cada módulo está partido en dos:

- **Decisiones puras** — reciben filas ya leídas y devuelven el resultado. Sin
  base de datos, sin red, sin reloj implícito (el `ahora` es un parámetro con
  default).
- **Acceso a datos** — consultas y escrituras, que delegan la decisión en las
  funciones puras.

No es prolijidad: es lo que hace que los tests valgan algo. Probar
`resolverAcceso()` con una credencial revocada verifica la regla. Probar la
misma regla contra un cliente de Supabase simulado solo verificaría que el
simulacro coincide consigo mismo.

---

## 2. API pública de `lib/dispositivos.ts`

### 2.1 Decisiones puras

| Función | Firma | Qué decide |
|---|---|---|
| `segundosSinReportar` | `(ultimoContacto, ahora?) => number \| null` | Segundos desde el último reporte. `null` si nunca reportó o si la fecha es ilegible. Recorta en cero un reporte con fecha futura |
| `estadoDeConexion` | `(ultimoContacto, ahora?) => EstadoConexion` | `EN_LINEA` \| `SIN_SENAL` \| `NUNCA_REPORTO` |
| `estaEnLinea` | `(ultimoContacto, ahora?) => boolean` | Atajo. Un nodo que nunca reportó **no** está en línea |
| `puedeOperar` | `(dispositivo) => boolean` | `activo === true` |
| `esFisico` | `(dispositivo) => boolean` | `naturaleza === "FISICO"` |
| `decidirArea` | `(dispositivo, area \| null) => ResolucionArea` | `CON_AREA` \| `SIN_AREA` \| `AREA_INEXISTENTE` |
| `conEstado` | `(dispositivo, ahora?) => DispositivoConEstado` | Agrega `conexion` y `segundos_sin_reportar` |
| `normalizarCodigo` | `(texto) => string` | Recorta bordes y largo. **No cambia mayúsculas** |
| `codigoValido` | `(codigo) => boolean` | Mismo criterio que el `check` de `sql/06` |

### 2.2 Acceso a datos

| Función | Devuelve | Nota |
|---|---|---|
| `leerDispositivos()` | `Dispositivo[]` | Ordenados por código. Devuelve vacío si falta `sql/06` |
| `leerDispositivosConEstado(ahora?)` | `DispositivoConEstado[]` | Lo que consumen las pantallas |
| `leerDispositivo(id)` | `Dispositivo \| null` | — |
| `buscarPorCodigo(codigo)` | `Dispositivo \| null` | Lo usa el camino de la credencial heredada |
| `resolverArea(dispositivo)` | `ResolucionArea` | Trae el área **con sus cuatro flags de automatización** |
| `ultimaLecturaDe(dispositivoId)` | `Lectura \| null` | Por `idx_lecturas_dispositivo_hora` |
| `crearDispositivo(entrada)` | `{ok, dispositivo}` \| `{ok:false, error}` | Fija `codigo` y `naturaleza` |
| `actualizarDispositivo(id, cambios)` | `{ok}` \| `{ok:false, error}` | **No acepta `codigo` ni `naturaleza`** |
| `asignarArea(id, areaId \| null)` | `{ok}` \| `{ok:false, error}` | `null` es válido |
| `cambiarActivo(id, activo)` | `{ok}` \| `{ok:false, error}` | Baja lógica, no borra |
| `registrarContacto(id, momento?)` | `boolean` | Telemetría. Nunca lanza |

---

## 3. API pública de `lib/credenciales.ts`

### 3.1 Secretos y hashes

| Función | Firma | Nota |
|---|---|---|
| `generarSecreto()` | `=> { secreto, prefijo, hash }` | 32 bytes aleatorios, prefijo `pab_`, base64url |
| `hashSha256(secreto)` | `=> string` | Hex de 64. **Sin sal**, a propósito |
| `hashBcrypt(secreto)` | `=> string` | 10 rondas. Solo para el secreto heredado |

### 3.2 Decisiones puras

| Función | Firma | Qué decide |
|---|---|---|
| `motivoNoVigente` | `(credencial, ahora?) => MotivoRechazo \| null` | `null` si sirve |
| `credencialVigente` | `(credencial, ahora?) => boolean` | Atajo |
| `resolverAcceso` | `(dispositivo, credencial, ahora?) => ResolucionAcceso` | La regla completa |
| `aPublica` | `(fila) => CredencialPublica` | Quita el hash |

### 3.3 Autenticación y administración

| Función | Devuelve | Nota |
|---|---|---|
| `autenticarDispositivo(clave, codigoDeclarado?, ahora?)` | `ResolucionAcceso` | Camino rápido, después heredado |
| `listarCredenciales(dispositivoId)` | `CredencialPublica[]` | Sin hash |
| `crearCredencial(dispositivoId, usuario, opciones?)` | `{ok, emitida}` \| `{ok:false, error}` | **El secreto viene una sola vez** |
| `rotarCredencial(dispositivoId, usuario, opciones?)` | ídem | Cierra las anteriores y emite una nueva |
| `revocarCredencial(id, usuario, motivo?)` | `{ok}` \| `{ok:false, error}` | No borra la fila |
| `registrarUso(id, momento?)` | `boolean` | Telemetría. Nunca lanza |

---

## 4. Invariantes

**I-1. El secreto se ve una sola vez.** Sale en el valor de retorno de
`crearCredencial()` y `rotarCredencial()`, y en ningún otro lado. No se
persiste, no se puede volver a consultar y no se escribe en ningún log.

**I-2. El hash no sale del módulo.** Las funciones públicas seleccionan
`COLUMNAS_PUBLICAS`, que no incluye `secreto_hash`. No es una promesa: la
columna no se pide. `aPublica()` es una red de seguridad, no la defensa
principal.

**I-3. Revocar no borra.** La fila revocada queda con `revocada_en`,
`revocada_por` y `motivo`. Es el registro de auditoría.

**I-4. Una credencial revocada no verifica nunca**, sin importar fechas ni
estado del dispositivo.

**I-5. Un dispositivo inactivo no autentica.** Aunque su credencial esté
perfecta. Dar de baja un aparato lo saca de servicio de verdad.

**I-6. La naturaleza no se cambia.** `actualizarDispositivo()` no arma el campo,
así que no hay forma de mandarlo. Es una garantía **de aplicación**, no de
motor: un trigger `before update` sería más fuerte y queda anotado como refuerzo
posible, pendiente de confirmar que esta base soporte triggers
(`00-auditoria.md` §4.8 no lo pudo verificar).

**I-7. El código no se edita desde el panel.** Está grabado en el firmware;
cambiarlo dejaría al aparato sin identidad hasta que alguien lo reflashee.

**I-8. Estos módulos no verifican roles.** Ver §7.

---

## 5. Ciclo de vida de una credencial

```
                        crearCredencial()
                               │
                               ▼
                          ┌─────────┐
              ┌───────────│ ACTIVA  │───────────┐
              │           └─────────┘           │
              │                │                │
   rotar(gracia > 0)    rotar(gracia = 0)   revocar()
              │           o expira_en           │
              ▼                │                ▼
         ┌─────────┐           │          ┌──────────┐
         │ ROTADA  │           └─────────▶│ REVOCADA │
         └─────────┘                      └──────────┘
              │                                 ▲
              │ vence expira_en                 │
              └────────────── revocar() ────────┘
```

Reglas de verificación:

| Estado | `expira_en` | ¿Verifica? |
|---|---|---|
| `ACTIVA` | `null` | **sí** |
| `ACTIVA` | futuro | **sí** |
| `ACTIVA` | pasado | no — `CREDENCIAL_VENCIDA` |
| `ROTADA` | futuro | **sí** — es la ventana de gracia |
| `ROTADA` | pasado | no — `CREDENCIAL_VENCIDA` |
| `ROTADA` | `null` | no — `CREDENCIAL_VENCIDA` |
| `REVOCADA` | cualquiera | **nunca** — `CREDENCIAL_REVOCADA` |

`ROTADA` sin vencimiento se trata como vencida a propósito: una rotación sin
fecha de corte no es una ventana de gracia, es una credencial vieja que quedó
suelta.

### 5.1 Rotación: el default y la excepción

`rotarCredencial()` **revoca la anterior en el acto** por omisión. Es lo
correcto cuando el secreto se filtró, o cuando quien rota puede reflashear el
aparato ahí mismo.

`graciaSegundos > 0` abre una ventana: la anterior pasa a `ROTADA` con
vencimiento y sigue sirviendo hasta que expire.

Esa excepción existe por un caso concreto: el nodo físico tiene el secreto
grabado y no se puede cambiar sin ir hasta el invernadero. **Rotar sin ventana
lo deja mudo en el acto**, y por el contrato del firmware
(`02-contrato-firmware.md` §5.1) un 401 no rearma el failsafe: el relé se apaga
recién a los 45 segundos y el botón pendiente se reintenta cada 10.

Quien rote la credencial de un dispositivo físico debería usar la ventana.

---

## 6. Autenticación: los dos caminos

```
x-device-key
   │
   ├─ 1. RÁPIDO: sha256(clave) → búsqueda por índice único parcial
   │      El cuerpo de la petición NO participa.
   │      Es el camino de todo secreto generado por el sistema.
   │
   └─ 2. HEREDADO: solo si el rápido falló Y hay código declarado
          buscarPorCodigo(codigo) → credenciales bcrypt-v1 → compare
          Es el camino del nodo que todavía tiene la clave vieja grabada.
          Desaparece cuando se reflashee.
```

**El orden no es negociable.** Durante la transición, la clave del nodo va a ser
al mismo tiempo su credencial y la vieja `DEVICE_KEY` global. Si el fallback
global se probara primero, el nodo seguiría entrando como anónimo y la migración
no habría servido de nada.

El camino heredado está acotado por construcción: solo se intenta si el rápido
falló, y solo hay un dispositivo con credencial `bcrypt-v1`. Un bcrypt cada diez
segundos es alrededor del 1 % de un núcleo.

### 6.1 Motivos de rechazo

| Motivo | Cuándo |
|---|---|
| `SIN_CLAVE` | No vino la cabecera, o vino vacía |
| `CREDENCIAL_INVALIDA` | La clave no corresponde a ninguna credencial |
| `CREDENCIAL_REVOCADA` | Existe, pero está revocada |
| `CREDENCIAL_VENCIDA` | Existe, pero se le pasó la fecha |
| `DISPOSITIVO_INACTIVO` | La credencial sirve, pero el aparato está dado de baja |

La credencial se evalúa **antes** que el dispositivo: si fallan las dos cosas,
el motivo que se informa es el de la credencial, porque es el que corresponde
auditar.

### 6.2 Un dispositivo sin área **sí** autentica

No tener área no es un problema de identidad: es no tener umbrales.
`autenticarDispositivo()` devuelve `ok: true`, y es `resolverArea()` la que dice
`SIN_AREA`. Quien llame decide qué hacer con eso — según
`10-arquitectura.md` §8.3, guardar la lectura con `area_id` nulo y responder
`rele: false`.

---

## 7. Dónde vive la verificación de rol

**No está en estos módulos, y es deliberado.** Es el patrón del resto del
proyecto: la puerta está en la página y en la Server Action, que llaman
`exigirAdmin()` antes de invocar nada de acá (`lib/auth.ts:107-112`).

Poner la verificación también adentro haría que ninguno de los dos lugares sea
claramente el responsable, y en la práctica lleva a que uno de los dos se
relaje porque "el otro ya chequea".

Estos módulos son **server-only**. Se marcan con el comentario de cabecera, igual
que `lib/db.ts`, `lib/auth.ts` y `lib/push.ts`. La alternativa más fuerte es el
paquete `server-only`, que convierte el error en falla de compilación; no se
agregó para no sumar una dependencia y no desviarse del patrón vigente.

Ver `13-matriz-permisos.md` §8.

---

## 8. Dos decisiones que se apartan del diseño aprobado

Hay que dejarlas escritas, porque contradicen documentos anteriores.

### 8.1 La rotación revoca en el acto

`10-arquitectura.md` §5.5 describía la rotación **siempre** con ventana de
gracia. La consigna de esta etapa pidió que rotar revoque la anterior.

**Resuelto así:** el default es revocar en el acto, como se pidió; la ventana
queda disponible pasando `graciaSegundos`. El estado `ROTADA` sigue existiendo
en el `check` de `sql/08`, así que no se pierde nada.

**Por qué importa:** rotar desde el panel la credencial del nodo físico, sin
ventana, lo deja sin autenticar hasta que alguien vaya a reflashearlo. El
default es más seguro contra una fuga y menos seguro contra un descuido
operativo. Quien rote un dispositivo físico debería pasar `graciaSegundos`.

### 8.2 El dispositivo inactivo no autentica

`10-arquitectura.md` §8.3, caso 3, decía que un dispositivo inactivo recibía
**200 con `rele: false`**: apagado inmediato, nodo sano, lectura guardada. La
consigna de esta etapa dice que un dispositivo inactivo **no puede autenticarse**.

**Resuelto así:** `autenticarDispositivo()` devuelve
`{ ok: false, motivo: "DISPOSITIVO_INACTIVO" }`, que es literalmente lo pedido.

**Lo que queda pendiente de decidir**, cuando se escriba `/api/ingest`: a qué
código HTTP se mapea ese motivo. No es un detalle:

| Respuesta | Relé | Botón pendiente | Lectura |
|---|---|---|---|
| `401` | se apaga **a los 45 s** por failsafe | queda sin confirmar, se reintenta cada 10 s | se pierde |
| `200` + `rele:false` | se apaga **en el acto** | se confirma y se limpia | se guarda |

Como el motivo viaja en el resultado, la ruta puede elegir. La recomendación
sigue siendo la del diseño —`200` con `rele:false`— pero la decisión es de quien
escriba esa etapa, y conviene tomarla a la vista de esta tabla.

### 8.3 Numeración de las migraciones

`11-plan-migracion.md` planeaba `06` estructura, `07` datos, `08` automatización,
`09` credenciales. Lo que se escribió fue: `06` estructura **y** datos, `07`
automatización, `08` credenciales, `09` credencial del nodo físico. El contenido
es el mismo; cambió el reparto entre archivos. `20-migraciones-aplicadas.md`
documenta los archivos reales.

---

## 9. Pruebas

Runner: **vitest**, agregado en esta etapa. Antes no había ninguno
(`03-riesgos.md` R4).

```
yarn test         # una pasada
yarn test:watch   # en desarrollo
```

**58 tests, 2 archivos, en verde.** Cubren lo que la consigna pedía:

| Requisito | Dónde |
|---|---|
| Generación y verificación de credencial | `tests/credenciales.test.ts` — formato, entropía, unicidad sobre 200 secretos, el hash reproduce, un carácter distinto ya no verifica |
| Rechazo de credencial revocada | ídem — revocada no verifica ni con vencimiento futuro |
| Rechazo de dispositivo inactivo | ídem — y el caso en que fallan las dos cosas |
| Resolución de área | `tests/dispositivos.test.ts` — con área, sin área, área inexistente |
| Bordes de `SEGUNDOS_SIN_SENAL` | ídem — 89 en línea, **90 en línea**, 91 sin señal |

El test de los bordes incluye una aserción de que `SEGUNDOS_SIN_SENAL` vale 90.
Si alguien cambia `lib/alertas.ts`, ese test falla y avisa que los bordes se
movieron, en vez de dejar que las dos pantallas se desincronicen en silencio.

El corte es **estrictamente mayor**, igual que `revisarNodosCaidos()`: a los 90
segundos exactos el nodo todavía está en línea.

---

## 10. `scripts/sembrar-credencial.js`

Genera el SQL para registrar una credencial. Sigue el patrón de
`scripts/hash.js`.

```bash
# Credencial heredada, leyendo la clave de una variable de entorno
export PAB_CLAVE=...
node scripts/sembrar-credencial.js NODO-INV-N-01 --clave-env PAB_CLAVE

# Credencial nueva generada por el sistema
node scripts/sembrar-credencial.js SIM-INV-N --generar
```

- `--clave-env` evita dejar la clave en el historial del intérprete de comandos.
  `--clave` existe pero la deja anotada ahí.
- El SQL que imprime lleva **solo el hash**. La clave en claro no aparece.
- El `insert` resuelve el dispositivo por su **código**, así el SQL sirve en
  cualquier base sin depender de identificadores internos, y es idempotente: no
  vuelve a insertar si ya hay una credencial viva del mismo origen.
- Con `--generar`, el secreto se imprime **una sola vez**, con un cartel.

Con esto se generó `sql/09_credencial_nodo_fisico.sql`, que registra la clave
que el nodo **ya tiene**: a partir de ahí puede autenticarse con credencial
propia **sin reflashear**. La clave se leyó del firmware y se pasó por variable
de entorno; nunca se tipeó ni quedó en ningún archivo nuevo.

---

## 11. Lo que esta etapa NO hizo

- **No tocó `app/api/ingest/route.ts`.** Sigue autenticando con `DEVICE_KEY` y
  resolviendo el área por `body.area`.
- **No tocó ninguna pantalla.** `/dispositivos` sigue mostrando lo de antes.
- **No tocó `lib/alertas.ts`.** `estadoDeNodos()` sigue barriendo `lecturas`.
- **No creó Server Actions.** Las siete previstas en `13-matriz-permisos.md` §2.2
  siguen sin existir.
- **No creó los dispositivos `SIM-*`** del simulador.
- **No arregló R8.** La alarma sigue siendo por área.
- **No probó contra la base las funciones que hacen consultas.** Los tests cubren
  las decisiones puras. `leerDispositivos()`, `autenticarDispositivo()` y las
  escrituras se ejercitan recién cuando haya pantallas que las llamen.

---

## 12. Actualización: la pantalla de administración

**2026-09-09.** §11 decía que no había Server Actions ni pantalla. Ahora sí.

### 12.1 Qué se agregó

| Archivo | Estado |
|---|---|
| `app/(panel)/dispositivos/page.tsx` | reescrito: carga flota, áreas, credenciales, últimas lecturas e historial |
| `app/(panel)/dispositivos/acciones.ts` | reescrito: 8 acciones nuevas, todas con `exigirAdmin()`; `simularLectura` sin cambios |
| `app/(panel)/dispositivos/gestor.tsx` | reescrito: lista densa + ficha + credenciales; el simulador queda igual |
| `lib/dispositivos.ts` | extendido: `ultimasLecturas`, `historialDeAreas`, `contarLecturasDe`, `eliminarDispositivo` |
| `sql/10_dispositivos_consultas.sql` | **nuevo**, aditivo e idempotente: dos funciones de lectura. **Sin aplicar todavía** |

`lib/credenciales.ts` **no se tocó**: la pantalla usa `listarCredenciales`,
`crearCredencial`, `rotarCredencial` y `revocarCredencial` tal como estaban.

### 12.2 El historial de asignación, sin tabla de asignaciones

`10-arquitectura.md` §2 eligió no crear una tabla de historial, porque el pasado
ya está congelado en `lecturas.area_id`. La pantalla pide "ver el historial de
asignaciones", y se resuelve **leyendo ese pasado**: por cada par
(dispositivo, área), cuántas lecturas escribió y entre qué fechas.

Es el historial real —lo que el aparato hizo— y no una declaración. Lo único que
no puede responder es la fecha exacta de un cambio que no haya dejado lecturas
de por medio. Si algún día hace falta esa precisión, la tabla se agrega de forma
aditiva sin tocar nada de esto.

La agregación va en una función de Postgres (`dispositivos_historial_areas()`)
porque PostgREST no agrupa: traer `lecturas` entera para contarla en memoria es
justamente lo que se evitó en `estadoDeNodos()`.

### 12.3 Degradación sin `sql/10`

La pantalla **no depende** de esa migración:

| | Con `sql/10` | Sin `sql/10` |
|---|---|---|
| Última lectura | una consulta para toda la flota | una por dispositivo |
| Historial | tramos por área | dice "Falta correr sql/10_dispositivos_consultas.sql" |
| Eliminar | se ofrece con 0 lecturas | **no se ofrece**: sin conteo no hay certeza |

La última fila es la regla general del módulo: **"no sé" es "no"**.
`eliminarDispositivo()` se niega si no puede contar las lecturas.

### 12.4 Invariantes que la pantalla sostiene

Suman a las de §4:

**I-9. El código no se edita.** Está grabado en el firmware y es lo que ata
`lecturas.dispositivo` con su dispositivo. `guardarDispositivo()` no arma ese
campo: no hay forma de mandarlo, ni siquiera invocando la acción a mano.

**I-10. La naturaleza no se edita.** Mismo mecanismo. Refuerza I-6.

**I-11. Desactivar es baja lógica.** Nunca se borra una fila de `dispositivos`
por dar de baja.

**I-12. Un dispositivo con lecturas no se borra.** El borrado existe, pero solo
para dispositivos sin ni una lectura, y con confirmación. Un dispositivo con
historia se da de baja.

**I-13. Desasignar no reescribe historia.** Cambiar `area_id` no toca ninguna
lectura ni ningún llamado ya guardado. Verificado: los conteos no se movieron en
las tres reasignaciones de la prueba.

**I-14. El secreto se ve una vez y el hash nunca.** La pantalla muestra prefijo,
estado, algoritmo, origen y fechas. El secreto aparece en un diálogo aparte, con
la advertencia de que no se vuelve a mostrar y de que hay que grabarlo en el
firmware.

### 12.5 Rotación con ventana, según la naturaleza

Al rotar desde la pantalla:

- dispositivo **FISICO** → 48 horas de gracia. Es el tiempo para ir a
  reflashear el firmware; sin ventana el nodo queda sin autenticar en el acto.
- dispositivo **SIMULADO** → sin gracia, la anterior se revoca de inmediato.

Resuelve en la práctica la tensión anotada en §8.1: el default sigue siendo
revocar, y la ventana se aplica donde hace falta.

### 12.6 Lo que sigue sin hacerse

- **Aplicar `sql/10`.** Se corre en el SQL Editor, como las anteriores.
- **El simulador.** Sigue armando el nombre del nodo a partir del área elegida
  (`nodoDe`), que es el riesgo R1. Es la etapa siguiente.
- **Los dispositivos `SIM-*`** del simulador tampoco se crearon todavía.

---

## 13. Flujo de asignación: dos pantallas, una sola escritura

**2026-09-09.** La ficha del área también asigna y desasigna dispositivos.

### 13.1 Una sola fuente de verdad

`app/(panel)/areas/gestor.tsx` importa **`cambiarAreaDispositivo`** de
`app/(panel)/dispositivos/acciones.ts`. **No se escribió una acción propia en
`areas/acciones.ts`**, y está justificado en el encabezado de ese archivo.

El motivo: la cardinalidad —un dispositivo tiene un área vigente, y asignarlo a
otra lo reasigna en vez de duplicarlo— se sostiene en **una sola columna
escalar**, `dispositivos.area_id`. Una segunda acción que escribiera esa misma
columna sería una segunda copia de la regla: dos lugares donde validar el id,
dos donde decidir qué significa `null`, y dos que alguien va a tocar por
separado.

Verificado en el artefacto compilado: la página de Áreas registra **el mismo
identificador de acción** que la de Dispositivos
(`60fe8b80…` para `cambiarAreaDispositivo`). No son dos funciones parecidas: es
la misma.

### 13.2 Qué muestra la sección

En la ficha del área, debajo de Automatización:

- **Por cada dispositivo asignado**: código, chip de conexión (En línea / Sin
  señal / Nunca reportó), chips de Simulado y Baja si corresponden, último
  contacto en lenguaje relativo (`hace 4 min`) más la fecha exacta, y el botón
  **Desasignar**.
- **Abajo, "Asignar dispositivo"**: selector con los dispositivos **activos que
  no están ya en esta área**. Cada opción dice de dónde sale: `SIM-01 — sin
  área` o `SIM-01 — hoy en INV-G`. Asignar reasigna.
- En un área **nueva** (sin guardar) la sección explica que primero hay que
  guardar el área.

Los cambios de dispositivo se aplican **en el momento**, no al apretar Guardar,
porque son otra acción. La ficha lo dice.

### 13.3 Un área de baja no desasigna nada

Dar de baja un área **no toca** sus dispositivos. Es deliberado: el área se dio
de baja, el aparato sigue atornillado donde estaba.

La pantalla lo hace visible en tres lugares:

- un chip **"Con dispositivos"** en la fila de un área inactiva que todavía
  tiene nodos;
- un aviso dentro de la ficha, diciendo cuántos son y que sus lecturas se
  siguen guardando pero no generan llamados ni accionan;
- el diálogo de baja aclara cuántos dispositivos quedan asignados.

### 13.4 Reasignar no reescribe el pasado

**I-15. Cambiar `dispositivos.area_id` no toca ninguna fila de `lecturas` ni de
`llamados`.** Cada una conserva el `area_id` que tenía cuando se grabó.

Verificado de punta a punta con dos reasignaciones seguidas sobre un
dispositivo con lecturas:

```
lectura 5696 -> area_id 6     (reportada estando en VIV-1)
lectura 5697 -> area_id 3     (reportada estando en INV-G)
lectura 5698 -> area_id 7     (reportada estando en RIE-1)
dispositivo.area_id vigente: 7
```

Y los reportes del período anterior salieron **idénticos byte por byte** antes y
después de las dos reasignaciones:

```
reporte_por_area(null, null, null, '2026-09-09T00:00:00Z')
reporte_clima_por_dia(null, null, '2026-09-09T00:00:00Z')
```

Es la consecuencia práctica del invariante R-1 de `10-arquitectura.md`: los
reportes agrupan por la columna congelada del hecho, nunca por la asignación
vigente.

### 13.5 El historial refleja hechos, no declaraciones

Después de las mismas dos reasignaciones, `dispositivos_historial_areas()`
devolvió tres tramos, del más reciente al más viejo:

```
area_id 7 | 1 lectura | 00:09:52 -> 00:09:52
area_id 3 | 1 lectura | 00:09:51 -> 00:09:51
area_id 6 | 1 lectura | 00:09:34 -> 00:09:34
```

Con una advertencia que conviene tener presente: **el historial se deduce de las
lecturas**. Reasignar un dispositivo que no vuelve a reportar **no agrega ningún
tramo**, porque no hay hecho nuevo que registrar. Es exactamente el límite que
`10-arquitectura.md` §2 anticipó al elegir no crear una tabla de asignaciones:
se puede responder *dónde estuvo midiendo*, no *cuándo alguien cambió el
formulario*.

### 13.6 Sin consultas N+1

`areas/page.tsx` trae **la flota entera en una sola consulta**
(`leerDispositivosConEstado()`), igual que ya hacía con empleados y llamados, y
el agrupado por área lo hace el componente. Pedir los dispositivos de cada área
por separado serían ocho consultas para responder lo mismo.

Esa misma lista alimenta el selector de asignación, que necesita también los
dispositivos de otras áreas y los que están sin área.

### 13.7 Permisos

`/areas` empieza con `exigirAdmin()`, y las cuatro acciones que registra
—`crearArea`, `actualizarArea`, `cambiarActivaArea` y `cambiarAreaDispositivo`—
devuelven **403 a una sesión de EMPLEADO** y 200 a una de ADMINISTRADOR,
verificado por HTTP con cookies firmadas. La página misma devuelve 403 con
`app/forbidden.tsx`.
