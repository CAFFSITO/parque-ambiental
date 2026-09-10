// lib/tipos.ts
// Tipos compartidos por todo el sistema. Reflejan las tablas de sql/01_esquema.sql.

export type Rol = "ADMINISTRADOR" | "EMPLEADO";

export type TipoLlamado = "NORMAL" | "EMERGENCIA";
export type OrigenLlamado = "SENSOR" | "EMPLEADO";
export type EstadoLlamado = "NO_ATENDIDO" | "ATENDIDO";

export type Area = {
  id: number;
  codigo: string;
  nombre: string;
  tipo: string;
  temp_min: number;
  temp_max: number;
  hum_min: number;
  hum_max: number;
  activa: boolean;
  creada_en: string;
};

export type Empleado = {
  id: number;
  legajo: string;
  nombre: string;
  apellido: string;
  dni: string;
  fecha_nacimiento: string | null;
  telefono: string | null;
  email: string | null;
  domicilio: string | null;
  // area_id, tarea y turno quedan como el valor principal (el primero de cada
  // arreglo). Los consumen el tablero, los llamados y el área de los usuarios.
  area_id: number | null;
  tarea: string | null;
  turno: string | null;
  // Selección múltiple real. Ver sql/04_multiseleccion.sql.
  areas_ids: number[];
  tareas: string[];
  turnos: string[];
  fecha_ingreso: string | null;
  estado: string;
  observaciones: string | null;
  creado_en: string;
};

export type Usuario = {
  id: number;
  usuario: string;
  password_hash: string;
  rol: Rol;
  empleado_id: number | null;
  area_id: number | null;
  activo: boolean;
  creado_en: string;
};

export type Lectura = {
  id: number;
  dispositivo: string | null;
  area_id: number | null;
  temperatura: number | null;
  humedad: number | null;
  tomada_en: string;
};

export type Llamado = {
  id: number;
  area_id: number | null;
  tipo: TipoLlamado;
  origen: OrigenLlamado;
  estado: EstadoLlamado;
  motivo: string | null;
  detalle: string | null;
  creado_por: string | null;
  creado_en: string;
  atendido_por: string | null;
  atendido_en: string | null;
};

/** Contenido del JWT que viaja en la cookie pab_sesion. */
export type Sesion = {
  id: number;
  usuario: string;
  rol: Rol;
  area_id: number | null;
};

/** Semáforo operativo: verde normal, ámbar advertencia, rojo emergencia. */
export type NivelEstado = "NORMAL" | "ADVERTENCIA" | "EMERGENCIA";

/** Respuesta uniforme de todas las Server Actions de ABM. */
export type Resultado =
  | { ok: true; mensaje?: string }
  | { ok: false; error: string };

// =====================================================================
// DISPOSITIVOS Y CREDENCIALES
//
// Agregado por sql/06_dispositivos.sql y sql/08_credenciales_dispositivos.sql.
// Nada de acá arriba se modificó: los tipos anteriores quedan tal cual estaban.
// =====================================================================

/**
 * Separa el hardware real de lo que produce el simulador del panel. Es la
 * columna que impide que una simulación se confunda con una medición.
 * Se fija al crear el dispositivo y no se cambia después: pasar de SIMULADO a
 * FISICO blanquearía historia inventada como si fuera real.
 */
export type NaturalezaDispositivo = "FISICO" | "SIMULADO";

/** Fila de la tabla dispositivos. Ver sql/06_dispositivos.sql. */
export type Dispositivo = {
  id: number;
  /**
   * Identidad pública: es la que viaja en el cuerpo de /api/ingest y la que
   * está grabada en el firmware del nodo. Única en toda la flota.
   */
  codigo: string;
  nombre: string;
  modelo: string | null;
  /** 0 o 1 área. null es un estado válido: nodo nuevo, de repuesto o en tránsito. */
  area_id: number | null;
  activo: boolean;
  naturaleza: NaturalezaDispositivo;
  reporta_temperatura: boolean;
  reporta_humedad: boolean;
  reporta_boton: boolean;
  acciona_rele: boolean;
  acciona_alarma: boolean;
  /** Materializada: último momento en que el dispositivo reportó. */
  ultimo_contacto_en: string | null;
  observaciones: string | null;
  creado_en: string;
};

/**
 * Estado de conexión derivado de ultimo_contacto_en contra el mismo umbral
 * que usa la vigilancia (SEGUNDOS_SIN_SENAL de lib/alertas.ts).
 */
export type EstadoConexion = "EN_LINEA" | "SIN_SENAL" | "NUNCA_REPORTO";

/** Dispositivo con su estado de conexión ya calculado, para las pantallas. */
export type DispositivoConEstado = Dispositivo & {
  conexion: EstadoConexion;
  /** Segundos desde el último reporte, o null si nunca reportó. */
  segundos_sin_reportar: number | null;
};

/**
 * Los cuatro interruptores de automatización que sql/07_automatizacion_areas.sql
 * agregó a la tabla areas. Gobiernan SOLO la actuación del relé: no
 * intervienen en la generación de llamados, que sigue evaluando las cuatro
 * condiciones contra los cuatro umbrales.
 */
export type AutomatizacionArea = {
  /** Accionar cuando temperatura > temp_max (ventilar). */
  auto_temp_alta: boolean;
  /** Accionar cuando temperatura < temp_min. */
  auto_temp_baja: boolean;
  /** Accionar cuando humedad > hum_max. */
  auto_hum_alta: boolean;
  /** Accionar cuando humedad < hum_min (regar). */
  auto_hum_baja: boolean;
};

/**
 * Área con su automatización. Es un tipo aparte y no un campo más de Area
 * para no cambiar el tipo Area, que consumen todas las pantallas actuales.
 */
export type AreaConAutomatizacion = Area & AutomatizacionArea;

/** Resultado de resolver a qué área pertenece un dispositivo. */
export type ResolucionArea =
  | { estado: "CON_AREA"; area: AreaConAutomatizacion }
  /** El dispositivo no tiene área asignada: sin umbrales y sin automatización. */
  | { estado: "SIN_AREA"; area: null }
  /** area_id apunta a un área que no existe. No debería pasar: hay FK. */
  | { estado: "AREA_INEXISTENTE"; area: null };

/** Algoritmos de hash admitidos por dispositivo_credenciales.algoritmo. */
export type AlgoritmoCredencial = "sha256-v1" | "bcrypt-v1";

/** Estados admitidos por dispositivo_credenciales.estado. */
export type EstadoCredencial = "ACTIVA" | "ROTADA" | "REVOCADA";

/** Origen admitido por dispositivo_credenciales.origen. */
export type OrigenCredencial = "GENERADA" | "LEGADO";

/**
 * Credencial tal como se puede mostrar. NO tiene secreto_hash: el hash nunca
 * sale de lib/credenciales.ts, y el secreto en claro no se persiste nunca.
 */
export type CredencialPublica = {
  id: number;
  dispositivo_id: number;
  algoritmo: AlgoritmoCredencial;
  /** Primeros caracteres del secreto, para identificarla sin revelarla. */
  prefijo: string | null;
  estado: EstadoCredencial;
  origen: OrigenCredencial;
  expira_en: string | null;
  usada_en: string | null;
  creada_en: string;
  creada_por: string | null;
  revocada_en: string | null;
  revocada_por: string | null;
  motivo: string | null;
};

/**
 * Lo que devuelve crear o rotar una credencial. El secreto viene UNA sola vez,
 * acá: no se guarda en la base ni se puede volver a consultar.
 */
export type CredencialEmitida = {
  credencial: CredencialPublica;
  /** Mostrar una vez y no persistir. */
  secreto: string;
};

/** Por qué se rechazó una autenticación de dispositivo. */
export type MotivoRechazo =
  | "SIN_CLAVE"
  | "CREDENCIAL_INVALIDA"
  | "CREDENCIAL_REVOCADA"
  | "CREDENCIAL_VENCIDA"
  | "DISPOSITIVO_INACTIVO";

/**
 * Resultado de autenticar un dispositivo por su clave.
 *
 * Un dispositivo SIN área asignada autentica igual (ok: true): tiene identidad
 * válida y su lectura se guarda. Lo que no tiene es umbrales ni automatización,
 * y eso lo dice resolverArea().
 */
export type ResolucionAcceso =
  | { ok: true; dispositivo: Dispositivo; credencialId: number }
  | { ok: false; motivo: MotivoRechazo };
