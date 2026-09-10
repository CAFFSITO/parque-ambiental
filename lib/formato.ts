// lib/formato.ts
// Formato único de fechas y números para todo el panel.
// Fechas siempre dd/mm/aaaa HH:mm en hora de Argentina, así el servidor
// (Vercel corre en UTC) y el operador ven lo mismo.

const ZONA = "America/Argentina/Buenos_Aires";

const PARTES_FECHA_HORA = new Intl.DateTimeFormat("es-AR", {
  timeZone: ZONA,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const PARTES_FECHA = new Intl.DateTimeFormat("es-AR", {
  timeZone: ZONA,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export const SIN_DATO = "—";

function aFecha(valor: string | Date | null | undefined): Date | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const fecha = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

/** dd/mm/aaaa HH:mm */
export function fechaHora(valor: string | Date | null | undefined): string {
  const fecha = aFecha(valor);
  if (!fecha) return SIN_DATO;

  const partes = PARTES_FECHA_HORA.formatToParts(fecha);
  const buscar = (tipo: string): string =>
    partes.find((parte) => parte.type === tipo)?.value ?? "";

  return `${buscar("day")}/${buscar("month")}/${buscar("year")} ${buscar("hour")}:${buscar("minute")}`;
}

/** dd/mm/aaaa */
export function fechaCorta(valor: string | Date | null | undefined): string {
  const fecha = aFecha(valor);
  if (!fecha) return SIN_DATO;

  const partes = PARTES_FECHA.formatToParts(fecha);
  const buscar = (tipo: string): string =>
    partes.find((parte) => parte.type === tipo)?.value ?? "";

  return `${buscar("day")}/${buscar("month")}/${buscar("year")}`;
}

/** Número con coma decimal y cantidad fija de decimales. */
export function numero(
  valor: number | null | undefined,
  decimales = 1,
): string {
  if (valor === null || valor === undefined || Number.isNaN(valor)) {
    return SIN_DATO;
  }
  return valor.toLocaleString("es-AR", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
}

/** Entero con separador de miles. */
export function entero(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || Number.isNaN(valor)) {
    return SIN_DATO;
  }
  return valor.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

/**
 * Antigüedad en lenguaje corriente: "hace 12 s", "hace 4 min", "hace 2 h".
 *
 * Para un nodo, "hace 3 min" se entiende de un vistazo y una fecha completa no:
 * lo que importa es si reportó recién o hace rato. La fecha exacta se sigue
 * mostrando al lado con fechaHora(), para cuando hace falta precisión.
 *
 * Los cortes son los de la lectura, no los del reloj: hasta 90 segundos se
 * cuenta en segundos, porque 90 es el umbral con el que la vigilancia declara
 * caído a un nodo y ahí cada segundo significa algo.
 */
export function hace(segundos: number | null | undefined): string {
  if (segundos === null || segundos === undefined || Number.isNaN(segundos)) {
    return SIN_DATO;
  }
  if (segundos < 90) return `hace ${entero(segundos)} s`;
  if (segundos < 5400) return `hace ${entero(Math.round(segundos / 60))} min`;
  if (segundos < 172800) return `hace ${entero(Math.round(segundos / 3600))} h`;
  return `hace ${entero(Math.round(segundos / 86400))} días`;
}
