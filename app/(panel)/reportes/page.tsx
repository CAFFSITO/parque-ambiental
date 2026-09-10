// app/(panel)/reportes/page.tsx
// Exclusiva del rol ADMINISTRADOR.
// Los tres filtros de arriba mandan sobre todo lo de abajo, incluidos el CSV
// y la vista de impresión, porque viajan en el query string.

import Link from "next/link";
import { exigirAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { entero, numero } from "@/lib/formato";
import {
  cargarLlamados,
  cargarReporte,
  filtroAQueryString,
  leerFiltro,
  porcentajeAtencion,
} from "@/lib/reportes";
import type { Area } from "@/lib/tipos";
import { Aviso } from "../componentes/campos";
import { Icono } from "../componentes/iconos";
import { FiltrosReporte } from "./filtros";
import {
  GraficoDistribucion,
  GraficoEvolucion,
  GraficoPorArea,
} from "./graficos";
import { POR_PAGINA, TablaDetalle } from "./tabla";

export const metadata = {
  title: "Reportes · Parque Ambiental Municipal",
};

function Indicador({
  rotulo,
  valor,
  destacado,
}: {
  rotulo: string;
  valor: string;
  destacado?: "ADVERTENCIA" | "NORMAL";
}) {
  const color =
    destacado === "ADVERTENCIA"
      ? "text-advertencia"
      : destacado === "NORMAL"
        ? "text-normal"
        : "text-texto";

  return (
    <div className="panel px-3 py-2.5">
      <div className="rotulo">{rotulo}</div>
      <div className={`mt-1.5 text-[30px] leading-none font-semibold ${color}`}>
        {valor}
      </div>
    </div>
  );
}

export default async function PaginaReportes(props: PageProps<"/reportes">) {
  await exigirAdmin();

  const parametros = await props.searchParams;
  const filtro = leerFiltro(parametros);

  const paginaCruda = typeof parametros.pagina === "string" ? parametros.pagina : "1";
  const pagina = /^\d+$/.test(paginaCruda) ? Math.max(1, Number(paginaCruda)) : 1;

  const [datos, detalle, areasResultado] = await Promise.all([
    cargarReporte(filtro),
    cargarLlamados(filtro, { pagina, porPagina: POR_PAGINA }),
    db()
      .from("areas")
      .select(
        "id, codigo, nombre, tipo, temp_min, temp_max, hum_min, hum_max, activa, creada_en",
      )
      .order("codigo", { ascending: true })
      .overrideTypes<Area[], { merge: false }>(),
  ]);

  const areas = areasResultado.data ?? [];
  const consulta = filtroAQueryString(filtro);
  const sufijo = consulta === "" ? "" : `?${consulta}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 border-b border-borde pb-2">
        <h1 className="titulo-modulo">
          <Icono nombre="reportes" tamano={18} />
          Reportes
        </h1>
        <div className="flex items-center gap-2">
          <a className="boton-plano" href={`/api/exportar/csv${sufijo}`}>
            Exportar CSV
          </a>
          <Link
            className="boton-plano"
            href={`/reportes/imprimir${sufijo}`}
            target="_blank"
          >
            Vista de impresión
          </Link>
        </div>
      </div>

      <FiltrosReporte filtro={filtro} areas={areas} />

      {datos.faltanFunciones ? (
        <Aviso texto={datos.faltanFunciones} nivel="ADVERTENCIA" />
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador rotulo="Total de llamados" valor={entero(datos.resumen.total)} />
        <Indicador
          rotulo="Atendidos"
          valor={entero(datos.resumen.atendidos)}
          destacado="NORMAL"
        />
        <Indicador
          rotulo="No atendidos"
          valor={entero(datos.resumen.no_atendidos)}
          destacado={datos.resumen.no_atendidos > 0 ? "ADVERTENCIA" : undefined}
        />
        <Indicador
          rotulo="Porcentaje de atención"
          valor={`${numero(porcentajeAtencion(datos.resumen))} %`}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <GraficoPorArea datos={datos.porArea} />
        <GraficoDistribucion datos={datos.distribucion} />
      </div>

      <GraficoEvolucion llamados={datos.porDia} clima={datos.clima} />

      {/* La decisión está tomada y documentada en
          documents/contexto/80-simulador.md §5: las lecturas simuladas SÍ
          entran en los reportes. La pantalla lo dice en vez de que haya que
          deducirlo, que es la diferencia entre un dato con una salvedad y un
          dato que engaña. */}
      <p className="text-tenue">
        Los promedios de clima incluyen las lecturas de dispositivos simulados.
        Cada lectura queda atribuida a su dispositivo, así que se pueden separar
        por naturaleza: hoy la mayor parte de la serie histórica proviene de
        nodos simulados, y excluirlos dejaría el gráfico casi vacío. Los
        dispositivos simulados aparecen marcados como tales en el Tablero y en
        Dispositivos.
      </p>

      <TablaDetalle
        llamados={detalle.filas}
        areas={areas}
        filtro={filtro}
        pagina={pagina}
        total={detalle.total}
      />
    </div>
  );
}
