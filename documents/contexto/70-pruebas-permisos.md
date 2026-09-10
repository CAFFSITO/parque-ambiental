# 70 — Pruebas reproducibles de permisos

Fecha UTC: 2026-09-10T00:46:29.361Z. Fixture: PB4F04D97. Resultado: **PASS**.

## Reproducción y alcance

Desde la raíz, con .env.local válido y las migraciones ya aplicadas:

```powershell
yarn test
yarn build
node scripts/pruebas-permisos.mjs
```

El script descubre las 31 acciones desde el AST y contrasta el manifiesto real de Next; falla ante acciones/páginas nuevas sin casos. Inicia next start en 127.0.0.1:3107, sin tocar el servidor 3000. Envía POST con Next-Action y argumentos válidos, no hace mocks de autorización, cookies, JWT, acciones, handlers ni BD. Firma cookies de usuarios temporales con el payload vigente y prueba además login real con contraseña bcrypt. No imprime tokens ni secretos.

Para evitar efectos sobre la operación, un gateway PostgREST local autenticado limita lecturas y escrituras a filas temporales en la base REAL. Añade filtros AND, conserva filtros de dueño de la aplicación, valida FKs y prefijos, restringe RPC de reportes al área temporal y filtra resultados de RPC de dispositivos. Traduce únicamente la clave global telegram_activo a una clave temporal. No fabrica resultados exitosos. La aplicación conserva su lógica real, incluyendo la vigilancia; solo ve nodos temporales. TELEGRAM_TOKEN, TELEGRAM_CHAT_ID y VAPID_PRIVATE_KEY vacías en este proceso deshabilitan envíos; probarPush devuelve ok:false por ese motivo, no por permisos. DEVICE_KEY se reemplaza solo en este proceso por una credencial del simulador temporal, con fallback global desactivado. .env.local no se modifica. Esto verifica autorización HTTP con datos aislados, no entrega real de notificaciones ni configuración del despliegue remoto.

Limpieza en finally: elimina solo filas del prefijo/IDs verificados, en orden de dependencias; comprueba cero residuo. Las secuencias autoincrementales pueden avanzar. Una interrupción forzada del proceso podría impedir finally: usar el prefijo informado para revisar residuos antes de repetir.

## Inventario completo y primera instrucción ejecutable

Login es necesariamente público: exigir sesión antes de autenticarse impediría ingresar. cerrarSesion exige ahora exigirSesion; sin cookie igualmente vuelve al login. No se agregaron roles ni se cambió el JWT.

| Archivo:línea | Función | Guardia inicial |
|---|---|---|
| app/(panel)/acciones.ts:8 | cerrarSesion | exigirSesion |
| app/(panel)/areas/acciones.ts:168 | crearArea | exigirAdmin |
| app/(panel)/areas/acciones.ts:188 | actualizarArea | exigirAdmin |
| app/(panel)/areas/acciones.ts:218 | cambiarActivaArea | exigirAdmin |
| app/(panel)/avisos/acciones.ts:35 | guardarSuscripcion | exigirSesion |
| app/(panel)/avisos/acciones.ts:94 | asegurarSuscripcion | exigirSesion |
| app/(panel)/avisos/acciones.ts:156 | borrarSuscripcion | exigirSesion |
| app/(panel)/avisos/acciones.ts:180 | cambiarSuscripcion | exigirSesion |
| app/(panel)/avisos/acciones.ts:208 | probarPush | exigirSesion |
| app/(panel)/avisos/acciones.ts:234 | cambiarTelegram | exigirAdmin |
| app/(panel)/dispositivos/acciones.ts:64 | simularLectura | exigirAdmin |
| app/(panel)/dispositivos/acciones.ts:216 | crearDispositivoNuevo | exigirAdmin |
| app/(panel)/dispositivos/acciones.ts:250 | guardarDispositivo | exigirAdmin |
| app/(panel)/dispositivos/acciones.ts:288 | cambiarAreaDispositivo | exigirAdmin |
| app/(panel)/dispositivos/acciones.ts:315 | cambiarActivoDispositivo | exigirAdmin |
| app/(panel)/dispositivos/acciones.ts:342 | eliminarDispositivoSinLecturas | exigirAdmin |
| app/(panel)/dispositivos/acciones.ts:371 | emitirCredencial | exigirAdmin |
| app/(panel)/dispositivos/acciones.ts:403 | rotarCredencialDispositivo | exigirAdmin |
| app/(panel)/dispositivos/acciones.ts:438 | revocarCredencialDispositivo | exigirAdmin |
| app/(panel)/empleados/acciones.ts:164 | crearEmpleado | exigirAdmin |
| app/(panel)/empleados/acciones.ts:192 | actualizarEmpleado | exigirAdmin |
| app/(panel)/empleados/acciones.ts:228 | cambiarEstadoEmpleado | exigirAdmin |
| app/(panel)/llamados/acciones.ts:35 | atenderLlamado | exigirSesion |
| app/(panel)/llamados/acciones.ts:84 | cancelarAtencion | exigirSesion |
| app/(panel)/llamados/acciones.ts:130 | crearLlamado | exigirSesion |
| app/(panel)/usuarios/acciones.ts:106 | crearUsuario | exigirAdmin |
| app/(panel)/usuarios/acciones.ts:144 | cambiarRolUsuario | exigirAdmin |
| app/(panel)/usuarios/acciones.ts:186 | cambiarActivoUsuario | exigirAdmin |
| app/(panel)/usuarios/acciones.ts:212 | resetearPassword | exigirAdmin |
| app/(panel)/usuarios/acciones.ts:244 | eliminarUsuario | exigirAdmin |
| app/login/acciones.ts:25 | accionLogin | pública (login) |
| app/(panel)/areas/page.tsx:33 | PaginaAreas | exigirAdmin |
| app/(panel)/avisos/page.tsx:15 | PaginaAvisos | exigirSesion |
| app/(panel)/dispositivos/page.tsx:24 | PaginaDispositivos | exigirAdmin |
| app/(panel)/empleados/page.tsx:28 | PaginaEmpleados | exigirAdmin |
| app/(panel)/llamados/page.tsx:33 | PaginaLlamados | exigirSesion |
| app/(panel)/movil/page.tsx:18 | PaginaMovil | exigirSesion |
| app/(panel)/page.tsx:214 | PaginaTablero | exigirSesion |
| app/(panel)/reportes/imprimir/page.tsx:72 | PaginaImprimir | exigirAdmin |
| app/(panel)/reportes/page.tsx:58 | PaginaReportes | exigirAdmin |
| app/(panel)/usuarios/page.tsx:13 | PaginaUsuarios | exigirAdmin |

## Rutas: matriz esperada vs observada

| Ruta / acción | Esperado A / E / sin sesión | ADMINISTRADOR observado | EMPLEADO observado | Sin sesión observado |
|---|---|---|---|---|
| / | 200 / 200 / 307 login | 200 | 200 | 307 → /login |
| /llamados | 200 / 200 / 307 login | 200 | 200 | 307 → /login |
| /movil | 200 / 200 / 307 login | 200 | 200 | 307 → /login |
| /avisos | 200 / 200 / 307 login | 200 | 200 | 307 → /login |
| /areas | 200 / 403 / 307 login | 200 | 403 | 307 → /login |
| /empleados | 200 / 403 / 307 login | 200 | 403 | 307 → /login |
| /usuarios | 200 / 403 / 307 login | 200 | 403 | 307 → /login |
| /dispositivos | 200 / 403 / 307 login | 200 | 403 | 307 → /login |
| /reportes | 200 / 403 / 307 login | 200 | 403 | 307 → /login |
| /reportes/imprimir | 200 / 403 / 307 login | 200 | 403 | 307 → /login |
| /login | 307 / 307 / 200 | 307 → / | 307 → / | 200 |
| /api/exportar/csv | 200 / 403 / 307 login | 200 | 403 | 307 → /login |
| /api/ingest | 401 / 401 / 401 (sin clave) | 401 | 401 | 401 |
| /api/vigilancia | 200 / 403 / 401 | 200 | 403 | 401 |

## Acciones: matriz esperada vs observada

Cada acción administrativa se envía con sesión EMPLEADO y sin sesión antes de la llamada ADMINISTRADOR; el 403 se comprueba junto con cero escrituras al gateway (Next puede releer la página Avisos al renderizar un 403). No se confunde un 200 con permiso para mutar: se exige además ok:true, salvo prueba push sin entrega. Las acciones compartidas usan filas propias por rol. Los llamados de EMPLEADO se ejercen sobre otra área para conservar el permiso histórico.

| Ruta / acción | Esperado A / E / sin sesión | ADMINISTRADOR observado | EMPLEADO observado | Sin sesión observado |
|---|---|---|---|---|
| crearArea | 200 / 403 / 307 login | 200; ok:true | 403; 0 escrituras | 307 → /login |
| actualizarArea | 200 / 403 / 307 login | 200; ok:true | 403; 0 escrituras | 307 → /login |
| cambiarActivaArea | 200 / 403 / 307 login | 200; ok:true | 403; 0 escrituras | 307 → /login |
| crearEmpleado | 200 / 403 / 307 login | 200; ok:true | 403; 0 escrituras | 307 → /login |
| actualizarEmpleado | 200 / 403 / 307 login | 200; ok:true | 403; 0 escrituras | 307 → /login |
| cambiarEstadoEmpleado | 200 / 403 / 307 login | 200; ok:true | 403; 0 escrituras | 307 → /login |
| crearUsuario | 200 / 403 / 307 login | 200; ok:true | 403; 0 escrituras | 307 → /login |
| cambiarRolUsuario | 200 / 403 / 307 login | 200; ok:true | 403; 0 escrituras | 307 → /login |
| cambiarActivoUsuario | 200 / 403 / 307 login | 200; ok:true | 403; 0 escrituras | 307 → /login |
| resetearPassword | 200 / 403 / 307 login | 200; ok:true | 403; 0 escrituras | 307 → /login |
| eliminarUsuario | 200 / 403 / 307 login | 200; ok:true | 403; 0 escrituras | 307 → /login |
| crearDispositivoNuevo | 200 / 403 / 307 login | 200; ok:true | 403; 0 escrituras | 307 → /login |
| guardarDispositivo | 200 / 403 / 307 login | 200; ok:true | 403; 0 escrituras | 307 → /login |
| cambiarAreaDispositivo | 200 / 403 / 307 login | 200; ok:true | 403; 0 escrituras | 307 → /login |
| cambiarAreaDispositivo vía /areas | 200 / 403 / 307 login | 200; ok:true | 403; 0 escrituras | 307 → /login |
| cambiarActivoDispositivo | 200 / 403 / 307 login | 200; ok:true | 403; 0 escrituras | 307 → /login |
| emitirCredencial | 200 / 403 / 307 login | 200; ok:true | 403; 0 escrituras | 307 → /login |
| rotarCredencialDispositivo | 200 / 403 / 307 login | 200; ok:true | 403; 0 escrituras | 307 → /login |
| revocarCredencialDispositivo | 200 / 403 / 307 login | 200; ok:true | 403; 0 escrituras | 307 → /login |
| simularLectura | 200 / 403 / 307 login | 200; ok:true | 403; 0 escrituras | 307 → /login |
| eliminarDispositivoSinLecturas | 200 / 403 / 307 login | 200; ok:true | 403; 0 escrituras | 307 → /login |
| cambiarTelegram | 200 / 403 / 307 login | 200; ok:true | 403; 0 escrituras | 307 → /login |
| crearLlamado | 200 / 200 / 307 login | 200 | 200 | 307 |
| atenderLlamado | 200 / 200 / 307 login | 200 | 200 | 307 |
| cancelarAtencion | 200 / 200 / 307 login | 200 | 200 | 307 |
| guardarSuscripcion | 200 / 200 / 307 login | 200 | 200 | 307 |
| asegurarSuscripcion | 200 / 200 / 307 login | 200 | 200 | 307 |
| cambiarSuscripcion | 200 / 200 / 307 login | 200 | 200 | 307 |
| borrarSuscripcion | 200 / 200 / 307 login | 200 | 200 | 307 |
| probarPush | 200 / 200 / 307 login | 200; ok:false (envío deshabilitado) | 200; ok:false (envío deshabilitado) | 307 |
| cerrarSesion | redirect Flight login / redirect Flight login / 307 login | 200; redirect Flight /login; cookie borrada | 200; redirect Flight /login; cookie borrada | 307 |
| accionLogin | 307 / 307 / redirect Flight con credenciales válidas | 307 → / | 307 → / | 200; cookie + redirect /llamados |

## Comprobaciones adicionales

- 31 acciones y 10 páginas: guardia inicial; login público como excepción necesaria.
- 22 módulos use client: sin dependencias runtime transitivas de db/credenciales.
- RUTAS_PUBLICAS: exactamente /login, /api/ingest, /api/vigilancia.
- guardarSuscripcion: EMPLEADO no modifica, borra ni se apropia de endpoint ajeno (fila verificada).
- asegurarSuscripcion: EMPLEADO no modifica, borra ni se apropia de endpoint ajeno (fila verificada).
- cambiarSuscripcion: EMPLEADO no modifica, borra ni se apropia de endpoint ajeno (fila verificada).
- borrarSuscripcion: EMPLEADO no modifica, borra ni se apropia de endpoint ajeno (fila verificada).
- Dueño legítimo: asegurar renueva claves sin reactivar; guardar reactiva. Props no contienen auth en ninguno de los casos.
- POST vigilancia ADMINISTRADOR: 200.
- POST vigilancia EMPLEADO: 403.
- POST vigilancia SIN_SESION: 401.
- GET vigilancia sin sesión, credencial SHA vigente: 200.
- POST vigilancia sin sesión, credencial SHA vigente: 200.
- POST ingest sin sesión: 200 con credencial; ignora área declarada y guarda área asignada.
- Simulador probado solo con DEVICE_KEY temporal registrada al fixture SIMULADO; R1 productivo NO se considera cerrado.
- Vigilancia credencial REVOCADA: 401.
- Vigilancia credencial EXPIRADA: 401.
- Vigilancia credencial INACTIVO: 401.
- Vigilancia credencial INVALIDA: 401.
- Vigilancia legado bcrypt + x-device-code: 200; sin cambiar firmware ni credencial física.
- Tablero EMPLEADO por HTTP: sensor callado 5 minutos muestra sin señal; contacto reciente muestra en línea, sin sección administrativa nueva. El borde 90/91 s se cubre en tests unitarios.
- Bundles cliente y respuestas HTML/Flight inspeccionados: sin secretos conocidos ni hashes; secreto nuevo solo en respuesta de emisión/rotación ADMINISTRADOR.

## Aislamiento y limpieza observados

Operaciones PostgREST: 346. Operaciones bloqueadas por aislamiento: 0.

```json
{
  "areas": 0,
  "empleados": 0,
  "usuarios": 0,
  "dispositivos": 0,
  "llamados": 0,
  "lecturas": 0,
  "dispositivo_credenciales": 0,
  "suscripciones_push": 0,
  "ajustes": 0
}
```

Matriz de autorización OBJETIVO satisfecha por las pruebas anteriores. R1 del simulador sigue pendiente y no se presenta como un problema de permisos resuelto.
