// app/(panel)/page.tsx
// Tablero operativo. Todos ven todas las áreas; las que la persona tiene a
// cargo aparecen primero en la lista de lecturas.
// El uso de cookies() en getSesion() ya obliga a render dinámico.

import Link from "next/link";
import { exigirSesion } from "@/lib/auth";
import { areasDelUsuario, areasPropiasPrimero } from "@/lib/areas-propias";
import { revisarNodosCaidos, SEGUNDOS_SIN_SENAL } from "@/lib/alertas";
import { db } from "@/lib/db";
import { leerDispositivosConEstado } from "@/lib/dispositivos";
import { entero, fechaHora, hace, numero, SIN_DATO } from "@/lib/formato";
import type {
  Area,
  DispositivoConEstado,
  Lectura,
  NivelEstado,
} from "@/lib/tipos";
import { Chip } from "./componentes/lista";

/**
 * El estado del sensor de un área se mide con SEGUNDOS_SIN_SENAL, el MISMO
 * umbral que usa la vigilancia de nodos caídos y la pantalla de Dispositivos.
 *
 * Antes esta pantalla tenía su propio criterio —una lectura de más de 30
 * minutos se consideraba vieja— mientras la vigilancia declaraba caído un nodo
 * a los 90 segundos. Eran dos respuestas distintas a la misma pregunta, en el
 * mismo sistema. Ahora hay una sola, y es la de lib/alertas.ts.
 *
 * Es lo aprobado en documents/contexto/10-arquitectura.md, decisión 10: el
 * EMPLEADO no gana una sección nueva —sigue sin ver /dispositivos— pero sí ve,
 * donde ya estaba mirando, si el sensor de su área está vivo.
 */
type EstadoSensor =
  | { estado: "EN_LINEA"; dispositivo: DispositivoConEstado }
  | { estado: "SIN_SENAL"; dispositivo: DispositivoConEstado }
  | { estado: "SIN_DISPOSITIVO"; dispositivo: null };

type FilaTablero = {
  area: Area;
  lectura: Lectura | null;
  sensor: EstadoSensor;
  nivel: NivelEstado;
  motivo: string;
};

function fueraDeRango(
  valor: number | null,
  minimo: number,
  maximo: number,
): boolean {
  if (valor === null) return false;
  return valor < minimo || valor > maximo;
}

/**
 * Estado del sensor del área a partir de los dispositivos asignados.
 *
 * Solo cuentan los que están activos: un nodo dado de baja no mide, y que su
 * silencio marque el área en alerta sería ruido.
 *
 * Con varios nodos en un área, gana el que esté en línea: alcanza con que uno
 * reporte para que el área tenga datos frescos.
 */
function evaluarSensor(asignados: DispositivoConEstado[]): EstadoSensor {
  const activos = asignados.filter((dispositivo) => dispositivo.activo);
  if (activos.length === 0) return { estado: "SIN_DISPOSITIVO", dispositivo: null };

  const enLinea = activos.find(
    (dispositivo) => dispositivo.conexion === "EN_LINEA",
  );
  if (enLinea) return { estado: "EN_LINEA", dispositivo: enLinea };

  // Ninguno reporta: se muestra el que reportó más recientemente, que es el
  // que mejor explica hace cuánto que el área está a ciegas.
  const masReciente = [...activos].sort((a, b) => {
    const sa = a.segundos_sin_reportar;
    const sb = b.segundos_sin_reportar;
    if (sa === null) return 1;
    if (sb === null) return -1;
    return sa - sb;
  })[0];

  return { estado: "SIN_SENAL", dispositivo: masReciente };
}

function evaluar(
  area: Area,
  lectura: Lectura | null,
  sensor: EstadoSensor,
  conEmergencia: boolean,
): { nivel: NivelEstado; motivo: string } {
  if (conEmergencia) {
    return { nivel: "EMERGENCIA", motivo: "Emergencia sin atender" };
  }

  if (sensor.estado === "SIN_DISPOSITIVO") {
    return {
      nivel: "ADVERTENCIA",
      motivo: "Sin dispositivo asignado: el área no recibe lecturas",
    };
  }

  if (sensor.estado === "SIN_SENAL") {
    const segundos = sensor.dispositivo.segundos_sin_reportar;
    return {
      nivel: "ADVERTENCIA",
      motivo:
        segundos === null
          ? "El sensor todavía no envió ninguna lectura"
          : `El sensor dejó de enviar datos ${hace(segundos)}`,
    };
  }

  if (!lectura) {
    return { nivel: "ADVERTENCIA", motivo: "Sin lecturas registradas" };
  }

  const tempMal = fueraDeRango(lectura.temperatura, area.temp_min, area.temp_max);
  const humMal = fueraDeRango(lectura.humedad, area.hum_min, area.hum_max);

  if (tempMal && humMal) {
    return { nivel: "ADVERTENCIA", motivo: "Temperatura y humedad fuera de rango" };
  }
  if (tempMal) return { nivel: "ADVERTENCIA", motivo: "Temperatura fuera de rango" };
  if (humMal) return { nivel: "ADVERTENCIA", motivo: "Humedad fuera de rango" };

  return { nivel: "NORMAL", motivo: "En rango" };
}

async function contarLlamados(
  filtroArea: number | null,
  soloEmergencias: boolean,
): Promise<number> {
  let consulta = db()
    .from("llamados")
    .select("id", { count: "exact", head: true })
    .eq("estado", "NO_ATENDIDO");

  if (soloEmergencias) consulta = consulta.eq("tipo", "EMERGENCIA");
  if (filtroArea !== null) consulta = consulta.eq("area_id", filtroArea);

  const { count } = await consulta;
  return count ?? 0;
}

async function contarLecturasUltimaHora(
  filtroArea: number | null,
): Promise<number> {
  const desde = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  let consulta = db()
    .from("lecturas")
    .select("id", { count: "exact", head: true })
    .gte("tomada_en", desde);

  if (filtroArea !== null) consulta = consulta.eq("area_id", filtroArea);

  const { count } = await consulta;
  return count ?? 0;
}

async function ultimaLectura(areaId: number): Promise<Lectura | null> {
  const { data } = await db()
    .from("lecturas")
    .select("id, dispositivo, area_id, temperatura, humedad, tomada_en")
    .eq("area_id", areaId)
    .order("tomada_en", { ascending: false })
    .limit(1)
    .overrideTypes<Lectura[], { merge: false }>();

  return data?.[0] ?? null;
}

async function areasConEmergenciaAbierta(
  filtroArea: number | null,
): Promise<Set<number>> {
  let consulta = db()
    .from("llamados")
    .select("area_id")
    .eq("estado", "NO_ATENDIDO")
    .eq("tipo", "EMERGENCIA");

  if (filtroArea !== null) consulta = consulta.eq("area_id", filtroArea);

  const { data } = await consulta.overrideTypes<
    { area_id: number | null }[],
    { merge: false }
  >();

  const conjunto = new Set<number>();
  for (const fila of data ?? []) {
    if (fila.area_id !== null) conjunto.add(fila.area_id);
  }
  return conjunto;
}

// =====================================================================
// PRESENTACIÓN
//
// Mismos datos, otra disposición. Las consultas, la vigilancia y el semáforo
// de cada área de arriba no se tocaron.
//
//   * Un MARCADOR de una sola pieza con los cuatro números a 52 px, separados
//     por líneas, en vez de cuatro cajas sueltas.
//   * Una BARRA DE EMERGENCIAS que aparece solo si hay alguna, y nombra las
//     áreas: dice dónde ir, no solo cuántas son.
//   * Una TARJETA POR ÁREA con dos medidores de rango: la banda es lo
//     permitido y la marca es la lectura.
//
// Todo es de servidor: no hay JavaScript nuevo en el navegador.
// =====================================================================

/** Clases por nivel. Escritas enteras para que Tailwind las encuentre. */
const COLOR: Record<NivelEstado, { texto: string; borde: string; suave: string; punto: string }> = {
  NORMAL: {
    texto: "text-normal",
    borde: "border-normal/50",
    suave: "bg-normal/10",
    punto: "bg-normal",
  },
  ADVERTENCIA: {
    texto: "text-advertencia",
    borde: "border-advertencia/60",
    suave: "bg-advertencia/10",
    punto: "bg-advertencia",
  },
  EMERGENCIA: {
    texto: "text-emergencia",
    borde: "border-emergencia/70",
    suave: "bg-emergencia/10",
    punto: "bg-emergencia",
  },
};

/** Lo que dice la etiqueta de estado de cada tarjeta. */
const ESTADO: Record<NivelEstado, string> = {
  NORMAL: "En rango",
  ADVERTENCIA: "Revisar",
  EMERGENCIA: "Emergencia",
};

/**
 * Posición de la banda permitida y de la lectura dentro de un medidor.
 *
 * La escala se abre alrededor del rango —medio rango de margen a cada lado— y
 * se estira si la lectura cae más afuera, así la marca nunca se sale del
 * medidor. Devuelve porcentajes listos para CSS.
 */
function escalaDeMedidor(
  minimo: number,
  maximo: number,
  valor: number | null,
): { banda: [number, number]; marca: number | null } {
  const min = Number(minimo);
  const max = Number(maximo);
  const margen = Math.max((max - min) / 2, 1);

  let desde = min - margen;
  let hasta = max + margen;
  if (valor !== null) {
    desde = Math.min(desde, valor - margen / 4);
    hasta = Math.max(hasta, valor + margen / 4);
  }

  const total = hasta - desde || 1;
  const pct = (x: number) => Math.min(100, Math.max(0, ((x - desde) / total) * 100));

  return {
    banda: [pct(min), pct(max)],
    marca: valor === null ? null : pct(valor),
  };
}

function Medidor({
  rotulo,
  valor,
  minimo,
  maximo,
  unidad,
}: {
  rotulo: string;
  valor: number | null;
  minimo: number;
  maximo: number;
  unidad: string;
}) {
  const { banda, marca } = escalaDeMedidor(minimo, maximo, valor);
  const afuera =
    valor !== null && (valor < Number(minimo) || valor > Number(maximo));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="rotulo">{rotulo}</span>
        {valor === null ? (
          <span className="text-[13px] text-tenue">Sin dato</span>
        ) : (
          <span
            className={`text-[26px] leading-none font-extrabold tracking-[-0.03em] ${
              afuera ? "text-emergencia" : "text-texto"
            }`}
          >
            {numero(valor)}
            <span className="ml-0.5 text-[13px] font-normal text-tenue">{unidad}</span>
          </span>
        )}
      </div>

      <div
        className="relative h-2.5 rounded-full bg-panel-suave"
        role="img"
        aria-label={
          valor === null
            ? `${rotulo}: sin dato. Rango permitido ${numero(minimo, 0)} a ${numero(maximo, 0)} ${unidad}`
            : `${rotulo}: ${numero(valor)} ${unidad}. Rango permitido ${numero(minimo, 0)} a ${numero(maximo, 0)} ${unidad}`
        }
      >
        <div
          className="absolute inset-y-0 rounded-full bg-normal/35"
          style={{ left: `${banda[0]}%`, width: `${banda[1] - banda[0]}%` }}
        />
        {marca !== null ? (
          <div
            className={`absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${
              afuera ? "bg-emergencia" : "bg-texto"
            }`}
            style={{ left: `${marca}%` }}
          />
        ) : null}
      </div>

      <div className="flex justify-between text-[11px] text-tenue">
        <span>mín {numero(minimo, 0)}</span>
        <span>máx {numero(maximo, 0)}</span>
      </div>
    </div>
  );
}

export default async function PaginaTablero() {
  const sesion = await exigirSesion();

  // Vigilancia de nodos caídos al cargar el tablero: el sistema no depende de
  // un cron. revisarNodosCaidos() se autolimita para no repetirse en cada
  // recarga, y es idempotente gracias al antirrebote.
  await revisarNodosCaidos();

  // Los indicadores cuentan el parque entero: el área a cargo ordena, no
  // recorta.
  const filtroArea = null;

  const consultaAreas = db()
    .from("areas")
    .select(
      "id, codigo, nombre, tipo, temp_min, temp_max, hum_min, hum_max, activa, creada_en",
    )
    .eq("activa", true)
    .order("codigo", { ascending: true });

  const [
    areasResultado,
    emergencias,
    noAtendidos,
    emergenciasAbiertas,
    lecturasHora,
    areasPropias,
    dispositivos,
  ] = await Promise.all([
    consultaAreas.overrideTypes<Area[], { merge: false }>(),
    areasConEmergenciaAbierta(filtroArea),
    contarLlamados(filtroArea, false),
    contarLlamados(filtroArea, true),
    contarLecturasUltimaHora(filtroArea),
    areasDelUsuario(sesion),
    // La flota entera en una sola consulta. El estado de conexión ya viene
    // calculado contra SEGUNDOS_SIN_SENAL.
    leerDispositivosConEstado(),
  ]);

  const areas = areasPropiasPrimero(areasResultado.data ?? [], areasPropias);
  const mias = new Set(areasPropias);
  const lecturas = await Promise.all(areas.map((area) => ultimaLectura(area.id)));

  // Código público -> naturaleza. Es lo que permite marcar como simulación la
  // lectura que se muestra, que se identifica por el texto que el nodo declaró.
  const naturalezaPorCodigo = new Map(
    dispositivos.map((dispositivo) => [dispositivo.codigo, dispositivo.naturaleza]),
  );

  const dispositivosPorArea = new Map<number, DispositivoConEstado[]>();
  for (const dispositivo of dispositivos) {
    if (dispositivo.area_id === null) continue;
    const lista = dispositivosPorArea.get(dispositivo.area_id) ?? [];
    lista.push(dispositivo);
    dispositivosPorArea.set(dispositivo.area_id, lista);
  }

  const filas: FilaTablero[] = areas.map((area, indice) => {
    const lectura = lecturas[indice];
    const sensor = evaluarSensor(dispositivosPorArea.get(area.id) ?? []);
    const { nivel, motivo } = evaluar(
      area,
      lectura,
      sensor,
      emergencias.has(area.id),
    );
    return { area, lectura, sensor, nivel, motivo };
  });

  const areasEnAlerta = filas.filter((fila) => fila.nivel !== "NORMAL").length;
  const generado = fechaHora(new Date());

  // Las áreas con emergencia, por código, para decir dónde y no solo cuántas.
  const conEmergencia = filas
    .filter(({ area }) => emergencias.has(area.id))
    .map(({ area }) => area.codigo);

  const marcador = [
    { rotulo: "Llamados sin atender", valor: noAtendidos, nivel: noAtendidos > 0 ? "ADVERTENCIA" : "NORMAL" },
    { rotulo: "Emergencias abiertas", valor: emergenciasAbiertas, nivel: emergenciasAbiertas > 0 ? "EMERGENCIA" : "NORMAL" },
    { rotulo: "Áreas con alerta", valor: areasEnAlerta, nivel: areasEnAlerta > 0 ? "ADVERTENCIA" : "NORMAL" },
    { rotulo: "Lecturas última hora", valor: lecturasHora, nivel: lecturasHora === 0 ? "ADVERTENCIA" : "NORMAL" },
  ] as const;

  return (
    <div className="flex flex-col gap-5">
      {/* ---------------- Encabezado ---------------- */}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <h1 className="text-[26px] leading-none font-semibold">Tablero</h1>
        <span className="rotulo">
          {areasPropias.length > 0
            ? `${filas.length} áreas activas · ${areasPropias.length} a cargo primero · ${generado}`
            : `${filas.length} áreas activas · ${generado}`}
        </span>
      </div>

      {/* ---------------- Marcador: una pieza, cuatro números ---------------- */}
      <section
        aria-label="Indicadores"
        className="panel grid grid-cols-2 lg:grid-cols-4"
      >
        {marcador.map(({ rotulo, valor, nivel }, indice) => (
          <div
            key={rotulo}
            className={`flex flex-col justify-between gap-5 p-5 ${
              indice % 2 === 1 ? "border-l border-texto/10" : ""
            } ${indice >= 2 ? "border-t border-texto/10 lg:border-t-0" : ""} ${
              indice === 2 ? "lg:border-l" : ""
            }`}
          >
            <span className="rotulo">{rotulo}</span>
            <span
              className={`text-[44px] leading-[0.8] font-extrabold tracking-[-0.05em] sm:text-[52px] ${COLOR[nivel].texto}`}
            >
              {entero(valor)}
            </span>
          </div>
        ))}
      </section>

      {/* ---------------- Emergencias: solo si hay ---------------- */}
      {emergenciasAbiertas > 0 ? (
        <section
          className={`flex flex-wrap items-center justify-between gap-3 rounded-pab border px-4 py-3 ${COLOR.EMERGENCIA.borde} ${COLOR.EMERGENCIA.suave}`}
        >
          <p className="text-emergencia">
            <strong>
              {emergenciasAbiertas === 1
                ? "1 emergencia sin atender"
                : `${entero(emergenciasAbiertas)} emergencias sin atender`}
            </strong>
            {conEmergencia.length > 0 ? ` en ${conEmergencia.join(", ")}` : ""}
          </p>
          <Link
            href="/llamados?tipo=EMERGENCIA&estado=NO_ATENDIDO"
            className="boton shrink-0"
          >
            Ver emergencias
          </Link>
        </section>
      ) : null}

      {/* ---------------- Una tarjeta por área ---------------- */}
      {filas.length === 0 ? (
        <section className="panel">
          <p className="lista-vacia">No hay áreas activas para mostrar.</p>
        </section>
      ) : (
        <section
          aria-label="Áreas"
          className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3"
        >
          {filas.map(({ area, lectura, sensor, nivel, motivo }) => {
            const simulada =
              lectura?.dispositivo !== undefined &&
              lectura.dispositivo !== null &&
              naturalezaPorCodigo.get(lectura.dispositivo) === "SIMULADO";

            return (
              <article
                key={area.id}
                id={`area-${area.id}`}
                className={`panel flex flex-col gap-4 border-l-4 p-4 ${COLOR[nivel].borde}`}
              >
                <header className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[20px] leading-none font-semibold">
                        {area.codigo}
                      </span>
                      {mias.has(area.id) ? <Chip texto="A cargo" /> : null}
                      {/* Un área cuyo sensor es simulado se dice a la vista:
                          quien mira el tablero tiene que saber que esos
                          números no salieron de un aparato. */}
                      {sensor.dispositivo?.naturaleza === "SIMULADO" ? (
                        <Chip texto="Simulado" nivel="ADVERTENCIA" />
                      ) : null}
                    </div>
                    <div className="mt-1 truncate text-tenue">{area.nombre}</div>
                  </div>

                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold ${COLOR[nivel].suave} ${COLOR[nivel].texto}`}
                  >
                    {ESTADO[nivel]}
                  </span>
                </header>

                {nivel === "NORMAL" ? null : (
                  <p className={COLOR[nivel].texto}>{motivo}</p>
                )}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Medidor
                    rotulo="Temperatura"
                    valor={lectura?.temperatura ?? null}
                    minimo={area.temp_min}
                    maximo={area.temp_max}
                    unidad="°C"
                  />
                  <Medidor
                    rotulo="Humedad"
                    valor={lectura?.humedad ?? null}
                    minimo={area.hum_min}
                    maximo={area.hum_max}
                    unidad="%"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-texto/10 pt-3 text-[13px]">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        sensor.estado === "EN_LINEA"
                          ? "bg-normal"
                          : sensor.estado === "SIN_SENAL"
                            ? "bg-advertencia"
                            : "bg-tenue"
                      }`}
                      aria-hidden="true"
                    />
                    <span className="truncate text-tenue">
                      {sensor.estado === "SIN_DISPOSITIVO"
                        ? "Sin sensor asignado"
                        : `${sensor.dispositivo.codigo}${
                            sensor.dispositivo.segundos_sin_reportar === null
                              ? ""
                              : ` · último dato ${hace(sensor.dispositivo.segundos_sin_reportar)}`
                          }`}
                    </span>
                  </span>

                  <Link
                    href={`/llamados?area=${area.id}`}
                    className="boton-plano boton-chico shrink-0"
                  >
                    Llamados
                  </Link>
                </div>

                <details className="text-[13px]">
                  <summary className="cursor-pointer text-tenue select-none">
                    Más datos
                  </summary>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                    <dt className="text-tenue">Tipo</dt>
                    <dd>{area.tipo}</dd>
                    <dt className="text-tenue">Última lectura</dt>
                    <dd>{fechaHora(lectura?.tomada_en ?? null)}</dd>
                    <dt className="text-tenue">Sensor sin señal a los</dt>
                    <dd>{SEGUNDOS_SIN_SENAL} s</dd>
                    <dt className="text-tenue">Dispositivo de la lectura</dt>
                    <dd>
                      {lectura?.dispositivo ?? SIN_DATO}
                      {/* La lectura mostrada puede venir de otro nodo del área,
                          no necesariamente del que evaluó el semáforo: la
                          naturaleza se resuelve por el código de la lectura. */}
                      {simulada ? (
                        <>
                          {" "}
                          <Chip texto="Simulado" nivel="ADVERTENCIA" />
                        </>
                      ) : null}
                    </dd>
                  </dl>
                </details>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
