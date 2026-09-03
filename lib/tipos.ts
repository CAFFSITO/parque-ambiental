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
