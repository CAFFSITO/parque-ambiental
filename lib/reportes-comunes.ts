// lib/reportes-comunes.ts
// Lo que la pantalla de Reportes comparte entre servidor y cliente: los tipos
// de las agregaciones y las dos funciones puras que las manipulan.
//
// POR QUÉ ESTÁ SEPARADO DE lib/reportes.ts
// lib/reportes.ts importa lib/db.ts para consultar Supabase. Los componentes
// "use client" de Reportes —filtros, gráficos y tabla— necesitan `FiltroReporte`,
// `filtroAQueryString()` y `particion()`, y al importarlas de ahí arrastraban a
// lib/db.ts hacia el árbol del navegador.
//
// En la práctica no se filtraba nada: el empaquetador descarta lo que no se usa
// y Next reemplaza por vacío toda variable de entorno que no empiece con
// NEXT_PUBLIC_, así que la service role key nunca llegó a ningún chunk. Pero eso
// es una propiedad del empaquetador, no del código: alcanzaría con que alguien
// le agregue a lib/db.ts un efecto en el cuerpo del módulo para que el cliente
// de Supabase termine viajando al navegador.
//
// Este archivo NO importa nada del servidor, y ahí la garantía deja de depender
// de la suerte.

/** Filtros de la pantalla de Reportes. Viajan en el query string. */
export type FiltroReporte = {
  area: string; // "" = todas
  origen: string; // "" = todos
  desde: string; // datetime-local "aaaa-mm-ddTHH:mm", "" = sin límite
  hasta: string;
};

export const FILTRO_VACIO: FiltroReporte = {
  area: "",
  origen: "",
  desde: "",
  hasta: "",
};

/** Los cuatro números de arriba. Ver reporte_resumen() en sql/03_reportes.sql. */
export type Resumen = {
  total: number;
  atendidos: number;
  no_atendidos: number;
};

/** Barras: llamados por área. Ver reporte_por_area(). */
export type FilaPorArea = {
  codigo: string;
  nombre: string;
  normal: number;
  emergencia: number;
};

/** Torta: las tres particiones. Ver reporte_distribucion(). */
export type FilaDistribucion = {
  dimension: string;
  etiqueta: string;
  cantidad: number;
};

/** Líneas: evolución diaria. Ver reporte_por_dia(). */
export type FilaPorDia = {
  dia: string;
  normal: number;
  emergencia: number;
};

/** Líneas: clima promedio por día. Ver reporte_clima_por_dia(). */
export type FilaClima = {
  dia: string;
  temp_prom: number | null;
  hum_prom: number | null;
};

/**
 * Arma el query string del filtro. Los campos vacíos no se escriben, así la URL
 * queda corta y "sin filtro" se ve como ausencia y no como parámetro vacío.
 */
export function filtroAQueryString(filtro: FiltroReporte): string {
  const parametros = new URLSearchParams();
  for (const [clave, valor] of Object.entries(filtro)) {
    if (valor !== "") parametros.set(clave, valor);
  }
  return parametros.toString();
}

/** Reparte la distribución en las tres particiones de la torta. */
export function particion(
  filas: FilaDistribucion[],
  dimension: string,
): { etiqueta: string; cantidad: number }[] {
  return filas
    .filter((fila) => fila.dimension === dimension)
    .map((fila) => ({ etiqueta: fila.etiqueta, cantidad: Number(fila.cantidad) }))
    .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta));
}

/** Porcentaje de atención, con un decimal. */
export function porcentajeAtencion(resumen: Resumen): number {
  if (resumen.total === 0) return 0;
  return Math.round((resumen.atendidos / resumen.total) * 1000) / 10;
}
