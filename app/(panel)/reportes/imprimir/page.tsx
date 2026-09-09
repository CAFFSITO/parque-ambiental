// app/(panel)/reportes/imprimir/page.tsx
// Vista de impresión: blanco y negro, encabezado institucional, los filtros
// escritos en texto, los cuatro números, los tres gráficos y la tabla.
// Toma los mismos filtros del query string que la pantalla de Reportes.

import { exigirAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { entero, fechaHora, numero, SIN_DATO } from "@/lib/formato";
import {
  cargarLlamados,
  cargarReporte,
  leerFiltro,
  porcentajeAtencion,
  type FiltroReporte,
} from "@/lib/reportes";
import type { Area } from "@/lib/tipos";
import {
  GraficoDistribucion,
  GraficoEvolucion,
  GraficoPorArea,
} from "../graficos";
import { BotonImprimir } from "./boton-imprimir";
import "./imprimir.css";

export const metadata = {
  title: "Reporte de llamados · Parque Ambiental Municipal",
};

/** Tope de filas del detalle impreso: más que esto no es un reporte, es un log. */
const TOPE_DETALLE = 500;

/** "aaaa-mm-ddTHH:mm" -> "dd/mm/aaaa HH:mm", sin tocar la zona. */
function textoDeMomento(valor: string): string {
  if (valor === "") return "sin límite";
  const [fecha, hora] = valor.split("T");
  const [anio, mes, dia] = fecha.split("-");
  return `${dia}/${mes}/${anio} ${hora.slice(0, 5)}`;
}

function descripcionDeFiltros(
  filtro: FiltroReporte,
  areas: Area[],
): { termino: string; valor: string }[] {
  const area =
    filtro.area === ""
      ? "Todas las áreas"
      : (() => {
          const encontrada = areas.find(
            (item) => String(item.id) === filtro.area,
          );
          return encontrada
            ? `${encontrada.codigo} — ${encontrada.nombre}`
            : `Área ${filtro.area}`;
        })();

  return [
    { termino: "Área", valor: area },
    {
      termino: "Origen",
      valor:
        filtro.origen === ""
          ? "Sensor y Empleado"
          : filtro.origen === "SENSOR"
            ? "Sensor"
            : "Empleado",
    },
    { termino: "Desde", valor: textoDeMomento(filtro.desde) },
    { termino: "Hasta", valor: textoDeMomento(filtro.hasta) },
  ];
}

export default async function PaginaImprimir(
  props: PageProps<"/reportes/imprimir">,
) {
  const sesion = await exigirAdmin();

  const parametros = await props.searchParams;
  const filtro = leerFiltro(parametros);

  const [datos, detalle, areasResultado] = await Promise.all([
    cargarReporte(filtro),
    cargarLlamados(filtro, { tope: TOPE_DETALLE }),
    db()
      .from("areas")
      .select(
        "id, codigo, nombre, tipo, temp_min, temp_max, hum_min, hum_max, activa, creada_en",
      )
      .order("codigo", { ascending: true })
      .overrideTypes<Area[], { merge: false }>(),
  ]);

  const areas = areasResultado.data ?? [];
  const emision = fechaHora(new Date());

  return (
    <div className="hoja">
      <div className="no-imprimir mb-3 flex items-center justify-between gap-3">
        <span className="rotulo">
          Vista de impresión · usá Imprimir y elegí &quot;Guardar como PDF&quot;
        </span>
        <BotonImprimir />
      </div>

      <header className="hoja-encabezado">
        <h1>Parque Ambiental Municipal — Reporte de llamados</h1>
        <p style={{ marginTop: 4 }}>
          Emitido el {emision} por {sesion.usuario}
        </p>
      </header>

      {datos.faltanFunciones ? (
        <p className="hoja-filtros">{datos.faltanFunciones}</p>
      ) : null}

      <section className="hoja-filtros">
        <h2 style={{ marginBottom: 4 }}>Filtros aplicados</h2>
        <dl>
          {descripcionDeFiltros(filtro, areas).map((fila) => (
            <div key={fila.termino}>
              <dt>{fila.termino}:</dt>
              <dd>{fila.valor}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="hoja-numeros">
        <div className="hoja-numero">
          <span>Total de llamados</span>
          <strong>{entero(datos.resumen.total)}</strong>
        </div>
        <div className="hoja-numero">
          <span>Atendidos</span>
          <strong>{entero(datos.resumen.atendidos)}</strong>
        </div>
        <div className="hoja-numero">
          <span>No atendidos</span>
          <strong>{entero(datos.resumen.no_atendidos)}</strong>
        </div>
        <div className="hoja-numero">
          <span>Porcentaje de atención</span>
          <strong>{numero(porcentajeAtencion(datos.resumen))} %</strong>
        </div>
      </section>

      <section className="hoja-grafico">
        <GraficoPorArea datos={datos.porArea} alto={220} />
      </section>

      <section className="hoja-grafico">
        <GraficoDistribucion
          datos={datos.distribucion}
          alto={220}
          dimensionFija="estado"
        />
      </section>

      <section className="hoja-grafico">
        <GraficoEvolucion
          llamados={datos.porDia}
          clima={datos.clima}
          alto={220}
          serieFija="llamados"
        />
      </section>

      <h2 style={{ margin: "14px 0 6px" }}>
        Detalle de llamados ({detalle.filas.length} de {detalle.total})
      </h2>

      <table className="hoja-tabla">
        <thead>
          <tr>
            <th>Fecha y hora</th>
            <th>Área</th>
            <th>Tipo</th>
            <th>Origen</th>
            <th>Motivo</th>
            <th>Estado</th>
            <th>Atendido por</th>
            <th>Atendido en</th>
          </tr>
        </thead>
        <tbody>
          {detalle.filas.length === 0 ? (
            <tr>
              <td colSpan={8}>Ningún llamado en el rango elegido.</td>
            </tr>
          ) : (
            detalle.filas.map((llamado) => {
              const area = areas.find((item) => item.id === llamado.area_id);
              return (
                <tr key={llamado.id}>
                  <td>{fechaHora(llamado.creado_en)}</td>
                  <td>{area?.codigo ?? SIN_DATO}</td>
                  <td>{llamado.tipo}</td>
                  <td>{llamado.origen}</td>
                  <td>{llamado.motivo ?? SIN_DATO}</td>
                  <td>{llamado.estado}</td>
                  <td>{llamado.atendido_por ?? SIN_DATO}</td>
                  <td>
                    {llamado.atendido_en ? fechaHora(llamado.atendido_en) : SIN_DATO}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      <footer className="hoja-pie">
        {detalle.total > TOPE_DETALLE
          ? `Se imprimen los ${TOPE_DETALLE} llamados más recientes del filtro. Para el listado completo, exportá el CSV. `
          : ""}
        Documento generado por el sistema de gestión del Parque Ambiental
        Municipal.
      </footer>
    </div>
  );
}
