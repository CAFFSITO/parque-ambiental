// lib/dispositivos.ts
// Los nodos del parque como entidad del sistema. SOLO servidor: nunca importar
// este módulo desde un componente marcado con "use client" (mismo criterio que
// lib/db.ts, que es de donde sale el cliente de Supabase).
//
// Este módulo NO verifica roles. La puerta está en la página y en la Server
// Action, que llaman exigirAdmin() antes de invocar cualquier cosa de acá. Es
// el patrón del resto del proyecto y se mantiene: poner la verificación en dos
// lugares hace que ninguno de los dos sea claramente el responsable.

import { SEGUNDOS_SIN_SENAL } from "./alertas";
import { COLUMNA_INEXISTENTE, COLUMNA_SIN_CACHE, db } from "./db";
import type {
  AreaConAutomatizacion,
  Dispositivo,
  DispositivoConEstado,
  EstadoConexion,
  Lectura,
  NaturalezaDispositivo,
  ResolucionArea,
} from "./tipos";

/**
 * Columnas de la ficha de dispositivo. Está acá, y no repetida en cada
 * consulta, para que agregar una columna no deje pantallas desincronizadas.
 * Es el mismo criterio que COLUMNAS_EMPLEADO en lib/db.ts.
 */
export const COLUMNAS_DISPOSITIVO =
  "id, codigo, nombre, modelo, area_id, activo, naturaleza, " +
  "reporta_temperatura, reporta_humedad, reporta_boton, " +
  "acciona_rele, acciona_alarma, ultimo_contacto_en, observaciones, creado_en";

/**
 * Columnas del área con su automatización. El bloque de la izquierda es el
 * mismo select que usan el tablero, los llamados y /api/ingest; las cuatro de
 * la derecha las agregó sql/07_automatizacion_areas.sql.
 */
const COLUMNAS_AREA_CON_AUTOMATIZACION =
  "id, codigo, nombre, tipo, temp_min, temp_max, hum_min, hum_max, activa, creada_en, " +
  "auto_temp_alta, auto_temp_baja, auto_hum_alta, auto_hum_baja";

const COLUMNAS_LECTURA =
  "id, dispositivo, area_id, temperatura, humedad, tomada_en";

/** Largo máximo del código, igual que el check de sql/06_dispositivos.sql. */
export const LARGO_MAXIMO_CODIGO = 64;

/** ¿La migración sql/06 todavía no se corrió en esta base? */
function faltaMigracion(codigo: string | undefined): boolean {
  return codigo === COLUMNA_INEXISTENTE || codigo === COLUMNA_SIN_CACHE;
}

/** PostgREST avisa así cuando la función no existe todavía. */
function esFuncionAusente(codigo: string | undefined): boolean {
  return codigo === "PGRST202" || codigo === "42883";
}

// ---------------------------------------------------------------------
// DECISIONES PURAS
//
// Sin base de datos y sin efectos: reciben filas ya leídas y devuelven la
// decisión. Están separadas a propósito, para poder probarlas de verdad en vez
// de simular un cliente de Supabase.
// ---------------------------------------------------------------------

/**
 * Segundos transcurridos desde el último reporte, o null si nunca reportó.
 *
 * Redondea y recorta en cero igual que estadoDeNodos() en lib/alertas.ts, así
 * las dos pantallas que muestran "hace cuánto" no difieren en un segundo por
 * usar aritmética distinta.
 */
export function segundosSinReportar(
  ultimoContacto: string | Date | null | undefined,
  ahora: Date = new Date(),
): number | null {
  if (ultimoContacto === null || ultimoContacto === undefined) return null;

  const momento =
    ultimoContacto instanceof Date ? ultimoContacto : new Date(ultimoContacto);
  if (Number.isNaN(momento.getTime())) return null;

  return Math.max(0, Math.round((ahora.getTime() - momento.getTime()) / 1000));
}

/**
 * Estado de conexión contra SEGUNDOS_SIN_SENAL, que es el mismo umbral que usa
 * la vigilancia de nodos caídos. Se importa de lib/alertas.ts en vez de
 * repetir el número: hoy el tablero usa 30 minutos y la vigilancia 90
 * segundos, y esa contradicción es justamente la que no hay que propagar.
 *
 * El corte es ESTRICTAMENTE MAYOR, igual que revisarNodosCaidos()
 * (`nodo.segundos > SEGUNDOS_SIN_SENAL`): a los 90 segundos exactos el nodo
 * todavía está en línea, a los 91 ya no.
 */
export function estadoDeConexion(
  ultimoContacto: string | Date | null | undefined,
  ahora: Date = new Date(),
): EstadoConexion {
  const segundos = segundosSinReportar(ultimoContacto, ahora);
  if (segundos === null) return "NUNCA_REPORTO";
  return segundos > SEGUNDOS_SIN_SENAL ? "SIN_SENAL" : "EN_LINEA";
}

/** Atajo booleano de estadoDeConexion(). Un nodo que nunca reportó no está en línea. */
export function estaEnLinea(
  ultimoContacto: string | Date | null | undefined,
  ahora: Date = new Date(),
): boolean {
  return estadoDeConexion(ultimoContacto, ahora) === "EN_LINEA";
}

/**
 * ¿Este dispositivo puede operar? Un dispositivo dado de baja no autentica ni
 * recibe órdenes: quedó fuera de servicio y el sistema tiene que tratarlo como
 * tal aunque el aparato siga enchufado y hablando.
 */
export function puedeOperar(
  dispositivo: Pick<Dispositivo, "activo">,
): boolean {
  return dispositivo.activo === true;
}

/**
 * ¿Este dispositivo produce mediciones reales? Lo usan las pantallas para no
 * mezclar simulación con hardware, y la vigilancia para no levantar una
 * emergencia porque un simulador dejó de simular.
 */
export function esFisico(
  dispositivo: Pick<Dispositivo, "naturaleza">,
): boolean {
  return dispositivo.naturaleza === "FISICO";
}

/**
 * Decide el área de un dispositivo a partir de la fila ya leída.
 *
 * Sin área asignada NO es un error: es un estado válido y previsto. Significa
 * que no hay umbrales que evaluar ni automatización que aplicar, y lo dice
 * explícitamente para que quien llame no tenga que interpretar un null.
 */
export function decidirArea(
  dispositivo: Pick<Dispositivo, "area_id">,
  area: AreaConAutomatizacion | null,
): ResolucionArea {
  if (dispositivo.area_id === null) return { estado: "SIN_AREA", area: null };
  if (area === null) return { estado: "AREA_INEXISTENTE", area: null };
  return { estado: "CON_AREA", area };
}

/** Agrega el estado de conexión ya calculado, para las pantallas. */
export function conEstado(
  dispositivo: Dispositivo,
  ahora: Date = new Date(),
): DispositivoConEstado {
  return {
    ...dispositivo,
    conexion: estadoDeConexion(dispositivo.ultimo_contacto_en, ahora),
    segundos_sin_reportar: segundosSinReportar(
      dispositivo.ultimo_contacto_en,
      ahora,
    ),
  };
}

/** Normaliza un código escrito por una persona. No cambia mayúsculas: el
 *  código del firmware distingue, y "nodo-inv-n-01" no es "NODO-INV-N-01". */
export function normalizarCodigo(texto: string): string {
  return texto.trim().slice(0, LARGO_MAXIMO_CODIGO);
}

/** ¿El código respeta el check de sql/06_dispositivos.sql? */
export function codigoValido(codigo: string): boolean {
  return (
    codigo === codigo.trim() &&
    codigo.length >= 1 &&
    codigo.length <= LARGO_MAXIMO_CODIGO
  );
}

// ---------------------------------------------------------------------
// LECTURA
// ---------------------------------------------------------------------

/**
 * La flota entera, ordenada por código. Si la migración sql/06 todavía no se
 * corrió devuelve vacío en vez de romper, así la pantalla puede decirlo. Es la
 * misma tolerancia que leerEmpleados() aplica con sql/04.
 */
export async function leerDispositivos(): Promise<Dispositivo[]> {
  const { data, error } = await db()
    .from("dispositivos")
    .select(COLUMNAS_DISPOSITIVO)
    .order("codigo", { ascending: true })
    .overrideTypes<Dispositivo[], { merge: false }>();

  if (error) {
    if (!faltaMigracion(error.code)) {
      console.error(`[dispositivos] no se pudo leer la flota: ${error.message}`);
    }
    return [];
  }
  return data ?? [];
}

/** La flota con el estado de conexión ya resuelto. */
export async function leerDispositivosConEstado(
  ahora: Date = new Date(),
): Promise<DispositivoConEstado[]> {
  const filas = await leerDispositivos();
  return filas.map((fila) => conEstado(fila, ahora));
}

/** Un dispositivo por su id interno, o null. */
export async function leerDispositivo(
  id: number,
): Promise<Dispositivo | null> {
  if (!Number.isInteger(id)) return null;

  const { data, error } = await db()
    .from("dispositivos")
    .select(COLUMNAS_DISPOSITIVO)
    .eq("id", id)
    .maybeSingle()
    .overrideTypes<Dispositivo, { merge: false }>();

  if (error || !data) return null;
  return data;
}

/**
 * Un dispositivo por su código público. Es la búsqueda que hace falta para el
 * camino de la credencial heredada, donde la clave está salada y no se puede
 * buscar por hash (ver lib/credenciales.ts).
 */
export async function buscarPorCodigo(
  codigo: string,
): Promise<Dispositivo | null> {
  const limpio = normalizarCodigo(codigo);
  if (limpio === "") return null;

  const { data, error } = await db()
    .from("dispositivos")
    .select(COLUMNAS_DISPOSITIVO)
    .eq("codigo", limpio)
    .maybeSingle()
    .overrideTypes<Dispositivo, { merge: false }>();

  if (error || !data) return null;
  return data;
}

/**
 * Área del dispositivo, con sus umbrales y su automatización.
 *
 * Esta es la resolución que reemplaza al `body.area` que hoy manda el nodo: el
 * área sale de la asignación registrada, no de lo que el aparato dice de sí
 * mismo. El firmware ya lo pide así en su propio encabezado.
 */
export async function resolverArea(
  dispositivo: Pick<Dispositivo, "area_id">,
): Promise<ResolucionArea> {
  if (dispositivo.area_id === null) return decidirArea(dispositivo, null);

  const { data, error } = await db()
    .from("areas")
    .select(COLUMNAS_AREA_CON_AUTOMATIZACION)
    .eq("id", dispositivo.area_id)
    .maybeSingle()
    .overrideTypes<AreaConAutomatizacion, { merge: false }>();

  if (error) {
    console.error(`[dispositivos] no se pudo leer el área: ${error.message}`);
    return { estado: "AREA_INEXISTENTE", area: null };
  }

  return decidirArea(dispositivo, data ?? null);
}

/**
 * Última lectura de un dispositivo, por dispositivo_id.
 *
 * Se apoya en idx_lecturas_dispositivo_hora (dispositivo_id, tomada_en desc),
 * que sql/06 creó con el mismo patrón que idx_lecturas_area_hora: una sola
 * fila, resuelta por índice.
 */
export async function ultimaLecturaDe(
  dispositivoId: number,
): Promise<Lectura | null> {
  if (!Number.isInteger(dispositivoId)) return null;

  const { data, error } = await db()
    .from("lecturas")
    .select(COLUMNAS_LECTURA)
    .eq("dispositivo_id", dispositivoId)
    .order("tomada_en", { ascending: false })
    .limit(1)
    .overrideTypes<Lectura[], { merge: false }>();

  if (error || !data || data.length === 0) return null;
  return data[0];
}

/** La última lectura de un dispositivo, tal como la devuelve la agregación. */
export type UltimaLectura = {
  dispositivo_id: number;
  lectura_id: number;
  area_id: number | null;
  temperatura: number | null;
  humedad: number | null;
  tomada_en: string;
};

/**
 * La última lectura de CADA dispositivo, en una sola consulta.
 *
 * Usa la función dispositivos_ultima_lectura() de sql/10. Si esa migración
 * todavía no se corrió, cae a una consulta por dispositivo: con una decena de
 * nodos es aceptable, y así la pantalla funciona igual mientras tanto.
 */
export async function ultimasLecturas(
  ids: number[],
): Promise<Map<number, UltimaLectura>> {
  const mapa = new Map<number, UltimaLectura>();
  if (ids.length === 0) return mapa;

  const { data, error } = await db().rpc("dispositivos_ultima_lectura");

  if (!error && Array.isArray(data)) {
    for (const fila of data as UltimaLectura[]) {
      mapa.set(fila.dispositivo_id, fila);
    }
    return mapa;
  }

  if (error && !esFuncionAusente(error.code)) {
    console.error(
      `[dispositivos] no se pudieron leer las últimas lecturas: ${error.message}`,
    );
  }

  // Camino de respaldo: una consulta por dispositivo.
  const sueltas = await Promise.all(
    ids.map(async (id) => ({ id, lectura: await ultimaLecturaDe(id) })),
  );

  for (const { id, lectura } of sueltas) {
    if (!lectura) continue;
    mapa.set(id, {
      dispositivo_id: id,
      lectura_id: lectura.id,
      area_id: lectura.area_id,
      temperatura: lectura.temperatura,
      humedad: lectura.humedad,
      tomada_en: lectura.tomada_en,
    });
  }

  return mapa;
}

/** Un área en la que el dispositivo efectivamente escribió, y cuándo. */
export type TramoDeArea = {
  area_id: number | null;
  lecturas: number;
  primera: string;
  ultima: string;
};

export type HistorialDeAreas = {
  /** dispositivo_id -> tramos, del más reciente al más viejo. */
  porDispositivo: Map<number, TramoDeArea[]>;
  /** false si falta la migración sql/10: la pantalla lo dice en vez de mentir. */
  disponible: boolean;
};

/**
 * Historial de asignación, deducido de las lecturas.
 *
 * No hay tabla de asignaciones —ver documents/contexto/10-arquitectura.md §2—
 * porque el pasado ya está congelado en lecturas.area_id. Esta función lee ese
 * pasado: por cada par (dispositivo, área) devuelve cuántas lecturas escribió
 * ahí y entre qué fechas.
 *
 * Es el historial REAL: lo que el aparato hizo, no lo que alguien declaró.
 */
export async function historialDeAreas(): Promise<HistorialDeAreas> {
  const porDispositivo = new Map<number, TramoDeArea[]>();

  const { data, error } = await db().rpc("dispositivos_historial_areas");

  if (error) {
    if (!esFuncionAusente(error.code)) {
      console.error(
        `[dispositivos] no se pudo leer el historial de áreas: ${error.message}`,
      );
    }
    return { porDispositivo, disponible: false };
  }

  type Fila = TramoDeArea & { dispositivo_id: number };

  for (const fila of (Array.isArray(data) ? data : []) as Fila[]) {
    const tramos = porDispositivo.get(fila.dispositivo_id) ?? [];
    tramos.push({
      area_id: fila.area_id,
      lecturas: Number(fila.lecturas),
      primera: fila.primera,
      ultima: fila.ultima,
    });
    porDispositivo.set(fila.dispositivo_id, tramos);
  }

  return { porDispositivo, disponible: true };
}

/**
 * Cuántas lecturas tiene un dispositivo. Se consulta con `head` y `count`, así
 * la base cuenta y no manda ni una fila.
 *
 * Devuelve null si no se pudo contar: quien decida en función de esto tiene
 * que tratar "no sé" como "no se puede borrar".
 */
export async function contarLecturasDe(
  dispositivoId: number,
): Promise<number | null> {
  if (!Number.isInteger(dispositivoId)) return null;

  const { count, error } = await db()
    .from("lecturas")
    .select("id", { count: "exact", head: true })
    .eq("dispositivo_id", dispositivoId);

  if (error) {
    console.error(`[dispositivos] no se pudieron contar las lecturas: ${error.message}`);
    return null;
  }
  return count ?? 0;
}

// ---------------------------------------------------------------------
// ESCRITURA
//
// Todo lo de acá abajo lo invocan Server Actions que ya llamaron
// exigirAdmin(). Ninguna de estas funciones verifica el rol.
// ---------------------------------------------------------------------

export type EntradaDispositivo = {
  codigo: string;
  nombre: string;
  modelo: string | null;
  area_id: number | null;
  naturaleza: NaturalezaDispositivo;
  reporta_temperatura: boolean;
  reporta_humedad: boolean;
  reporta_boton: boolean;
  acciona_rele: boolean;
  acciona_alarma: boolean;
  observaciones: string | null;
};

/**
 * Alta. 'codigo' y 'naturaleza' se fijan acá y no se vuelven a tocar:
 * actualizarDispositivo() no los acepta.
 *
 * Devuelve el mensaje de error, o el dispositivo creado.
 */
export async function crearDispositivo(
  entrada: EntradaDispositivo,
): Promise<{ ok: true; dispositivo: Dispositivo } | { ok: false; error: string }> {
  const codigo = normalizarCodigo(entrada.codigo);
  if (!codigoValido(codigo)) {
    return {
      ok: false,
      error: `El código tiene que tener entre 1 y ${LARGO_MAXIMO_CODIGO} caracteres, sin espacios al principio ni al final.`,
    };
  }

  const nombre = entrada.nombre.trim();
  if (nombre === "") return { ok: false, error: "Falta el nombre." };

  const { data, error } = await db()
    .from("dispositivos")
    .insert({
      codigo,
      nombre,
      modelo: entrada.modelo?.trim() || null,
      area_id: entrada.area_id,
      naturaleza: entrada.naturaleza,
      reporta_temperatura: entrada.reporta_temperatura,
      reporta_humedad: entrada.reporta_humedad,
      reporta_boton: entrada.reporta_boton,
      acciona_rele: entrada.acciona_rele,
      acciona_alarma: entrada.acciona_alarma,
      observaciones: entrada.observaciones?.trim() || null,
    })
    .select(COLUMNAS_DISPOSITIVO)
    .maybeSingle()
    .overrideTypes<Dispositivo, { merge: false }>();

  if (error) {
    // 23505 es violación de unicidad: ya hay un dispositivo con ese código.
    if (error.code === "23505") {
      return { ok: false, error: `Ya existe un dispositivo con el código ${codigo}.` };
    }
    return { ok: false, error: `No se pudo crear: ${error.message}` };
  }
  if (!data) return { ok: false, error: "No se pudo crear el dispositivo." };

  return { ok: true, dispositivo: data };
}

export type CambiosDispositivo = {
  nombre: string;
  modelo: string | null;
  reporta_temperatura: boolean;
  reporta_humedad: boolean;
  reporta_boton: boolean;
  acciona_rele: boolean;
  acciona_alarma: boolean;
  observaciones: string | null;
};

/**
 * Edición. NO acepta 'codigo' ni 'naturaleza', y eso es deliberado:
 *
 *   - 'codigo' está grabado en el firmware del nodo y es lo que ata cada fila
 *     de lecturas.dispositivo con su dispositivo. Cambiarlo dejaría al aparato
 *     sin identidad hasta que alguien lo reflashee, y rompería ese vínculo.
 *   - 'naturaleza' no se cambia nunca. Pasar un dispositivo de SIMULADO a
 *     FISICO convertiría lecturas inventadas en mediciones, que es justamente
 *     el problema que la columna vino a resolver.
 *
 * La garantía es de aplicación: esta función no arma el campo, así que no hay
 * forma de mandarlo. Un trigger en la base sería un control más fuerte y queda
 * anotado como refuerzo posible.
 */
export async function actualizarDispositivo(
  id: number,
  cambios: CambiosDispositivo,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(id)) return { ok: false, error: "Identificador inválido." };

  const nombre = cambios.nombre.trim();
  if (nombre === "") return { ok: false, error: "Falta el nombre." };

  const { error } = await db()
    .from("dispositivos")
    .update({
      nombre,
      modelo: cambios.modelo?.trim() || null,
      reporta_temperatura: cambios.reporta_temperatura,
      reporta_humedad: cambios.reporta_humedad,
      reporta_boton: cambios.reporta_boton,
      acciona_rele: cambios.acciona_rele,
      acciona_alarma: cambios.acciona_alarma,
      observaciones: cambios.observaciones?.trim() || null,
    })
    .eq("id", id);

  if (error) return { ok: false, error: `No se pudo guardar: ${error.message}` };
  return { ok: true };
}

/**
 * Asigna o desasigna el área. null es válido y significa "sin área": el
 * dispositivo sigue existiendo y sigue autenticando, pero no tiene umbrales
 * ni automatización.
 *
 * NO toca ninguna lectura ni ningún llamado histórico: esas filas conservan el
 * area_id que tenían en el momento en que se grabaron, que es lo que hace que
 * los reportes no se muevan cuando un nodo cambia de área.
 */
export async function asignarArea(
  id: number,
  areaId: number | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(id)) return { ok: false, error: "Identificador inválido." };
  if (areaId !== null && !Number.isInteger(areaId)) {
    return { ok: false, error: "Área inválida." };
  }

  const { error } = await db()
    .from("dispositivos")
    .update({ area_id: areaId })
    .eq("id", id);

  if (error) return { ok: false, error: `No se pudo asignar: ${error.message}` };
  return { ok: true };
}

/**
 * Alta y baja lógica. Dar de baja NO borra: el dispositivo y sus lecturas
 * quedan, y lo que cambia es que deja de poder autenticarse y de recibir
 * órdenes.
 */
export async function cambiarActivo(
  id: number,
  activo: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(id)) return { ok: false, error: "Identificador inválido." };

  const { error } = await db()
    .from("dispositivos")
    .update({ activo: activo === true })
    .eq("id", id);

  if (error) return { ok: false, error: `No se pudo cambiar: ${error.message}` };
  return { ok: true };
}

/**
 * Borrado físico, y es la ÚNICA operación de este módulo que borra algo.
 *
 * Solo procede si el dispositivo no tiene ni una lectura. Un dispositivo con
 * historia no se borra nunca: se da de baja. Borrarlo dejaría a esas lecturas
 * apuntando a un id inexistente —o las arrastraría, que es peor— y perdería la
 * única prueba de qué aparato las escribió.
 *
 * Si no se puede contar las lecturas, no se borra. "No sé" es "no".
 */
export async function eliminarDispositivo(
  id: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(id)) return { ok: false, error: "Identificador inválido." };

  const lecturas = await contarLecturasDe(id);
  if (lecturas === null) {
    return {
      ok: false,
      error: "No se pudo verificar si el dispositivo tiene lecturas. No se borró nada.",
    };
  }
  if (lecturas > 0) {
    return {
      ok: false,
      error: `El dispositivo tiene ${lecturas} lectura${lecturas === 1 ? "" : "s"} registrada${lecturas === 1 ? "" : "s"}. Dalo de baja en vez de borrarlo: la historia no se tira.`,
    };
  }

  const { error } = await db().from("dispositivos").delete().eq("id", id);

  if (error) return { ok: false, error: `No se pudo eliminar: ${error.message}` };
  return { ok: true };
}

/**
 * Deja constancia de que el dispositivo reportó recién.
 *
 * Es telemetría, no parte de ninguna decisión: quien la llame debería hacerlo
 * fuera del camino que le responde al nodo, porque el firmware corta la
 * conexión a los 6 segundos y no hay presupuesto para escrituras que no sean
 * imprescindibles.
 *
 * Nunca lanza: que falle el registro del contacto no puede voltear una lectura
 * que ya se guardó.
 */
export async function registrarContacto(
  id: number,
  momento: Date = new Date(),
): Promise<boolean> {
  if (!Number.isInteger(id)) return false;

  const { error } = await db()
    .from("dispositivos")
    .update({ ultimo_contacto_en: momento.toISOString() })
    .eq("id", id);

  if (error) {
    console.error(
      `[dispositivos] no se pudo registrar el contacto de ${id}: ${error.message}`,
    );
    return false;
  }
  return true;
}
