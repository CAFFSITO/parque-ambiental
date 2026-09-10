# 95 — Guion de la demostración

Ejecutado el **2026-09-10**. Resultado: **PASS**, 11 pasos y la limpieza.

Este documento es las dos cosas a la vez: el **guion** para hacer la demo en
vivo frente a una pantalla, y el **acta** de la corrida real. En cada paso, lo
que se espera ver está arriba y **lo que efectivamente pasó** está abajo, en un
bloque `Resultado`. Los bloques son transcripciones, no ejemplos.

---

## 0. Antes de empezar

### 0.1 Estado de partida

```
lecturas = 5781    llamados = 431
INV-N: temp 20–25 °C | hum 60–80 % | auto_temp_alta=true auto_hum_baja=true
```

### 0.2 Suites automáticas

Se corren primero. Si alguna está en rojo, la demo no arranca.

```bash
yarn lint            # sin hallazgos
yarn test            # 160 tests, 6 archivos
yarn build           # exit 0
yarn probar:ingest   # 18/18 casos, exit 0
yarn probar:permisos # 46 filas de matriz, exit 0
```

O todo junto: `yarn verificar`.

### 0.3 Cómo se ejecutó esta corrida

Las Server Actions se invocaron **por HTTP**, con el encabezado `Next-Action` y
cookies `pab_sesion` firmadas con el `JWT_SECRET` real (HS256, el mismo
algoritmo de `lib/sesion.ts`), contra `next start` en `127.0.0.1:3212` y la base
real. Es exactamente lo que hace el navegador al apretar el botón: no se simuló
ninguna autorización.

Para hacerla en vivo, cada paso indica **dónde se hace clic**. La secuencia es
la misma.

### 0.4 Higiene

Todo el ciclo se hizo sobre un dispositivo descartable, `DEMO-INV-N`, que al
final se borró junto con sus lecturas y sus credenciales. Los umbrales y las
casillas de INV-N se movieron y se restauraron. Ver §12.

---

## 1. El ADMINISTRADOR crea el dispositivo

**En pantalla:** `/dispositivos` → **Crear dispositivo**. Código
`DEMO-INV-N`, nombre, modelo `ESP32-S3-Zero`, naturaleza **Físico**, sin área.

**Qué se espera ver:** la ficha se cierra, aparece el aviso *"Dispositivo
DEMO-INV-N creado. Emitile una credencial para que pueda reportar."*, y la fila
nueva aparece en la lista con el chip **Sin credencial** en ámbar.

**El código y la naturaleza quedan grises al reabrir la ficha.** No se pueden
editar nunca más: el código está grabado en el firmware y la naturaleza separa
el hardware real de la simulación.

> **Resultado**
> ```json
> {"ok":true,"mensaje":"Dispositivo DEMO-INV-N creado. Emitile una credencial para que pueda reportar."}
> ```
> Fila en la base:
> ```json
> {"id":43,"codigo":"DEMO-INV-N","nombre":"Nodo de demostracion","area_id":null,
>  "activo":true,"naturaleza":"FISICO","ultimo_contacto_en":null}
> ```

### 1b. Sin credencial no entra

**Qué se espera ver:** el nodo que intente reportar recibe **401**.

> **Resultado**
> ```json
> HTTP 401 {"ok":false,"error":"Clave de dispositivo inválida."}
> ```
> Existir en la tabla no alcanza. La identidad la da la credencial.

---

## 2. El ADMINISTRADOR genera la credencial

**En pantalla:** fila del dispositivo → **Credenciales** → **Emitir credencial**.

**Qué se espera ver:** un diálogo con el secreto en claro y el cartel *"Este
secreto se muestra UNA sola vez"*. Al cerrarlo, la lista de credenciales muestra
**solo el prefijo**, el estado `ACTIVA`, el algoritmo `sha256-v1` y quién la
creó. El hash no aparece en ninguna pantalla.

> **Resultado**
> ```json
> {"ok":true,"mensaje":"Credencial emitida.","codigo":"DEMO-INV-N",
>  "secreto":"pab_NGuvcmTK… (47 caracteres, no se transcribe)"}
> ```
> Lo que queda guardado:
> ```json
> [{"id":40,"algoritmo":"sha256-v1","prefijo":"pab_NGuvcmTK","estado":"ACTIVA",
>   "origen":"GENERADA","expira_en":null,"usada_en":null,"creada_por":"admin"}]
> ```
> `usada_en` en `null`: todavía no reportó.

### 2b. Con credencial pero sin área

**Qué se espera ver:** el nodo **sí** autentica y su lectura **sí** se guarda,
pero con `area_id` nulo. No hay umbrales que evaluar, así que no hay alerta ni
actuación. Es un estado válido, no un error.

> **Resultado**
> ```json
> {"ok":true,"rele":false,"alarma":false,"area":null,"llamados":[],
>  "dispositivo":"DEMO-INV-N","compatibilidad":false,"area_declarada":null,
>  "avisos":["El dispositivo no tiene área asignada: no hay umbrales que evaluar."]}
> ```

---

## 3. El ADMINISTRADOR lo asigna a Invernadero Norte

**En pantalla:** fila del dispositivo → **Asignar área** → *INV-N — Invernadero
Norte*. También se puede desde `/areas` → ficha del área → **Asignar
dispositivo**: **es la misma Server Action**, no dos copias de la regla.

**Qué se espera ver:** *"Área asignada. Rige desde la próxima lectura."*

> **Resultado**
> ```json
> {"ok":true,"mensaje":"Área asignada. Rige desde la próxima lectura."}
> {"codigo":"DEMO-INV-N","area_id":1}
> ```

---

## 4. El nodo envía una lectura, y el servidor la resuelve entera

Ésta es la cadena que hay que narrar mientras se ve la respuesta:

> **el ESP32 mide → el ESP32 envía → el servidor lo identifica por su credencial
> → resuelve el área desde la base → evalúa umbrales → genera alerta si
> corresponde → evalúa automatización → devuelve `rele` y `alarma` → el ROOTBOX
> ejecuta.**

**Lectura dentro de rango: 22,5 °C / 70 %** (INV-N admite 20–25 y 60–80).

**Qué se espera ver:** `rele:false`, `llamados:[]`, y **`area:"INV-N"` resuelta
desde la base**, no del cuerpo. `compatibilidad:false` prueba que entró por su
credencial propia y no por ninguna clave global.

> **Resultado**
> ```json
> {"ok":true,"rele":false,"alarma":true,"area":"INV-N","llamados":[],
>  "dispositivo":"DEMO-INV-N","compatibilidad":false,"area_declarada":"INV-N","avisos":[]}
> ```

**Sobre `alarma:true`:** no la produjo esta lectura. `alarma` es
`hayEmergenciaAbierta(area)` y hoy INV-N tiene emergencias sin atender, en su
mayoría datos sembrados. Es el riesgo **R8**, todavía abierto, y conviene
decirlo en la demo en vez de que alguien lo note.

**Qué hace el ROOTBOX con esto:** lee `datos["rele"] | false` y
`datos["alarma"] | false` (`.ino:604-608`), aplica el relé en el acto y deja
sonar el buzzer. **Lo que se ve en la pantalla es la decisión del servidor; el
efecto físico lo produce el nodo al recibirla.**

---

## 5. Temperatura alta con la casilla MARCADA → alerta **y** ventilador

**En pantalla:** `/areas` → INV-N → **Automatización**. Se muestra que
*"Temperatura por encima del máximo (más de 25,0 °C)"* está **marcada**.

**Lectura: 33 °C / 70 %.**

**Qué se espera ver:** un llamado **y** `rele:true`, con el aviso diciendo por
qué se encendió.

> **Resultado** — `auto_temp_alta = true`
> ```json
> {"ok":true,"rele":true,"alarma":true,"area":"INV-N",
>  "llamados":[{"motivo":"Temperatura por encima del umbral","tipo":"EMERGENCIA","resultado":"actualizado"}],
>  "avisos":["Actuador encendido por: Temperatura por encima del máximo."]}
> ```

`resultado:"actualizado"` es el **antirrebote**: ya había un llamado abierto de
ese motivo en INV-N, así que se le refrescó el detalle en vez de crear otro. Un
nodo que reporta cada 10 segundos no puede generar un llamado por reporte.

---

## 6. Humedad baja con la casilla DESMARCADA → alerta y **NO** acciona

Es el paso que demuestra la separación. Se hace en tres tiempos.

**En pantalla:** `/areas` → INV-N → **Editar** → se **desmarca** *"Humedad por
debajo del mínimo (menos de 60,0 %)"* → **Guardar**.

**Lectura: 22,5 °C / 40 %.**

**Qué se espera ver:** el llamado aparece igual —la alerta **nunca** depende de
la casilla— y `rele:false`, con un aviso que dice explícitamente que había
desvío y no estaba marcado.

> **Resultado** — se desmarcó desde el panel: `auto_hum_baja = false`
> ```json
> {"ok":true,"rele":false,"alarma":true,"area":"INV-N",
>  "llamados":[{"motivo":"Humedad por debajo del umbral","tipo":"EMERGENCIA","resultado":"actualizado"}],
>  "avisos":["Fuera de rango sin automatización marcada: Humedad por debajo del mínimo."]}
> ```

Ahora se vuelve a marcar la casilla y se manda **la misma lectura**.

> **Resultado** — `auto_hum_baja = true`
> ```json
> {"ok":true,"rele":true,"alarma":true,"area":"INV-N",
>  "llamados":[{"motivo":"Humedad por debajo del umbral","tipo":"EMERGENCIA","resultado":"actualizado"}],
>  "avisos":["Actuador encendido por: Humedad por debajo del mínimo."]}
> ```

**El llamado es idéntico en los dos casos. Lo único que cambió es `rele`.**

> Desmarcar una casilla apaga una bomba. **Nunca apaga una alarma.**

Y todo esto **sin reflashear nada**: el firmware no conoce los umbrales.

---

## 7. Un EMPLEADO no puede modificar configuración crítica

**En pantalla:** con sesión de empleado, `/areas`, `/dispositivos`,
`/usuarios` y `/diagnostico` **no aparecen en el menú**, y entrando a mano dan
**403** con `app/forbidden.tsx`.

Pero esconder el menú no protege nada. Lo que hay que mostrar es que **la Server
Action rechaza igual**, invocada por fuera de la pantalla.

**Qué se espera ver:** 403 en las cinco, y **cero efectos** sobre la base.

> **Resultado**
> ```
> actualizarArea             EMPLEADO -> HTTP 403 (la acción no se ejecutó)
> cambiarAreaDispositivo     EMPLEADO -> HTTP 403 (la acción no se ejecutó)
> cambiarActivoDispositivo   EMPLEADO -> HTTP 403 (la acción no se ejecutó)
> emitirCredencial           EMPLEADO -> HTTP 403 (la acción no se ejecutó)
> simularLectura             EMPLEADO -> HTTP 403 (la acción no se ejecutó)
>
> auto_temp_alta sigue en true
> area_id del nodo sigue en 1
> ```

La matriz completa —31 acciones, 11 páginas, tres roles— está en
`70-pruebas-permisos.md` y la regenera `yarn probar:permisos`.

---

## 8. El simulador está aislado

**En pantalla:** `/diagnostico`. El desplegable **solo ofrece dispositivos
`SIMULADO`**: `DEMO-INV-N` es físico y no aparece.

Para la demo hay que mostrar que la ubicación de la página no es lo que
protege: se invoca la acción a mano con el id del dispositivo físico.

**Qué se espera ver:** rechazo **del servidor**, con el motivo explicado.

> **Resultado**
> ```json
> {"ok":false,"error":"Rechazado por el servidor: DEMO-INV-N es un dispositivo FÍSICO.
>  El simulador no puede escribir bajo la identidad de hardware real — una medición
>  inventada quedaría mezclada con las del aparato y no habría forma de separarlas
>  después. Elegí un dispositivo simulado, o creá uno en Dispositivos con naturaleza
>  SIMULADO."}
> ```

Y hay una segunda capa, más fuerte, que `yarn probar:ingest` verifica: aunque
alguien postee `"dispositivo":"NODO-INV-N-01"` con una credencial de un
simulado, **la lectura se atribuye al dueño de la credencial**. Ver
`80-simulador.md`.

---

## 9. El histórico no se pierde al reasignar

**En pantalla:** fila del dispositivo → **Cambiar área** → COM-1. Después se
abre la ficha y se mira **Historial de asignación**.

**Qué se espera ver:** las lecturas ya escritas conservan el `area_id` que
tenían **en el momento de escribirse**. Reasignar no reescribe el pasado, y por
eso los reportes de un período cerrado no se mueven.

> **Resultado** — las cinco lecturas del nodo, antes y después de reasignarlo de
> INV-N (1) a COM-1 (5):
>
> ```json
> [{"id":5799,"area_id":null,"temperatura":22,  "humedad":70},
>  {"id":5800,"area_id":1,   "temperatura":22.5,"humedad":70},
>  {"id":5801,"area_id":1,   "temperatura":33,  "humedad":70},
>  {"id":5802,"area_id":1,   "temperatura":22.5,"humedad":40},
>  {"id":5803,"area_id":1,   "temperatura":22.5,"humedad":40}]
> ```
>
> **Idénticas: SÍ.** Se ve también la lectura del paso 2b con `area_id:null`,
> la que entró antes de tener área: quedó congelada así.

---

## 10. Un dispositivo desactivado deja de ser aceptado

**En pantalla:** fila → **Dar de baja** → confirmar.

**Qué se espera ver:** *"Dispositivo dado de baja: sus lecturas dejan de
guardarse y su relé queda apagado."* Y cuando el nodo reporta: **200 con
`rele:false` y `alarma:false`**, con el aviso de la baja, y **la lectura no se
guarda**.

**Por qué 200 y no un 4xx**, que conviene explicar en la demo: con
`rele:false` el relé se apaga **en el acto**. Un 401 lo dejaría encendido 45
segundos hasta que actúe el failsafe del nodo, además de dejar el botón
pendiente reintentándose cada 10 segundos.

> **Resultado**
> ```json
> {"ok":true,"rele":false,"alarma":false,"area":null,"llamados":[],
>  "dispositivo":"DEMO-INV-N","compatibilidad":false,"area_declarada":"INV-N",
>  "avisos":["El dispositivo está dado de baja: la lectura no se guarda."]}
> ```
> Lecturas del nodo: **5 antes, 5 después**.

---

## 11. La credencial se puede rotar y revocar

**En pantalla:** fila → **Credenciales** → **Rotar**. Para un dispositivo
`SIMULADO` la anterior se revoca en el acto; para uno **FÍSICO** la pantalla
ofrece **48 horas de gracia**, que es el tiempo de ir a reflashear el firmware.
En esta corrida se usó gracia cero, a propósito, para que se vea el corte.

**Qué se espera ver:** la credencial vieja deja de servir **en el acto**, la
nueva funciona, y la fila vieja **no se borra**: queda `REVOCADA` con quién y
por qué. Es el registro de auditoría.

> **Resultado — rotación**
> ```
> "Credencial rotada. La anterior quedó revocada en el acto."
>
> credencial VIEJA -> HTTP 401 {"ok":false,"error":"Clave de dispositivo inválida."}
> credencial NUEVA -> HTTP 200 {"ok":true,"rele":false,"alarma":true,"area":"INV-N",…}
> ```
> ```json
> [{"id":40,"prefijo":"pab_NGuvcmTK","estado":"REVOCADA","revocada_por":"admin",
>   "motivo":"Rotada desde la pantalla de Dispositivos."},
>  {"id":41,"prefijo":"pab_Q68Hxn5K","estado":"ACTIVA","revocada_por":null,
>   "motivo":"Rotada desde la pantalla de Dispositivos."}]
> ```

**En pantalla:** ahora **Revocar** sobre la credencial vigente.

> **Resultado — revocación**
> ```
> "Credencial revocada. El nodo que la use va a recibir 401 y su relé se apaga
>  por failsafe a los 45 segundos."
>
> el nodo -> HTTP 401 {"ok":false,"error":"Clave de dispositivo inválida."}
> ```
> ```json
> [{"id":40,"prefijo":"pab_NGuvcmTK","estado":"REVOCADA","revocada_por":"admin"},
>  {"id":41,"prefijo":"pab_Q68Hxn5K","estado":"REVOCADA","revocada_por":"admin"}]
> ```
>
> **Ninguna fila se borró.** Las dos quedan con quién revocó y por qué.

---

## 12. Cierre y limpieza

**En pantalla:** se intenta **Eliminar** el dispositivo. El botón **no se
ofrece** cuando tiene lecturas; invocando la acción a mano, el servidor lo
rechaza.

> **Resultado**
> ```json
> {"ok":false,"error":"El dispositivo tiene 6 lecturas registradas.
>  Dalo de baja en vez de borrarlo: la historia no se tira."}
> ```
>
> Es el invariante I-12: un dispositivo con historia se da de baja, no se borra.

Para no dejar residuo de la demo, las seis lecturas de `DEMO-INV-N`, sus dos
credenciales y su fila se borraron **por fuera de la aplicación**, a mano.
Son artefactos de la demostración, no historia operativa.

| | Al empezar | Al terminar |
|---|---|---|
| `lecturas` | 5781 | **5781** |
| `llamados` | 431 | **431** |
| Dispositivos `DEMO-INV-N` | 0 | **0** |
| Configuración de INV-N | temp 20–25, hum 60–80, `auto_temp_alta=true`, `auto_hum_baja=true` | **idéntica** |

**Llamados creados: cero.** Todos los desvíos de la demo cayeron en el
antirrebote sobre llamados ya abiertos de INV-N, así que no se ensució la
bandeja del operador ni se disparó ningún aviso de Telegram o push —que solo se
mandan al **crear**, nunca al actualizar—.

---

## 13. Qué NO demuestra este guion

Se dice para que nadie lo dé por mostrado.

- **El hardware.** Toda la corrida reproduce el POST del nodo; **no es el
  nodo**. El ESP32 estaba apagado: su última lectura real es del
  `2026-09-10T02:59:05Z`. Ver `90-firmware.md` §3.3.
- **El relé abriendo y cerrando.** Se ve el booleano `rele` que el servidor
  decide, no el contacto. La traducción a voltaje vive entera en el firmware
  (`aplicarRele()`), y el propio `.ino` la deja verificada físicamente.
- **Los 45 segundos del failsafe.** Se verificó que un servidor caído no
  devuelve ningún 200 —el nodo entra en su rama de error—, pero cronometrar el
  apagado necesita el aparato.
- **El despliegue.** Todo corrió contra `next start` local. El firmware apunta a
  `parque-ambiental.vercel.app`, incrustado: para una demo con el nodo real hay
  que desplegar primero.

## 14. Riesgos abiertos que conviene nombrar durante la demo

Antes de que los note alguien del público.

- **R8 — la alarma es del área, no del nodo.** Por eso `alarma:true` aparece en
  casi todas las respuestas de este guion: INV-N tiene emergencias sin atender,
  en su mayoría datos sembrados por `sql/02_datos.sql`.
- **TLS sin validar.** El firmware usa `setInsecure()`: cifra pero no verifica
  contra quién. Es deuda de producción, documentada en `90-firmware.md` §2.12.
- **El DHT en fallo reenvía la última lectura válida** como si fuera actual, y
  el servidor no puede detectarlo. `90-firmware.md` §4.1 tiene el cambio mínimo
  propuesto, sin aplicar.

---

## Firma

| | |
|---|---|
| **Fecha** | 2026-09-10 |
| **Entorno** | `next start` en `127.0.0.1:3212`, base real de Supabase |
| **Pasos ejecutados** | 11 + limpieza |
| **Resultado** | **PASS** |
| **Residuo** | **cero** — `DEMO-INV-N` y sus 6 lecturas borrados; INV-N restaurada idéntica |
| **Llamados creados** | **0** |
| **Suites al momento de la corrida** | `yarn lint` limpio · `yarn test` 160/160 · `yarn build` exit 0 · `yarn probar:ingest` 18/18 exit 0 · `yarn probar:permisos` PASS exit 0 |
