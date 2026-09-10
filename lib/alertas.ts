// lib/alertas.ts
// El cerebro del sistema. Vive en el servidor: el firmware del nodo solo
// reporta números, acá se decide si eso amerita un llamado y de qué tipo.
// Cambiar un umbral en la pantalla de Áreas cambia el comportamiento del nodo
// en la lectura siguiente, porque los umbrales se leen de la base cada vez.

import { db } from "./db";
import { MOTIVOS } from "./catalogos";
import { fechaHora, numero } from "./formato";
import { avisarNuevoLlamado } from "./avisos";
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
 * La decisión del antirrebote, sin base de datos.
 *
 * Recibe el tipo del llamado que ya estaba abierto para ese par (área, motivo)
 * y el tipo del que se acaba de detectar, y dice qué hacer:
 *
 *   - `"crear"`      no había ninguno abierto: es un llamado nuevo.
 *   - `"escalar"`    había uno NORMAL y ahora la condición es EMERGENCIA:
 *                    se refresca el detalle Y sube de tipo.
 *   - `"refrescar"`  había uno y no hay que subirlo de tipo: solo se le
 *                    actualiza el detalle con la lectura más nueva.
 *
 * **Nunca devuelve "bajar de tipo".** Una emergencia abierta no se degrada a
 * NORMAL porque la lectura siguiente haya mejorado un poco: se atiende o se
 * cierra, pero no se la disimula sola.
 *
 * Está separada de registrarLlamado() por lo mismo que el resto del proyecto
 * parte las decisiones del acceso a datos (ver 30-modelo-dispositivos.md §1):
 * probar esta regla contra un cliente de Supabase simulado solo verificaría que
 * el simulacro coincide consigo mismo.
 */
export type AccionAntirrebote = "crear" | "escalar" | "refrescar";

export function decidirAntirrebote(
  abierto: { tipo: TipoLlamado } | null | undefined,
  entrante: TipoLlamado,
): AccionAntirrebote {
  if (!abierto) return "crear";
  if (entrante === "EMERGENCIA" && abierto.tipo === "NORMAL") return "escalar";
  return "refrescar";
}

/**
 * ANTIRREBOTE. Si ya hay un llamado NO_ATENDIDO de la misma área y el mismo
 * motivo, no crea otro: le refresca el detalle con la lectura más nueva.
 * Sin esto, un nodo reportando cada pocos segundos genera decenas de llamados
 * repetidos y vuelve ilegibles las pantallas y los gráficos.
 *
 * Además escala el tipo: si el llamado abierto era NORMAL y la condición
 * empeoró a EMERGENCIA, sube de tipo en lugar de quedar subestimado.
 *
 * La regla vive en decidirAntirrebote(); acá queda solo el acceso a datos.
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
  const accion = decidirAntirrebote(abierto, entrada.tipo);

  if (abierto && accion !== "crear") {
    const { error } = await db()
      .from("llamados")
      .update(
        accion === "escalar"
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
  // después de la respuesta, así el nodo no espera ni a Telegram ni al
  // servicio de push.
  avisarNuevoLlamado({
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

// =====================================================================
// VIGILANCIA DE NODOS CAÍDOS
//
// Esta sección se reescribió el 2026-09-10 para apoyarse en la tabla
// `dispositivos` en vez de barrer `lecturas`. El motivo, en orden de peso:
//
//   1. **Naturaleza.** Un simulador que deja de simular no es una emergencia.
//      Antes había que filtrar a mano contra una lista de códigos; ahora la
//      consulta misma solo trae dispositivos FISICO y activos.
//   2. **Punto ciego de 24 horas (R10).** La versión anterior solo miraba
//      lecturas de las últimas 24 h: un nodo caído hace más de un día
//      desaparecía de la vigilancia y su llamado dejaba de refrescarse. El
//      nodo pasaba de "caído, en emergencia" a "inexistente".
//   3. **Costo.** Con un nodo reportando cada 10 s, la barrida anterior
//      transfería hasta 8 640 filas por nodo por día para agruparlas en
//      memoria, porque PostgREST no agrupa. Ahora es una consulta por índice
//      que devuelve una fila por dispositivo físico.
//   4. **Identidad.** Agrupar por el texto `lecturas.dispositivo` era agrupar
//      por lo que el cuerpo declaraba. `dispositivos.codigo` es la identidad
//      registrada, la misma que resuelve la credencial en /api/ingest.
//
// `ultimo_contacto_en` es la columna materializada que /api/ingest actualiza
// en cada ingesta, dentro de `after()` (ver 10-arquitectura.md §1.6). Se
// verificó el 2026-09-10 que coincide con `max(tomada_en)` en las 14 filas de
// la tabla. Si alguna vez quedara desfasada, la sentencia de reparación está
// en 20-migraciones-aplicadas.md §1.2, backfill 3.
// =====================================================================

export type NodoVigilado = {
  /** Código registrado del dispositivo, no el texto que declaró el cuerpo. */
  dispositivo: string;
  /** Área vigente asignada al dispositivo. */
  area_id: number | null;
  /** Último contacto conocido, o null si nunca reportó. */
  ultima: string | null;
  /** Segundos desde el último contacto, o null si nunca reportó. */
  segundos: number | null;
};

/** Fila mínima que necesita la vigilancia. */
type FilaVigilada = {
  codigo: string;
  area_id: number | null;
  ultimo_contacto_en: string | null;
};

/**
 * Los dispositivos que la vigilancia mira, con su antigüedad de contacto.
 *
 * SOLO dispositivos con `naturaleza = 'FISICO'` y `activo = true`:
 *
 *   - Un **simulado** que deja de simular no es una emergencia. Es la regla
 *     aprobada en 10-arquitectura.md §9.4 y documentada en 80-simulador.md.
 *   - Un dispositivo **dado de baja** salió de servicio a propósito; que su
 *     silencio marque el área en alerta sería ruido, y además /api/ingest ya
 *     ni siquiera lo autentica.
 *
 * Un nodo que **nunca reportó** (`ultimo_contacto_en` null) devuelve
 * `segundos: null` y no se considera caído: recién dado de alta todavía no
 * prometió nada. La pantalla de Dispositivos sí lo muestra como
 * "Nunca reportó", que es donde esa distinción sirve.
 *
 * Devuelve vacío si la consulta falla. Quien decida en función de esto tiene
 * que tratar "no sé" como "no": ver revisarNodosCaidos().
 */
export async function estadoDeNodos(
  ahora: Date = new Date(),
): Promise<NodoVigilado[]> {
  const { data, error } = await db()
    .from("dispositivos")
    .select("codigo, area_id, ultimo_contacto_en")
    .eq("naturaleza", "FISICO")
    .eq("activo", true)
    .order("codigo", { ascending: true })
    .overrideTypes<FilaVigilada[], { merge: false }>();

  if (error) {
    console.error(
      `[alertas] no se pudo leer la flota vigilada: ${error.message}`,
    );
    return [];
  }

  const referencia = ahora.getTime();

  return (data ?? []).map((fila) => {
    const contacto =
      fila.ultimo_contacto_en === null
        ? null
        : new Date(fila.ultimo_contacto_en);

    const valido = contacto !== null && !Number.isNaN(contacto.getTime());

    return {
      dispositivo: fila.codigo,
      area_id: fila.area_id,
      ultima: valido ? fila.ultimo_contacto_en : null,
      // Mismo redondeo y mismo recorte en cero que segundosSinReportar() de
      // lib/dispositivos.ts, para que las dos pantallas no difieran en un
      // segundo por usar aritmética distinta.
      segundos: valido
        ? Math.max(0, Math.round((referencia - contacto.getTime()) / 1000))
        : null,
    };
  });
}

/**
 * ¿Este nodo está caído?
 *
 * El corte es **estrictamente mayor**: a los 90 segundos exactos todavía está
 * en línea, a los 91 ya no. Es el mismo criterio que estadoDeConexion() de
 * lib/dispositivos.ts, y hay un test que lo fija en los tres bordes.
 *
 * Sin área asignada no se puede crear el llamado —`llamados.area_id` es a
 * quién avisarle—, así que no cuenta como caído para esta barrida.
 */
export function estaCaido(nodo: NodoVigilado): boolean {
  if (nodo.segundos === null) return false;
  if (nodo.area_id === null) return false;
  return nodo.segundos > SEGUNDOS_SIN_SENAL;
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
 * Marca como EMERGENCIA los nodos físicos que dejaron de reportar. Se llama
 * desde /api/vigilancia y también directo desde el tablero, así no depende de
 * un cron externo.
 *
 * Es idempotente: el antirrebote de registrarLlamado() agrupa por
 * (área, motivo), así que repetir la barrida refresca el llamado abierto en
 * vez de crear otro.
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

  const nodos = await estadoDeNodos(new Date(ahora));
  const caidos = nodos.filter(estaCaido);

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
