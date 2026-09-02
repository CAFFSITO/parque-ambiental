// lib/catalogos.ts
// Catálogos cerrados y reglas de texto compartidas por servidor y cliente.
// No importa nada del servidor, así lo pueden usar los componentes "use client".

import type { Rol } from "./tipos";

export const TAREAS: readonly string[] = [
  "Operario de invernadero",
  "Técnico en riego",
  "Encargado de hidroponía",
  "Auxiliar de vivero",
  "Responsable de compostaje",
  "Mantenimiento eléctrico",
  "Administrativo",
  "Supervisor de turno",
];

export const TIPOS_AREA: readonly string[] = [
  "invernadero",
  "hidroponia",
  "compostaje",
  "vivero",
  "servicios",
];

export type Turno = "M" | "T" | "N";

export const TURNOS: readonly { codigo: Turno; nombre: string }[] = [
  { codigo: "M", nombre: "Mañana" },
  { codigo: "T", nombre: "Tarde" },
  { codigo: "N", nombre: "Noche" },
];

export type EstadoEmpleado = "activo" | "licencia" | "baja";

export const ESTADOS_EMPLEADO: readonly EstadoEmpleado[] = [
  "activo",
  "licencia",
  "baja",
];

export const ROLES: readonly Rol[] = ["ADMINISTRADOR", "EMPLEADO"];

export const LARGO_MINIMO_PASSWORD = 8;

export function esTurno(valor: string): valor is Turno {
  return valor === "M" || valor === "T" || valor === "N";
}

export function esEstadoEmpleado(valor: string): valor is EstadoEmpleado {
  return valor === "activo" || valor === "licencia" || valor === "baja";
}

export function esRol(valor: string): valor is Rol {
  return valor === "ADMINISTRADOR" || valor === "EMPLEADO";
}

export function nombreTurno(codigo: string | null): string {
  return TURNOS.find((turno) => turno.codigo === codigo)?.nombre ?? "—";
}

/** Marcas diacríticas combinantes (bloque Unicode U+0300 a U+036F). */
const MARCAS_DIACRITICAS = new RegExp("[\\u0300-\\u036f]", "g");

/** Saca acentos y deja solo letras y números en minúscula. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(MARCAS_DIACRITICAS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Nombre de usuario propuesto: inicial del nombre + apellido en minúsculas.
 * "Lucía Barrios" -> "lbarrios"
 */
export function sugerirUsuario(nombre: string, apellido: string): string {
  const inicial = normalizar(nombre).slice(0, 1);
  return `${inicial}${normalizar(apellido)}`;
}

/**
 * Catálogo cerrado de motivos de llamado. El antirrebote agrupa por
 * (área + motivo), así que estos textos son la clave de deduplicación:
 * no los cambies sin migrar los llamados abiertos.
 */
export const MOTIVOS = {
  TEMP_ALTA: 'Temperatura por encima del umbral',
  TEMP_BAJA: 'Temperatura por debajo del umbral',
  HUM_ALTA: 'Humedad por encima del umbral',
  HUM_BAJA: 'Humedad por debajo del umbral',
  SIN_SENAL: 'Sensor sin señal',
  BOTON_EMERGENCIA: 'Botón de emergencia accionado',
  ASISTENCIA: 'Solicitud de asistencia',
  RIEGO: 'Falla en el sistema de riego',
  ENERGIA: 'Corte de energía en el área',
  INSUMOS: 'Solicitud de insumos',
  PLAGA: 'Plaga o anomalía detectada en cultivo',
} as const;

/** Todos los motivos, en el orden en que se ofrecen en los selectores. */
export const LISTA_MOTIVOS: readonly string[] = Object.values(MOTIVOS);

/**
 * Motivos que puede elegir una persona al cargar un llamado a mano. Los que
 * quedan afuera los genera el servidor a partir de las lecturas del nodo.
 */
export const MOTIVOS_MANUALES: readonly string[] = [
  MOTIVOS.ASISTENCIA,
  MOTIVOS.RIEGO,
  MOTIVOS.ENERGIA,
  MOTIVOS.INSUMOS,
  MOTIVOS.PLAGA,
  MOTIVOS.BOTON_EMERGENCIA,
];

export const TIPOS_LLAMADO: readonly string[] = ['NORMAL', 'EMERGENCIA'];
export const ORIGENES_LLAMADO: readonly string[] = ['SENSOR', 'EMPLEADO'];
export const ESTADOS_LLAMADO: readonly string[] = ['NO_ATENDIDO', 'ATENDIDO'];
