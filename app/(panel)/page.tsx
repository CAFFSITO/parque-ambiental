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
import { Chip, Dato, FilaDesplegable, Lista } from "./componentes/lista";

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

function Indicador({
  rotulo,
  valor,
  nivel,
}: {
  rotulo: string;
  valor: number;
  nivel: NivelEstado;
}) {
  return (
    <div className="panel panel-kpi" data-nivel={nivel}>
      <div className="kpi-cabecera">
        <div className="rotulo">{rotulo}</div>
        <span className="kpi-marca" aria-hidden="true" />
      </div>
      <div className="kpi-valor">{entero(valor)}</div>
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

  return (
    <div className="flex flex-col gap-6">
      <div className="encabezado-tablero">
        <div>
          <h1 className="titulo-tablero">Estadisticas del parque</h1>
          <p className="subtitulo-tablero">
            Lecturas, alertas y actividad operativa reunidas en una vista clara.
          </p>
        </div>
        <div className="contexto-tablero">
          {areasPropias.length > 0
            ? `Todas las áreas · ${areasPropias.length} a cargo, primero · ${generado}`
            : `Todas las áreas · ${generado}`}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador
          rotulo="Llamados no atendidos"
          valor={noAtendidos}
          nivel={noAtendidos > 0 ? "ADVERTENCIA" : "NORMAL"}
        />
        <Indicador
          rotulo="Emergencias abiertas"
          valor={emergenciasAbiertas}
          nivel={emergenciasAbiertas > 0 ? "EMERGENCIA" : "NORMAL"}
        />
        <Indicador
          rotulo="Áreas con alerta"
          valor={areasEnAlerta}
          nivel={areasEnAlerta > 0 ? "ADVERTENCIA" : "NORMAL"}
        />
        <Indicador
          rotulo="Lecturas última hora"
          valor={lecturasHora}
          nivel={lecturasHora === 0 ? "ADVERTENCIA" : "NORMAL"}
        />
      </div>

      <div>
        <div className="cabecera-seccion">
          <span className="titulo-seccion">Última lectura por área</span>
          <span className="rotulo">{filas.length} áreas</span>
        </div>

        <Lista
          hayFilas={filas.length > 0}
          vacio="No hay áreas activas para mostrar."
        >
          {filas.map(({ area, lectura, sensor, nivel, motivo }) => (
            <FilaDesplegable
              key={area.id}
              clave={String(area.id)}
              nivel={nivel}
              accion={
                <Link
                  href={`/llamados?area=${area.id}`}
                  className="boton-plano boton-chico"
                >
                  Llamados
                </Link>
              }
              titulo={area.codigo}
              marcas={
                <>
                  {mias.has(area.id) ? <Chip texto="A cargo" /> : null}
                  {/* Un área cuyo sensor es simulado se dice en la fila
                      cerrada, no solo adentro de la ficha: quien mira el
                      tablero tiene que saber, sin abrir nada, que esos
                      números no salieron de un aparato. */}
                  {sensor.dispositivo?.naturaleza === "SIMULADO" ? (
                    <Chip texto="Simulado" nivel="ADVERTENCIA" />
                  ) : null}
                  {nivel === "NORMAL" ? null : (
                    <Chip texto={nivel} nivel={nivel} />
                  )}
                </>
              }
              resumen={`${numero(lectura?.temperatura ?? null)} °C · ${numero(lectura?.humedad ?? null)} %`}
              detalle={
                <>
                  <Dato rotulo="Área">{area.nombre}</Dato>
                  <Dato rotulo="Tipo">{area.tipo}</Dato>
                  <Dato rotulo="Observación">{motivo}</Dato>
                  <Dato rotulo="Temperatura">
                    {numero(lectura?.temperatura ?? null)} °C
                    <span className="text-tenue">
                      {" "}
                      (rango {numero(area.temp_min, 0)} –{" "}
                      {numero(area.temp_max, 0)})
                    </span>
                  </Dato>
                  <Dato rotulo="Humedad">
                    {numero(lectura?.humedad ?? null)} %
                    <span className="text-tenue">
                      {" "}
                      (rango {numero(area.hum_min, 0)} –{" "}
                      {numero(area.hum_max, 0)})
                    </span>
                  </Dato>
                  <Dato rotulo="Fecha">
                    {fechaHora(lectura?.tomada_en ?? null)}
                  </Dato>
                  <Dato rotulo="Sensor" destacado>
                    {sensor.estado === "SIN_DISPOSITIVO" ? (
                      "Sin dispositivo asignado"
                    ) : (
                      <>
                        {sensor.dispositivo.codigo} ·{" "}
                        {sensor.estado === "EN_LINEA" ? "en línea" : "sin señal"}
                        {sensor.dispositivo.naturaleza === "SIMULADO" ? (
                          <>
                            {" "}
                            <Chip texto="Simulado" nivel="ADVERTENCIA" />
                          </>
                        ) : null}
                        <span className="text-tenue">
                          {" "}
                          ({hace(sensor.dispositivo.segundos_sin_reportar)} ·
                          umbral {SEGUNDOS_SIN_SENAL} s)
                        </span>
                      </>
                    )}
                  </Dato>
                  <Dato rotulo="Dispositivo de la lectura">
                    {lectura?.dispositivo ?? SIN_DATO}
                    {/* La lectura mostrada puede venir de otro nodo del área,
                        no necesariamente del que evaluó el semáforo. Por eso
                        la naturaleza se resuelve por el código de la lectura y
                        no se hereda del sensor de arriba. */}
                    {lectura?.dispositivo !== undefined &&
                    lectura.dispositivo !== null &&
                    naturalezaPorCodigo.get(lectura.dispositivo) === "SIMULADO" ? (
                      <>
                        {" "}
                        <Chip texto="Simulado" nivel="ADVERTENCIA" />
                      </>
                    ) : null}
                  </Dato>
                </>
              }
            />
          ))}
        </Lista>
      </div>
    </div>
  );
}
