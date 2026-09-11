// lib/catalogos.ts
// Catálogos cerrados y reglas de texto compartidas por servidor y cliente.
// No importa nada del servidor, así lo pueden usar los componentes "use client".

import type { Rol } from "./tipos";

/**
 * Tareas, tipos de área y turnos son catálogos ABIERTOS: estas listas son el
 * punto de partida que ofrece el selector, pero cualquiera puede crear una
 * opción nueva escribiéndola. Las opciones vigentes se arman uniendo estas
 * constantes con los valores que ya están guardados en la base.
 */
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

/**
 * Los tres turnos históricos se guardan por código (M, T, N) y se muestran con
 * su nombre. Un turno creado a mano se guarda y se muestra tal cual se escribió.
 */
export function nombreTurno(codigo: string | null): string {
  if (codigo === null || codigo.trim() === "") return "—";
  return (
    TURNOS.find((turno) => turno.codigo === codigo)?.nombre ?? codigo.trim()
  );
}

/** Largo máximo de una opción creada a mano (tarea, tipo de área o turno). */
export const LARGO_MAXIMO_OPCION = 48;

/**
 * Normaliza una opción escrita por una persona: sin espacios de sobra ni
 * saltos de línea, y acotada para que no desarme la interfaz.
 */
export function normalizarOpcion(texto: string): string {
  return texto.replace(/\s+/g, " ").trim().slice(0, LARGO_MAXIMO_OPCION);
}

/**
 * Une el catálogo base con los valores que ya existen en la base y deduplica
 * sin distinguir mayúsculas ni acentos, respetando el orden de aparición.
 */
export function unirOpciones(
  base: readonly string[],
  guardados: readonly (string | null)[],
): string[] {
  const vistas = new Map<string, string>();

  for (const crudo of [...base, ...guardados]) {
    const valor = normalizarOpcion(crudo ?? "");
    if (valor === "") continue;

    const clave = valor
      .normalize("NFD")
      .replace(MARCAS_DIACRITICAS, "")
      .toLowerCase();

    if (!vistas.has(clave)) vistas.set(clave, valor);
  }

  return [...vistas.values()];
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
 * Motivos que se ofrecen al cargar un llamado a mano, separados por tipo.
 * Elegir NORMAL muestra solo los de la izquierda; EMERGENCIA, solo los de la
 * derecha. Son la base: cada tipo puede sumar los suyos desde la misma ficha
 * (se guardan en la tabla ajustes, ver lib/motivos.ts).
 */
export const MOTIVOS_MANUALES_POR_TIPO: Record<'NORMAL' | 'EMERGENCIA', readonly string[]> = {
  NORMAL: [MOTIVOS.ASISTENCIA, MOTIVOS.INSUMOS, MOTIVOS.RIEGO, MOTIVOS.PLAGA],
  EMERGENCIA: [MOTIVOS.BOTON_EMERGENCIA, MOTIVOS.ENERGIA],
};

/** Largo máximo de un motivo creado a mano. */
export const LARGO_MAXIMO_MOTIVO = 80;

export const TIPOS_LLAMADO: readonly string[] = ['NORMAL', 'EMERGENCIA'];
export const ORIGENES_LLAMADO: readonly string[] = ['SENSOR', 'EMPLEADO'];
export const ESTADOS_LLAMADO: readonly string[] = ['NO_ATENDIDO', 'ATENDIDO'];

/**
 * Cómo se lee el estado de un llamado en pantalla. En la base sigue siendo
 * NO_ATENDIDO / ATENDIDO —es lo que filtran las consultas y las funciones de
 * reportes—; esto cambia solo lo que ve la persona. Cualquier otro valor pasa
 * tal cual, así se puede usar sobre las etiquetas mezcladas de la torta.
 */
export function etiquetaEstado(estado: string): string {
  if (estado === 'NO_ATENDIDO') return 'No Atendido';
  if (estado === 'ATENDIDO') return 'Atendido';
  return estado;
}
