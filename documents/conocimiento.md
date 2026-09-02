CONOCIMIENTO — Olimpíadas EEST N.º 2 Berisso · Equipo NEXO

Este archivo es el canon del proyecto. Todo lo que está acá se da por verdadero. Si algo no está acá, no existe: hay que inventarlo siguiendo las reglas de la sección 3 y después agregarlo a este archivo.

1. La situación
1.1. Qué es esto

Olimpíadas institucionales de la Escuela Técnica N.º 2 de Berisso, especialidad Informática. Del 18/08 al 25/08, de 18:35 a 21:30 hs, en los laboratorios.

Dato clave: las olimpíadas las organiza y evalúa la escuela, no el INET. Los evaluadores son los profesores de la institución. Eso cambia todo:

No hay una rúbrica externa desconocida. Hay criterio docente.
El jurado conoce a los alumnos y conoce el nivel real del curso.
Gana el equipo que entrega funcionando, se entiende, y lo cuenta bien.
Un profesor no puede evaluar lo que no ve. Todo lo que no se demuestra en vivo, no existe.
1.2. El equipo

Tres personas de 7.º año, especialidad Informática:

Persona	Rol en las olimpíadas	Perfil real
Thiago Ibañez	Estrategia, software, guion de defensa, informe	Vende alto ticket. Fuerte en narrativa y estructura.
Matías Grau	Software (junto a Thiago)	Vende alto ticket. Fuerte en comunicación.
Sofia Coria	Hardware: armado, cableado, nodo físico	Estructura y organización. Nunca armó un circuito.

La asignación de hardware/software es la que definió el equipo. Si en algún momento cambian de persona, se actualiza esta tabla y nada más.

Nivel técnico real, sin maquillaje: el equipo no domina programación profunda. Se apalanca en IA para construir, y en su capacidad de venta y de relato para presentar. Eso no es una debilidad si el alcance está bien elegido. Es una debilidad fatal si eligen un alcance que no pueden terminar.

Regla madre del proyecto: alcance chico, terminado, andando y bien contado le gana siempre a alcance grande a medio hacer.

1.3. El profesor asesor

Daniel Serganzukc (Dani), jefe de área de Informática. Aliado del equipo.

1.4. Contexto paralelo (NEXO)

El equipo desarrolla en paralelo NEXO, una plataforma educativa, y Experiencia NEXO, un ciclo de seminarios de formación docente. NEXO tiene un mensaje central:

Existe una degradación instalada de la imagen del estudiante. Se lo da por perdido, desconectado, incapaz. NEXO existe para demostrar con hechos que esa mirada está equivocada. La influencia real se ejerce desde la humildad y la cercanía, no desde arriba.

Cómo entra ese mensaje en las olimpíadas — leer con atención:

❌ NO se fuerza NEXO dentro de la solución del invernadero. No tiene nada que ver. Meterlo con calzador se lee como oportunismo y resta puntos.
❌ NO se hace un discurso sobre educación en medio de una defensa técnica.
✅ SÍ entra como hecho demostrado, no como discurso: el mensaje es que una estudiante que nunca en su vida había armado un circuito armó el nodo que están viendo funcionar, y que el equipo aprendió el stack completo en seis días.
✅ SÍ entra en la metodología documentada del informe final: cómo trabajaron, cómo usaron IA como copiloto y no como piloto, cómo se repartieron roles.
✅ SÍ entra en los últimos 30 segundos de la defensa, una sola vez, sin épica.

El mensaje se demuestra, no se declama. Un hecho vale más que un párrafo.

2. La consigna, desarmada en requisitos verificables

Transcripción operativa de la consigna oficial. Cada línea es una casilla que el jurado puede tildar o no tildar.

2.1. Enunciado

Automatizar e informatizar varios invernaderos existentes en un parque ambiental, para mantener reguladas temperatura y humedad, tomando información del ambiente mediante sensores Arduino, con el fin de obtener resultados óptimos en los cultivos.

La solución tiene dos partes:

2.2. Parte A — Sistema de gestión y reportes estadísticos
#	Requisito literal	Estado
A1	Configuración del sistema para creación de áreas o zonas dentro del parque	obligatorio
A2	Asignación de un administrador y empleados	obligatorio
A3	Ficha de empleados con datos personales y su tarea dentro del parque	obligatorio
A4	Creación y edición de usuarios. Dos tipos: Administrador (acceso irrestricto) y Genérico/empleado (acceso parcial)	obligatorio
A5	Cantidad y tipo de llamados (Normal o Emergencia), Atendidos y No atendidos	obligatorio
A6	Visualizador de reportes en tablas o gráficos (barras, pastel, líneas)	obligatorio — los tres tipos
A7	Filtrado de reportes por: Área; Origen del llamado (invernaderos, hidroponía, etc.); Fecha y hora	obligatorio — los tres filtros
A8	Exportación de reportes en PDF o CSV	obligatorio
2.3. Parte B — Aplicación móvil web asociada
#	Requisito literal	Estado
B1	Acceso mediante usuario y contraseña	obligatorio
B2	Ver alertas emitidas por sensores o por empleados desde el celular	obligatorio
B3	Notificación vía WhatsApp, Telegram o mail	obligatorio (alcanza con uno)
2.4. Aclaración de los docentes

Los llamados pueden ser producidos por una emergencia que llega desde las diferentes áreas del parque. O bien por los empleados del parque.

Traducción: cada llamado tiene un origen, y hay exactamente dos: SENSOR o EMPLEADO. Ambos caminos tienen que ser demostrables en vivo. Esto justifica el botón físico del nodo.

2.5. Requerimientos operativos
Herramientas y estrategias de software: a elección del equipo.
Sugerencias orientativas (no obligatorias): servidor Apache o similar; comunicaciones Wi-Fi; lenguaje de alto nivel (PHP, Java, .NET u otros); motor de base de datos MySQL.
Criterios y alcance de la base de datos: a elección del equipo.
2.6. EL REQUISITO QUE DECIDE EL PODIO

El sistema desarrollado debe estar en un servidor con acceso por usuario y clave de carácter público, y se deben incluir en la presentación las credenciales de acceso. Este es un requisito obligatorio.

Esto significa:

URL pública en internet, abierta desde cualquier celular fuera de la red de la escuela.
Login con usuario y contraseña.
Las credenciales impresas en la presentación y en el informe.

Se resuelve el Día 1, no el Día 6. Un equipo con un CRUD mediocre deployado le gana a un equipo con un sistema hermoso en localhost. Es la única casilla del enunciado marcada explícitamente como obligatoria dos veces.

2.7. Transferencia de la información (informe final)
INFORME FINAL con los criterios técnicos consensuados al seleccionar herramientas y estrategias, más las ventajas y desventajas operativas que estiman que subyacen.
Listado bibliográfico extendido (hojas de datos, links, documentos, libros) e indicar cuáles fueron los criterios de esa selección.

Ojo con la segunda parte: no alcanza con pegar una lista de links. Hay que decir por qué se eligió cada fuente. Casi ningún equipo lo va a hacer. Es puntaje regalado.

3. El mundo inventado (CANON — no se investiga, se inventa)

Regla: no se hace ninguna investigación real sobre parques ambientales, empleados reales ni datos reales. Todo el dominio es ficción coherente, definida acá. Si hace falta un dato nuevo, se inventa respetando lo que ya está escrito y se agrega a este archivo.

3.1. La organización

Parque Ambiental Municipal de Berisso. Superficie ficticia: 4,2 hectáreas. Personal: 14 empleados + 1 administrador. Funciona en tres turnos. Produce hortalizas de hoja, aromáticas, plantines forestales y cultivo hidropónico para huertas comunitarias del partido.

3.2. Áreas del parque (tabla areas)
Código	Nombre	Tipo	T° mín	T° máx	Hum. mín	Hum. máx
INV-N	Invernadero Norte	invernadero	18	28	60	80
INV-S	Invernadero Sur	invernadero	16	26	50	70
INV-G	Invernadero de Germinación	invernadero	22	30	70	90
HID-1	Hidroponía	hidroponia	18	24	55	75
COM-1	Playa de Compostaje	compostaje	10	45	40	90
VIV-1	Vivero Forestal	vivero	12	32	45	85
RIE-1	Sala de Bombas y Riego	servicios	5	40	20	80
DEP-1	Depósito y Taller	servicios	5	40	20	80

INV-N (Invernadero Norte) es el área con nodo físico real. Las otras siete se alimentan con datos sembrados. Esto es una decisión de diseño deliberada y se explica así en la defensa: "un nodo real, siete simulados; el sistema es idéntico para los ocho porque el protocolo de ingesta es el mismo."

3.3. Puestos / tareas (campo tarea de la ficha de empleado)

Operario de invernadero · Técnico en riego · Encargado de hidroponía · Auxiliar de vivero · Responsable de compostaje · Mantenimiento eléctrico · Administrativo · Supervisor de turno

3.4. Turnos
Código	Horario
M	Mañana, 06:00–14:00
T	Tarde, 14:00–22:00
N	Noche, 22:00–06:00
3.5. Ficha de empleado (tabla empleados)

Campos: legajo (único, formato PAB-0001) · nombre · apellido · dni · fecha_nacimiento · telefono · email · domicilio · area_id · tarea · turno · fecha_ingreso · estado (activo / licencia / baja) · observaciones

3.6. Nómina inventada (15 registros)
Legajo	Apellido, Nombre	DNI	Área	Tarea	Turno
PAB-0001	Almada, Ricardo	14.882.301	DEP-1	Administrativo	M
PAB-0002	Barrios, Lucía	33.104.556	INV-N	Operario de invernadero	M
PAB-0003	Cabrera, Ezequiel	35.771.209	INV-N	Operario de invernadero	T
PAB-0004	Duarte, Marisa	28.640.117	INV-S	Operario de invernadero	M
PAB-0005	Escobar, Julián	40.229.884	INV-S	Operario de invernadero	T
PAB-0006	Ferreyra, Noelia	31.556.740	INV-G	Operario de invernadero	M
PAB-0007	Gauna, Hernán	26.913.402	HID-1	Encargado de hidroponía	M
PAB-0008	Herrera, Camila	42.087.663	HID-1	Auxiliar de vivero	T
PAB-0009	Ibarra, Sergio	22.470.918	RIE-1	Técnico en riego	M
PAB-0010	Juárez, Andrés	37.302.145	RIE-1	Mantenimiento eléctrico	T
PAB-0011	Ledesma, Patricia	29.884.033	VIV-1	Auxiliar de vivero	M
PAB-0012	Maidana, Gustavo	24.115.678	COM-1	Responsable de compostaje	M
PAB-0013	Núñez, Federico	38.446.290	DEP-1	Supervisor de turno	N
PAB-0014	Ojeda, Valeria	34.920.775	INV-G	Supervisor de turno	T
PAB-0015	Peralta, Damián	41.663.208	VIV-1	Operario de invernadero	N
3.7. Usuarios y roles (tabla usuarios)

Dos roles, exactamente como pide la consigna:

ADMINISTRADOR — acceso irrestricto Ve todas las áreas · ABM de áreas · ABM de empleados · ABM de usuarios · ve y atiende todos los llamados · accede a reportes completos · exporta PDF y CSV · configura umbrales · accede al panel de dispositivos.

EMPLEADO (genérico) — acceso parcial Ve solo su área asignada · ve y atiende llamados de su área · genera llamados manuales · ve sus propios datos de ficha (no los edita) · no accede a ABM de áreas, empleados ni usuarios · no exporta reportes · no configura umbrales.

Credenciales de demostración (van impresas en el informe y en la presentación):

Usuario	Contraseña	Rol	Área
admin	Parque2026!	ADMINISTRADOR	todas
lbarrios	Invernadero1!	EMPLEADO	INV-N
hgauna	Hidroponia1!	EMPLEADO	HID-1
3.8. Llamados (tabla llamados) — el corazón del sistema

Un llamado es un evento que requiere atención humana.

Campo	Valores
tipo	NORMAL | EMERGENCIA
origen	SENSOR | EMPLEADO
estado	NO_ATENDIDO | ATENDIDO
area_id	referencia a areas
motivo	del catálogo de abajo
detalle	texto libre; para sensores, la lectura que lo disparó
creado_en	timestamp
atendido_por	usuario que lo atendió (null si no atendido)
atendido_en	timestamp (null si no atendido)
creado_por	usuario (si origen = EMPLEADO) o dispositivo (si origen = SENSOR)

Catálogo de motivos

Motivo	Origen típico	Tipo típico
Temperatura por encima del umbral	SENSOR	NORMAL / EMERGENCIA
Temperatura por debajo del umbral	SENSOR	NORMAL / EMERGENCIA
Humedad por encima del umbral	SENSOR	NORMAL / EMERGENCIA
Humedad por debajo del umbral	SENSOR	NORMAL / EMERGENCIA
Sensor sin señal	SENSOR	EMERGENCIA
Botón de emergencia accionado	EMPLEADO	EMERGENCIA
Solicitud de asistencia	EMPLEADO	NORMAL
Falla en el sistema de riego	EMPLEADO	EMERGENCIA
Corte de energía en el área	EMPLEADO	EMERGENCIA
Solicitud de insumos	EMPLEADO	NORMAL
Plaga o anomalía detectada en cultivo	EMPLEADO	NORMAL
3.9. Regla de disparo automático (la lógica que hay que poder explicar)

Con la lectura de un sensor y los umbrales del área:

desvío = cuánto se salió del rango permitido

desvío = 0                          → sin llamado
0 < desvío ≤ 3 °C   ó  ≤ 10 % HR    → llamado NORMAL
desvío > 3 °C       ó  > 10 % HR    → llamado EMERGENCIA
sin datos del nodo por más de 90 s  → llamado EMERGENCIA "Sensor sin señal"

Antirrebote: si ya existe un llamado NO_ATENDIDO del mismo área y mismo motivo, no se crea uno nuevo. Se actualiza el detalle. Esto evita que una demo de dos minutos genere cuarenta llamados y arruine los gráficos.

3.10. Datos históricos sembrados

Para que los reportes tengan de qué hablar: 300 a 500 llamados distribuidos en los últimos 90 días, sobre las 8 áreas, con mezcla realista:

~70 % NORMAL, ~30 % EMERGENCIA
~65 % origen SENSOR, ~35 % origen EMPLEADO
~80 % ATENDIDO, ~20 % NO_ATENDIDO
concentración mayor en INV-G y HID-1 (áreas más sensibles) — que el gráfico cuente algo
lecturas de sensores cada 15 minutos para las curvas de líneas
4. Hardware
4.1. Inventario real disponible
Placa ESP32-C3 Super Mini (V1601) — muy pequeña, USB-C, Wi-Fi integrado, USB nativo sin chip conversor. Vino sin las patitas puestas y no se puede soldar, así que se monta con pines pasantes (ver más abajo). Solo 13 pines utilizables, de los cuales 2, 8 y 9 están reservados y no se usan.
Los números de los pines están impresos en la cara de atrás. Como la placa se monta con los componentes hacia arriba, la vista de trabajo está espejada respecto de la cara rotulada. Es el error más caro posible: conectar 5V donde va una señal quema el módulo. Regla de anclaje: con el USB-C lejos y los componentes arriba, 5V es el primero de la fila derecha.
Kit 37 Sensor Kit (módulos KY-xxx) — ver foto del kit
Cables Dupont
Protoboard
No hay mucho más. Todo lo que se diseñe tiene que caber en esto.
4.2. Módulos del kit que se usan (solo 4)
Módulo	Qué hace en el proyecto	Requisito de la consigna que cubre
DHT11 (temp. y humedad)	Mide el ambiente del Invernadero Norte	Núcleo del enunciado
Módulo relé	Actúa: enciende extractor / riego simulado	"mantener reguladas" temp. y humedad
Buzzer activo	Alarma local en el invernadero	Alerta de sensor
Botón (KY-004)	Llamado manual del empleado en el área	Aclaración docente: llamados por empleados

Todo lo demás del kit no se toca. Cada módulo extra es tiempo que no tienen.

4.3. Nodo físico

Un solo nodo, en INV-N. Nombre del dispositivo: NODO-INV-N-01. Armado sin soldadura, íntegramente con protoboard y cables Dupont: la escuela no autoriza soldar para no inutilizar componentes del kit. Todo el nodo es reversible.

Método de montaje: pin pasante. La placa no tiene patitas. El pincho macho del cable Dupont entra desde arriba, atraviesa el agujero de la placa y se clava en la protoboard; la protoboard sujeta el pincho y el pincho hace contacto con el aro metálico del agujero. Se usan solo 7 de los 16 agujeros y se fija todo con cinta de papel. Es un contacto por presión: más frágil que una soldadura. Ante cualquier falla intermitente del nodo, la primera hipótesis siempre es un pin pasante flojo, nunca el código.

Asignación de pines de la ESP32-C3 Super Mini:

Pin	Módulo	Cable
5	DHT11 (señal)	amarillo
6	Relé (señal)	verde
7	Buzzer (señal)	verde
10	Botón (señal)	azul
3V3	fila + de la protoboard	rojo
G	fila − de la protoboard	negro
5V	alimentación del relé	naranja

Pines prohibidos: 2, 8 y 9. La placa los lee al encender para decidir cómo arrancar; si se les conecta algo, el nodo falla de formas difíciles de diagnosticar.

Ver manual_hardware.md para el armado completo, patita por patita.

5. Stack de software elegido y su justificación

La consigna deja la elección libre y exige justificar los criterios en el informe. Estas son las decisiones y sus razones, listas para volcar al informe final.

Capa	Elección	Por qué (criterio para el informe)	Desventaja honesta
Framework	Next.js (React) + TypeScript	Un solo proyecto resuelve interfaz de escritorio, interfaz móvil y API de ingesta. Menos piezas = menos superficie de falla en 6 días.	Curva inicial mayor que PHP plano; requiere Node.
Estilos	Tailwind CSS	Permite densidad visual controlada sin escribir CSS suelto disperso.	Marcado más verboso.
Base de datos	PostgreSQL (Supabase)	La consigna sugiere MySQL pero deja la elección libre. Postgres da tipos fecha/hora más ricos para los filtros por fecha y hora, y Supabase provee la instancia gratis, con panel visual de tablas.	Se desvía de la sugerencia orientativa; hay que defenderlo.
Autenticación	Propia: tabla usuarios + hash bcrypt + sesión firmada JWT en cookie	La consigna exige que el administrador cree y edite usuarios. Con auth propia eso es un ABM común. Con un proveedor externo hay que pelear contra su panel.	Hay que implementar bien el hash y la cookie.
Gráficos	Recharts	Da barras, torta y líneas — exactamente los tres tipos que pide A6 — con la misma API.	Menos control fino que D3.
Exportar CSV	Generación directa en el servidor	Cero dependencias, formato universal, abre en Excel.	—
Exportar PDF	Vista de impresión con CSS @media print → "Guardar como PDF"	Es el método que nunca falla en una demo. Sale idéntico en cualquier máquina.	No genera el archivo por código; lo genera el navegador.
Notificaciones	Telegram Bot API	Gratis, instantáneo, sin aprobación previa, sin verificación de empresa. WhatsApp exige API de negocios y verificación: imposible en 6 días. Mail cae en spam y no se ve en vivo.	Requiere que el jurado vea un celular con Telegram.
Hosting	Vercel	URL pública HTTPS en minutos, gratis, deploy automático desde Git. Resuelve el requisito obligatorio 2.6.	Funciones serverless: no sirve para conexiones persistentes.
Gestor de paquetes	Yarn, nunca npm	Un solo gestor evita archivos de bloqueo duplicados, que hacen fallar el deploy en Vercel sin mensaje claro.	Hay que traducir los comandos npm de cualquier tutorial.
Microcontrolador	ESP32-C3 Super Mini	Wi-Fi integrado, USB nativo sin driver, tamaño mínimo, y era la placa disponible.	Alcance de radio reducido por diseño de antena; menos pines y tres reservados; sin patitas de fábrica, montada por contacto a presión al no estar permitido soldar.
ESP32 → servidor	HTTP POST con clave de dispositivo en cabecera	Simple, depurable, funciona sobre cualquier Wi-Fi con salida a internet.	Sin cifrado extremo a extremo del dispositivo; se menciona como mejora futura.
5.1. Contrato de la API de ingesta

El ESP32 manda cada 10 segundos:

POST https://<dominio>/api/ingest
Content-Type: application/json
x-device-key: <clave secreta del dispositivo>

{
  "dispositivo": "NODO-INV-N-01",
  "area": "INV-N",
  "temperatura": 24.6,
  "humedad": 71.2,
  "boton": "NINGUNO"
}

boton puede ser NINGUNO, NORMAL (pulsación corta) o EMERGENCIA (pulsación larga, ≥ 2 segundos).

El servidor responde:

json
{ "ok": true, "rele": true, "alarma": false }

rele le dice al nodo si tiene que encender el actuador. alarma si tiene que sonar el buzzer. Así la decisión vive en el servidor y no en el firmware: si hay que cambiar un umbral en plena defensa, se cambia en la web y el nodo obedece. Esto es un punto fuerte para contar.

6. Plan de 6 días

Se ordena por riesgo: primero lo que puede matar el proyecto, después lo que suma puntos.

Día	Software (Thiago + Matías)	Hardware (Sofia)	Hito no negociable
D1	Proyecto creado, base de datos con esquema y datos sembrados, login funcionando, deploy público andando	Reconocer la placa, instalar el entorno, hacer parpadear un LED interno	URL pública con login. Si esto no está, se para todo hasta que esté.
D2	ABM de áreas, empleados y usuarios. Permisos por rol.	Montaje por pin pasante de los 7 agujeros + prueba del meneo. DHT11 leyendo por monitor serie.	Un administrador crea un empleado y un usuario, y ese usuario entra.
D3	Llamados: listado, alta manual, atender, API de ingesta.	Relé + buzzer + botón cableados. Nodo conectado al Wi-Fi.	El nodo real crea un llamado en la web.
D4	Reportes: barras, torta, líneas. Los tres filtros. Exportar CSV y PDF.	Nodo montado prolijo, cables ordenados, cartel identificatorio.	Los tres gráficos y los tres filtros andando.
D5	Vista móvil + Telegram. Modo simulador para plan B. Pulido visual.	Ensayo de armado y desarme. Prueba con hotspot del celular.	Alerta llegando a Telegram en vivo.
D6	Informe final + guion de defensa + ensayo cronometrado.	Ensayo general completo.	Ensayo entero sin frenar, dos veces.

Corte de alcance: a partir del D5 no se agrega ninguna funcionalidad nueva. Solo se arregla, se pule y se ensaya. Una función nueva el último día es la forma más común de perder una competencia.

7. Riesgos conocidos y sus planes B
Riesgo	Probabilidad	Plan B, decidido de antemano
El Wi-Fi de la escuela tiene portal cautivo y el ESP32 no puede salir	Alta	Hotspot del celular. Las credenciales del hotspot van cargadas en el firmware desde el D3 y probadas el D5.
No hay internet el día de la defensa	Media	Modo simulador: un botón en el panel de administración inyecta lecturas y dispara llamados sin el nodo. La web sigue en línea desde el celular con datos móviles.
El DHT11 devuelve nan o lecturas raras	Media	Es el defecto típico del DHT11: no se lo puede leer más rápido que cada 2 segundos. El firmware descarta lecturas inválidas y repite la anterior.
La placa no tiene patitas y el contacto es por presión	Confirmado, ya es un hecho	Montaje por pin pasante, solo 7 agujeros, fijado con cinta de papel, prueba del meneo antes de cada sesión. Si queda inestable: pedir otra placa con patitas o que un docente las coloque. El modo simulador del panel cubre la demo pase lo que pase.
Se confunde la orientación de la placa por el espejo de las caras	Alta	Antes de tocar un cable se verifica la regla de anclaje: USB-C lejos, componentes arriba, 5V primero de la fila derecha. Conectar 5 V en una señal quema el módulo.
El Wi-Fi de la C3 Super Mini se cae o tiene poco alcance	Alta	Defecto conocido del diseño de antena de esta placa. Hotspot sobre la misma mesa, a menos de 2 m, antena libre y sin metal encima. Va documentado en el informe como desventaja operativa mitigada.
El nodo se desconecta en medio de la demo	Media	El servidor genera "Sensor sin señal" a los 90 s. Eso también es una función que se muestra: la caída se convierte en demostración.
Alguien toca el código el día de la defensa	Baja pero mortal	Congelamiento el D5 a la noche. El D6 nadie toca nada.
El relé no conmuta	Media	Muchos módulos relé son de activación en bajo. El firmware tiene una constante para invertirlo en una línea.
El proyector no toma la notebook	Media	Adaptador propio + la web abierta también en dos celulares.
8. La defensa (estructura de 20 minutos)
Bloque	Tiempo	Contenido
1. El problema	2 min	Qué pierde el parque hoy sin automatización. Concreto, con un número inventado creíble.
2. La arquitectura	3 min	Un solo diagrama: nodo → internet → servidor público → web y celular. Explicar por qué la decisión vive en el servidor.
3. Demo en vivo	9 min	Guion cerrado, en este orden: login admin → áreas y empleados → crear usuario empleado → entrar con ese usuario y mostrar el acceso parcial → volver a admin → el nodo real dispara un llamado por calor → aparece en pantalla → llega a Telegram → atenderlo → Sofia aprieta el botón físico → llamado de origen EMPLEADO → reportes con los tres gráficos → aplicar los tres filtros → exportar CSV → exportar PDF.
4. Criterios técnicos	3 min	Tres decisiones y sus contrapartidas. Nombrar las desventajas: nadie las nombra y demuestra criterio.
5. Cierre	3 min	Credenciales públicas en pantalla, URL grande. Y una sola frase sobre cómo trabajaron: quién armó su primer circuito en la vida, y cuánto tardaron en aprender el stack. Sin épica.

El orden de la demo no es casual: empieza por lo que no puede fallar (login, ABM) y deja el hardware para cuando ya hay puntos asegurados en el bolsillo.

9. Vocabulario del proyecto

Usar siempre los mismos términos, en la interfaz, el informe y la defensa:

área (no "zona" ni "sector") · llamado (no "alerta" ni "ticket" ni "incidente") · tipo: Normal / Emergencia · origen: Sensor / Empleado · estado: Atendido / No atendido · ficha de empleado · nodo · umbral · lectura

Coherencia de vocabulario = percepción de sistema pensado.