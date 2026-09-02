// lib/alertas.ts
// El cerebro del sistema. Vive en el servidor: el firmware del nodo solo
// reporta números, acá se decide si eso amerita un llamado y de qué tipo.
// Cambiar un umbral en la pantalla de Áreas cambia el comportamiento del nodo
// en la lectura siguiente, porque los umbrales se leen de la base cada vez.

import { db } from "./db";
import { MOTIVOS } from "./catalogos";
import { fechaHora, numero } from "./formato";
import { avisarEnSegundoPlano } from "./telegram";
import type { Area, OrigenLlamado, TipoLlamado } from "./tipos";

/** Hasta acá el desvío es NORMAL; pasado esto, EMERGENCIA. */
export const MARGEN_TEMP_NORMAL = 3; // °C
export const MARGEN_HUM_NORMAL = 10; // puntos de humedad

/** Un nodo que no reporta en este tiempo se considera caído. */
export const SEGUNDOS_SIN_SENAL = 90;

export type Desvio = {
  motivo: string;
  tipo: TipoLlamado;
  magnitud: number;
  unidad: "°C" | "%";
  medido: number;
  limite: number;
};

type UmbralesArea = Pick<
  Area,
  "id" | "codigo" | "nombre" | "temp_min" | "temp_max" | "hum_min" | "hum_max"
>;

/**
 * Calcula cuánto se salió cada magnitud de su rango permitido.
 * Devuelve un desvío por magnitud fuera de rango: temperatura y humedad
 * pueden estar mal al mismo tiempo y son dos problemas distintos.
 * Rango respetado -> arreglo vacío -> ningún llamado.
 */
export function evaluarDesvios(
  area: UmbralesArea,
  temperatura: number | null,
  humedad: number | null,
): Desvio[] {
  const desvios: Desvio[] = [];

  const tempMin = Number(area.temp_min);
  const tempMax = Number(area.temp_max);
  const humMin = Number(area.hum_min);
  const humMax = Number(area.hum_max);

  if (temperatura !== null && Number.isFinite(temperatura)) {
    if (temperatura > tempMax) {
      const magnitud = temperatura - tempMax;
      desvios.push({
        motivo: MOTIVOS.TEMP_ALTA,
        tipo: magnitud > MARGEN_TEMP_NORMAL ? "EMERGENCIA" : "NORMAL",
        magnitud,
        unidad: "°C",
        medido: temperatura,
        limite: tempMax,
      });
    } else if (temperatura < tempMin) {
      const magnitud = tempMin - temperatura;
      desvios.push({
        motivo: MOTIVOS.TEMP_BAJA,
        tipo: magnitud > MARGEN_TEMP_NORMAL ? "EMERGENCIA" : "NORMAL",
        magnitud,
        unidad: "°C",
        medido: temperatura,
        limite: tempMin,
      });
    }
  }

  if (humedad !== null && Number.isFinite(humedad)) {
    if (humedad > humMax) {
      const magnitud = humedad - humMax;
      desvios.push({
        motivo: MOTIVOS.HUM_ALTA,
        tipo: magnitud > MARGEN_HUM_NORMAL ? "EMERGENCIA" : "NORMAL",
        magnitud,
        unidad: "%",
        medido: humedad,
        limite: humMax,
      });
    } else if (humedad < humMin) {
      const magnitud = humMin - humedad;
      desvios.push({
        motivo: MOTIVOS.HUM_BAJA,
        tipo: magnitud > MARGEN_HUM_NORMAL ? "EMERGENCIA" : "NORMAL",
        magnitud,
        unidad: "%",
        medido: humedad,
        limite: humMin,
      });
    }
  }

  return desvios;
}

/** Texto de detalle de un desvío, con la lectura que lo provocó. */
export function detalleDeDesvio(
  desvio: Desvio,
  dispositivo: string,
  momento: Date,
): string {
  return (
    `${numero(desvio.medido)} ${desvio.unidad} contra un límite de ` +
    `${numero(desvio.limite)} ${desvio.unidad} ` +
    `(desvío ${numero(desvio.magnitud)} ${desvio.unidad}). ` +
    `Reportado por ${dispositivo} el ${fechaHora(momento)}.`
  );
}

export type ResultadoRegistro = "creado" | "actualizado" | "error";

/**
 * ANTIRREBOTE. Si ya hay un llamado NO_ATENDIDO de la misma área y el mismo
 * motivo, no crea otro: le refresca el detalle con la lectura más nueva.
 * Sin esto, un nodo reportando cada pocos segundos genera decenas de llamados
 * repetidos y vuelve ilegibles las pantallas y los gráficos.
 *
 * Además escala el tipo: si el llamado abierto era NORMAL y la condición
 * empeoró a EMERGENCIA, sube de tipo en lugar de quedar subestimado.
 */
export async function registrarLlamado(entrada: {
  areaId: number;
  areaNombre: string;
  tipo: TipoLlamado;
  origen: OrigenLlamado;
  motivo: string;
  detalle: string;
  creadoPor: string;
}): Promise<ResultadoRegistro> {
  const { data: abiertos, error: errorBusqueda } = await db()
    .from("llamados")
    .select("id, tipo")
    .eq("area_id", entrada.areaId)
    .eq("motivo", entrada.motivo)
    .eq("estado", "NO_ATENDIDO")
    .order("creado_en", { ascending: false })
    .limit(1)
    .overrideTypes<{ id: number; tipo: TipoLlamado }[], { merge: false }>();

  if (errorBusqueda) return "error";

  const abierto = abiertos?.[0];

  if (abierto) {
    const escalaAEmergencia =
      entrada.tipo === "EMERGENCIA" && abierto.tipo === "NORMAL";

    const { error } = await db()
      .from("llamados")
      .update(
        escalaAEmergencia
          ? { detalle: entrada.detalle, tipo: "EMERGENCIA" }
          : { detalle: entrada.detalle },
      )
      .eq("id", abierto.id);

    return error ? "error" : "actualizado";
  }

  const { error } = await db().from("llamados").insert({
    area_id: entrada.areaId,
    tipo: entrada.tipo,
    origen: entrada.origen,
    estado: "NO_ATENDIDO",
    motivo: entrada.motivo,
    detalle: entrada.detalle,
    creado_por: entrada.creadoPor,
  });

  if (error) return "error";

  // Solo acá se avisa: en la rama del antirrebote, no. Y se agenda para
  // después de la respuesta, así el nodo no espera a Telegram.
  avisarEnSegundoPlano({
    tipo: entrada.tipo,
    area: entrada.areaNombre,
    motivo: entrada.motivo,
    detalle: entrada.detalle,
    creadoEn: new Date(),
  });

  return "creado";
}

/** ¿Queda alguna emergencia sin atender en el área? Alimenta la sirena. */
export async function hayEmergenciaAbierta(areaId: number): Promise<boolean> {
  const { count } = await db()
    .from("llamados")
    .select("id", { count: "exact", head: true })
    .eq("area_id", areaId)
    .eq("tipo", "EMERGENCIA")
    .eq("estado", "NO_ATENDIDO");

  return (count ?? 0) > 0;
}

export type NodoVigilado = {
  dispositivo: string;
  area_id: number | null;
  ultima: string;
  segundos: number;
};

/**
 * Último reporte de cada dispositivo visto en las últimas 24 horas.
 * PostgREST no agrupa, así que se agrupa acá sobre una ventana acotada.
 */
export async function estadoDeNodos(): Promise<NodoVigilado[]> {
  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data } = await db()
    .from("lecturas")
    .select("dispositivo, area_id, tomada_en")
    .gte("tomada_en", desde)
    .order("tomada_en", { ascending: false })
    .overrideTypes<
      { dispositivo: string | null; area_id: number | null; tomada_en: string }[],
      { merge: false }
    >();

  const ahora = Date.now();
  const ultimos = new Map<string, NodoVigilado>();

  for (const fila of data ?? []) {
    if (!fila.dispositivo) continue;
    // Vienen ordenadas de más nueva a más vieja: la primera de cada
    // dispositivo es su último reporte.
    if (ultimos.has(fila.dispositivo)) continue;

    ultimos.set(fila.dispositivo, {
      dispositivo: fila.dispositivo,
      area_id: fila.area_id,
      ultima: fila.tomada_en,
      segundos: Math.max(
        0,
        Math.round((ahora - new Date(fila.tomada_en).getTime()) / 1000),
      ),
    });
  }

  return [...ultimos.values()].sort((a, b) =>
    a.dispositivo.localeCompare(b.dispositivo),
  );
}

// Evita repetir la barrida en cada request cuando el tablero se recarga
// seguido. Es por instancia del servidor: en serverless es best-effort, y
// alcanza porque la operación es idempotente gracias al antirrebote.
let ultimaRevision = 0;
const MS_ENTRE_REVISIONES = 20_000;

export type ResumenVigilancia = {
  revisados: number;
  caidos: number;
  creados: number;
  actualizados: number;
  omitida: boolean;
};

/**
 * Marca como EMERGENCIA los nodos que dejaron de reportar. Se llama desde
 * /api/vigilancia y también directo desde el tablero, así no depende de un
 * cron externo.
 */
export async function revisarNodosCaidos(
  forzar = false,
): Promise<ResumenVigilancia> {
  const ahora = Date.now();
  if (!forzar && ahora - ultimaRevision < MS_ENTRE_REVISIONES) {
    return {
      revisados: 0,
      caidos: 0,
      creados: 0,
      actualizados: 0,
      omitida: true,
    };
  }
  ultimaRevision = ahora;

  const nodos = await estadoDeNodos();
  const caidos = nodos.filter(
    (nodo) => nodo.segundos > SEGUNDOS_SIN_SENAL && nodo.area_id !== null,
  );

  // Nombre de cada área, para que el aviso de Telegram diga algo legible.
  const { data: areas } = await db()
    .from("areas")
    .select("id, nombre")
    .overrideTypes<{ id: number; nombre: string }[], { merge: false }>();

  const nombrePorArea = new Map<number, string>();
  for (const area of areas ?? []) nombrePorArea.set(area.id, area.nombre);

  let creados = 0;
  let actualizados = 0;

  for (const nodo of caidos) {
    if (nodo.area_id === null) continue;

    const resultado = await registrarLlamado({
      areaId: nodo.area_id,
      areaNombre: nombrePorArea.get(nodo.area_id) ?? nodo.dispositivo,
      tipo: "EMERGENCIA",
      origen: "SENSOR",
      motivo: MOTIVOS.SIN_SENAL,
      detalle:
        `El nodo ${nodo.dispositivo} no reporta hace ${nodo.segundos} segundos. ` +
        `Última lectura: ${fechaHora(nodo.ultima)}.`,
      creadoPor: nodo.dispositivo,
    });

    if (resultado === "creado") creados += 1;
    if (resultado === "actualizado") actualizados += 1;
  }

  return {
    revisados: nodos.length,
    caidos: caidos.length,
    creados,
    actualizados,
    omitida: false,
  };
}
