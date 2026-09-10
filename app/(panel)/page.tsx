// app/(panel)/page.tsx
// Tablero operativo. Todos ven todas las áreas; las que la persona tiene a
// cargo aparecen primero en la lista de lecturas.
// El uso de cookies() en getSesion() ya obliga a render dinámico.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getSesion } from "@/lib/auth";
import { areasDelUsuario, areasPropiasPrimero } from "@/lib/areas-propias";
import { revisarNodosCaidos } from "@/lib/alertas";
import { db } from "@/lib/db";
import { entero, fechaHora, numero, SIN_DATO } from "@/lib/formato";
import type { Area, Lectura, NivelEstado } from "@/lib/tipos";
import { Chip, Dato, FilaDesplegable, Lista } from "./componentes/lista";

/** Una lectura vieja no sirve para decidir: se marca como advertencia. */
const MINUTOS_LECTURA_VIGENTE = 30;

type FilaTablero = {
  area: Area;
  lectura: Lectura | null;
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

function evaluar(
  area: Area,
  lectura: Lectura | null,
  conEmergencia: boolean,
): { nivel: NivelEstado; motivo: string } {
  if (conEmergencia) {
    return { nivel: "EMERGENCIA", motivo: "Emergencia sin atender" };
  }
  if (!lectura) {
    return { nivel: "ADVERTENCIA", motivo: "Sin lecturas registradas" };
  }

  const antiguedadMin =
    (Date.now() - new Date(lectura.tomada_en).getTime()) / 60000;
  if (antiguedadMin > MINUTOS_LECTURA_VIGENTE) {
    return { nivel: "ADVERTENCIA", motivo: "Sensor sin reportar" };
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
  const sesion = await getSesion();
  if (!sesion) redirect("/login");

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
  ] = await Promise.all([
    consultaAreas.overrideTypes<Area[], { merge: false }>(),
    areasConEmergenciaAbierta(filtroArea),
    contarLlamados(filtroArea, false),
    contarLlamados(filtroArea, true),
    contarLecturasUltimaHora(filtroArea),
    areasDelUsuario(sesion),
  ]);

  const areas = areasPropiasPrimero(areasResultado.data ?? [], areasPropias);
  const mias = new Set(areasPropias);
  const lecturas = await Promise.all(areas.map((area) => ultimaLectura(area.id)));

  const filas: FilaTablero[] = areas.map((area, indice) => {
    const lectura = lecturas[indice];
    const { nivel, motivo } = evaluar(area, lectura, emergencias.has(area.id));
    return { area, lectura, nivel, motivo };
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
          {filas.map(({ area, lectura, nivel, motivo }) => (
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
                  <Dato rotulo="Dispositivo" destacado>
                    {lectura?.dispositivo ?? SIN_DATO}
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
