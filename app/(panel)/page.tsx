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
    return {
      nivel: "ADVERTENCIA",
      motivo: `Sensor sin señal ${hace(sensor.dispositivo.segundos_sin_reportar)}`,
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
// Mismos datos que antes, otra disposición. Todo lo de arriba —consultas,
// vigilancia, semáforo de cada área— no se tocó.
//
// En vez de cuatro cajas de números y una lista, el tablero se lee en tres
// capas, de lo general a lo particular:
//
//   1. UNA FRASE que dice cómo está el parque ahora, con el color de lo más
//      grave y un atajo directo a lo que hay que atender.
//   2. LA FRANJA DEL PARQUE: un segmento por área, del color de su estado. Es
//      el parque entero en una línea; cada segmento lleva a su tarjeta.
//   3. UNA TARJETA POR ÁREA, con dos medidores de rango: la banda clara es lo
//      permitido y la marca es la lectura. Se ve de un vistazo si el valor está
//      cómodo, rozando el límite o afuera, sin leer números.
//
// Todo es de servidor: no hay JavaScript nuevo en el navegador. Los datos
// secundarios de cada área van en un <details> nativo.
// =====================================================================

/** Clases por nivel. Escritas enteras para que Tailwind las encuentre. */
const COLOR: Record<NivelEstado, { texto: string; fondo: string; borde: string; suave: string }> = {
  NORMAL: {
    texto: "text-normal",
    fondo: "bg-normal",
    borde: "border-normal/40",
    suave: "bg-normal/10",
  },
  ADVERTENCIA: {
    texto: "text-advertencia",
    fondo: "bg-advertencia",
    borde: "border-advertencia/50",
    suave: "bg-advertencia/10",
  },
  EMERGENCIA: {
    texto: "text-emergencia",
    fondo: "bg-emergencia",
    borde: "border-emergencia/60",
    suave: "bg-emergencia/10",
  },
};

const PALABRA: Record<NivelEstado, string> = {
  NORMAL: "En orden",
  ADVERTENCIA: "Atención",
  EMERGENCIA: "Emergencia",
};

/**
 * Posición de la banda permitida y de la lectura dentro de un medidor.
 *
 * La escala se abre alrededor del rango —medio rango de margen a cada lado— y
 * se estira si la lectura cae más afuera, así la marca nunca se sale del
 * medidor por más extrema que sea. Devuelve porcentajes listos para CSS.
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
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="rotulo">{rotulo}</span>
        <span
          className={`text-[22px] leading-none font-semibold ${
            valor === null ? "text-tenue" : afuera ? "text-emergencia" : "text-texto"
          }`}
        >
          {numero(valor)}
          <span className="ml-0.5 text-[13px] font-normal text-tenue">{unidad}</span>
        </span>
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

/** La frase de arriba: cómo está el parque, dicho en una línea. */
function fraseDelParque(
  emergenciasAbiertas: number,
  areasEnAlerta: number,
  totalAreas: number,
): { nivel: NivelEstado; titulo: string; detalle: string } {
  if (emergenciasAbiertas > 0) {
    return {
      nivel: "EMERGENCIA",
      titulo:
        emergenciasAbiertas === 1
          ? "Hay 1 emergencia sin atender"
          : `Hay ${entero(emergenciasAbiertas)} emergencias sin atender`,
      detalle: `${entero(areasEnAlerta)} de ${entero(totalAreas)} áreas necesitan atención.`,
    };
  }
  if (areasEnAlerta > 0) {
    return {
      nivel: "ADVERTENCIA",
      titulo:
        areasEnAlerta === 1
          ? "1 área necesita atención"
          : `${entero(areasEnAlerta)} áreas necesitan atención`,
      detalle: `El resto de las ${entero(totalAreas)} áreas está en rango.`,
    };
  }
  return {
    nivel: "NORMAL",
    titulo: "Todo el parque en orden",
    detalle: `Las ${entero(totalAreas)} áreas activas están en rango y con sensor en línea.`,
  };
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
  const frase = fraseDelParque(emergenciasAbiertas, areasEnAlerta, filas.length);

  return (
    <div className="flex flex-col gap-6">
      {/* ---------------- 1. La frase del parque ---------------- */}
      <section
        className={`rounded-pab border px-5 py-5 ${COLOR[frase.nivel].borde} ${COLOR[frase.nivel].suave}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className={`mt-2.5 h-3 w-3 shrink-0 rounded-full ${COLOR[frase.nivel].fondo} ${
                frase.nivel === "NORMAL" ? "" : "animate-pulse"
              }`}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <h1
                className={`text-[26px] leading-tight font-semibold sm:text-[30px] ${COLOR[frase.nivel].texto}`}
              >
                {frase.titulo}
              </h1>
              <p className="mt-1 text-tenue">{frase.detalle}</p>
            </div>
          </div>

          {emergenciasAbiertas > 0 ? (
            <Link
              href="/llamados?tipo=EMERGENCIA&estado=NO_ATENDIDO"
              className="boton shrink-0"
            >
              Ver emergencias
            </Link>
          ) : noAtendidos > 0 ? (
            <Link href="/llamados?estado=NO_ATENDIDO" className="boton-plano shrink-0">
              Ver llamados sin atender
            </Link>
          ) : null}
        </div>

        {/* Los cuatro números del parque, en una sola línea que se lee. */}
        <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-3 border-t border-texto/10 pt-4">
          {(
            [
              ["Llamados sin atender", noAtendidos, noAtendidos > 0 ? "ADVERTENCIA" : "NORMAL"],
              ["Emergencias abiertas", emergenciasAbiertas, emergenciasAbiertas > 0 ? "EMERGENCIA" : "NORMAL"],
              ["Áreas con alerta", areasEnAlerta, areasEnAlerta > 0 ? "ADVERTENCIA" : "NORMAL"],
              ["Lecturas en la última hora", lecturasHora, lecturasHora === 0 ? "ADVERTENCIA" : "NORMAL"],
            ] as const
          ).map(([rotulo, valor, nivel]) => (
            <div key={rotulo} className="flex items-baseline gap-2">
              <dd className={`text-[24px] leading-none font-semibold ${COLOR[nivel].texto}`}>
                {entero(valor)}
              </dd>
              <dt className="text-tenue">{rotulo}</dt>
            </div>
          ))}
        </dl>
      </section>

      {/* ---------------- 2. La franja del parque ---------------- */}
      {filas.length > 0 ? (
        <section aria-label="El parque de un vistazo">
          <div className="cabecera-seccion">
            <span className="titulo-seccion">El parque de un vistazo</span>
            <span className="rotulo">
              {areasPropias.length > 0
                ? `${filas.length} áreas · ${areasPropias.length} a cargo, primero · ${generado}`
                : `${filas.length} áreas · ${generado}`}
            </span>
          </div>

          <div className="flex h-12 gap-1 overflow-hidden rounded-pab">
            {filas.map(({ area, nivel, motivo }) => (
              <a
                key={area.id}
                href={`#area-${area.id}`}
                title={`${area.codigo} — ${area.nombre}: ${motivo}`}
                className={`flex min-w-0 flex-1 items-center justify-center px-1 text-[12px] font-semibold text-fondo transition-opacity hover:opacity-80 ${COLOR[nivel].fondo}`}
              >
                <span className="truncate">{area.codigo}</span>
              </a>
            ))}
          </div>

          <div className="mt-2 flex flex-wrap gap-4 text-[12px] text-tenue">
            {(["NORMAL", "ADVERTENCIA", "EMERGENCIA"] as const).map((nivel) => (
              <span key={nivel} className="flex items-center gap-1.5">
                <span className={`h-2.5 w-2.5 rounded-sm ${COLOR[nivel].fondo}`} aria-hidden="true" />
                {PALABRA[nivel]}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {/* ---------------- 3. Una tarjeta por área ---------------- */}
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
                className={`panel flex scroll-mt-20 flex-col gap-4 border-l-4 p-4 ${COLOR[nivel].borde}`}
              >
                <header className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[20px] leading-none font-semibold">
                        {area.codigo}
                      </span>
                      {mias.has(area.id) ? <Chip texto="A cargo" /> : null}
                      {/* Un área cuyo sensor es simulado se dice a la vista,
                          no escondido: quien mira el tablero tiene que saber
                          que esos números no salieron de un aparato. */}
                      {sensor.dispositivo?.naturaleza === "SIMULADO" ? (
                        <Chip texto="Simulado" nivel="ADVERTENCIA" />
                      ) : null}
                    </div>
                    <div className="mt-1 truncate text-tenue">{area.nombre}</div>
                  </div>

                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold ${COLOR[nivel].suave} ${COLOR[nivel].texto}`}
                  >
                    {PALABRA[nivel]}
                  </span>
                </header>

                <p className={nivel === "NORMAL" ? "text-tenue" : COLOR[nivel].texto}>
                  {motivo}
                </p>

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

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-texto/10 pt-3">
                  <span className="flex min-w-0 items-center gap-2 text-[13px]">
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
                    <span className="truncate">
                      {sensor.estado === "SIN_DISPOSITIVO"
                        ? "Sin sensor asignado"
                        : `Sensor ${sensor.estado === "EN_LINEA" ? "en línea" : "sin señal"} · ${hace(sensor.dispositivo.segundos_sin_reportar)}`}
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
                    <dt className="text-tenue">Sensor</dt>
                    <dd>
                      {sensor.estado === "SIN_DISPOSITIVO" ? (
                        "Sin dispositivo asignado"
                      ) : (
                        <>
                          {sensor.dispositivo.codigo}
                          <span className="text-tenue">
                            {" "}
                            · umbral {SEGUNDOS_SIN_SENAL} s
                          </span>
                        </>
                      )}
                    </dd>
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
