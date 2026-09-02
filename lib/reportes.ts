// lib/reportes.ts
// Filtros de reportes y lectura de las agregaciones.
//
// Las sumas las hace Postgres (sql/03_reportes.sql) y llegan ya resueltas:
// una decena de filas en vez de los cientos de llamados del rango.

import { db } from "./db";
import type { Llamado } from "./tipos";

export type LlamadoDetalle = Llamado;

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

const ORIGENES = ["SENSOR", "EMPLEADO"];

/** Acepta "aaaa-mm-ddTHH:mm" y también con segundos. */
function esDatetimeLocal(valor: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(valor);
}

function texto(valor: string | string[] | undefined): string {
  return typeof valor === "string" ? valor : "";
}

/** Normaliza lo que venga por query string. Nada se pasa crudo al motor. */
export function leerFiltro(
  parametros: Record<string, string | string[] | undefined>,
): FiltroReporte {
  const area = texto(parametros.area);
  const origen = texto(parametros.origen);
  const desde = texto(parametros.desde);
  const hasta = texto(parametros.hasta);

  return {
    area: /^\d+$/.test(area) ? area : "",
    origen: ORIGENES.includes(origen) ? origen : "",
    desde: esDatetimeLocal(desde) ? desde : "",
    hasta: esDatetimeLocal(hasta) ? hasta : "",
  };
}

export function filtroAQueryString(filtro: FiltroReporte): string {
  const parametros = new URLSearchParams();
  for (const [clave, valor] of Object.entries(filtro)) {
    if (valor !== "") parametros.set(clave, valor);
  }
  return parametros.toString();
}

/**
 * Los datetime-local no traen zona. Se interpretan como hora de Argentina,
 * que es la que muestra todo el panel.
 */
function aInstante(valor: string, finDeMinuto: boolean): string | null {
  if (valor === "") return null;
  const conSegundos = valor.length === 16 ? `${valor}:${finDeMinuto ? "59" : "00"}` : valor;
  return `${conSegundos}-03:00`;
}

type ParametrosRpc = {
  p_area: number | null;
  p_origen: string | null;
  p_desde: string | null;
  p_hasta: string | null;
};

export function aParametros(filtro: FiltroReporte): ParametrosRpc {
  return {
    p_area: filtro.area === "" ? null : Number(filtro.area),
    p_origen: filtro.origen === "" ? null : filtro.origen,
    p_desde: aInstante(filtro.desde, false),
    p_hasta: aInstante(filtro.hasta, true),
  };
}

export type Resumen = {
  total: number;
  atendidos: number;
  no_atendidos: number;
};

export type FilaPorArea = {
  codigo: string;
  nombre: string;
  normal: number;
  emergencia: number;
};

export type FilaDistribucion = {
  dimension: string;
  etiqueta: string;
  cantidad: number;
};

export type FilaPorDia = {
  dia: string;
  normal: number;
  emergencia: number;
};

export type FilaClima = {
  dia: string;
  temp_prom: number | null;
  hum_prom: number | null;
};

export type DatosReporte = {
  resumen: Resumen;
  porArea: FilaPorArea[];
  distribucion: FilaDistribucion[];
  porDia: FilaPorDia[];
  clima: FilaClima[];
  /** Mensaje si faltan las funciones de sql/03_reportes.sql. */
  faltanFunciones: string | null;
};

const RESUMEN_VACIO: Resumen = { total: 0, atendidos: 0, no_atendidos: 0 };

/** PostgREST avisa así cuando la función no existe todavía. */
function esFuncionAusente(codigo: string | undefined): boolean {
  return codigo === "PGRST202" || codigo === "42883";
}

export async function cargarReporte(
  filtro: FiltroReporte,
): Promise<DatosReporte> {
  const parametros = aParametros(filtro);
  const { p_area, p_desde, p_hasta } = parametros;

  const [resumen, porArea, distribucion, porDia, clima] = await Promise.all([
    db().rpc("reporte_resumen", parametros),
    db().rpc("reporte_por_area", parametros),
    db().rpc("reporte_distribucion", parametros),
    db().rpc("reporte_por_dia", parametros),
    db().rpc("reporte_clima_por_dia", { p_area, p_desde, p_hasta }),
  ]);

  const ausente = [resumen, porArea, distribucion, porDia, clima].find(
    (respuesta) => esFuncionAusente(respuesta.error?.code),
  );

  // Las funciones devuelven "returns table", o sea un arreglo de filas.
  // supabase-js no lo sabe sin tipos generados, así que se afirma acá.
  const filas = <T,>(data: unknown): T[] =>
    Array.isArray(data) ? (data as T[]) : [];

  return {
    resumen: filas<Resumen>(resumen.data)[0] ?? RESUMEN_VACIO,
    porArea: filas<FilaPorArea>(porArea.data),
    distribucion: filas<FilaDistribucion>(distribucion.data),
    porDia: filas<FilaPorDia>(porDia.data),
    clima: filas<FilaClima>(clima.data),
    faltanFunciones: ausente
      ? "Faltan las funciones de agregación. Ejecutá sql/03_reportes.sql en el SQL Editor de Supabase."
      : null,
  };
}

export function porcentajeAtencion(resumen: Resumen): number {
  if (resumen.total === 0) return 0;
  return Math.round((resumen.atendidos / resumen.total) * 1000) / 10;
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

/**
 * Detalle de llamados del filtro. Se usa para la tabla paginada y para el
 * CSV. La paginación la resuelve el motor con range(), no un slice en JS.
 */
export async function cargarLlamados(
  filtro: FiltroReporte,
  opciones: { pagina?: number; porPagina?: number; tope?: number } = {},
): Promise<{ filas: LlamadoDetalle[]; total: number }> {
  const parametros = aParametros(filtro);

  let consulta = db()
    .from("llamados")
    .select(
      "id, area_id, tipo, origen, estado, motivo, detalle, creado_por, creado_en, atendido_por, atendido_en",
      { count: "exact" },
    )
    .order("creado_en", { ascending: false });

  if (parametros.p_area !== null) {
    consulta = consulta.eq("area_id", parametros.p_area);
  }
  if (parametros.p_origen !== null) {
    consulta = consulta.eq("origen", parametros.p_origen);
  }
  if (parametros.p_desde !== null) {
    consulta = consulta.gte("creado_en", parametros.p_desde);
  }
  if (parametros.p_hasta !== null) {
    consulta = consulta.lte("creado_en", parametros.p_hasta);
  }

  if (opciones.pagina !== undefined && opciones.porPagina !== undefined) {
    const inicio = (opciones.pagina - 1) * opciones.porPagina;
    consulta = consulta.range(inicio, inicio + opciones.porPagina - 1);
  } else if (opciones.tope !== undefined) {
    consulta = consulta.limit(opciones.tope);
  }

  const { data, count } = await consulta.overrideTypes<
    LlamadoDetalle[],
    { merge: false }
  >();

  return { filas: data ?? [], total: count ?? 0 };
}
