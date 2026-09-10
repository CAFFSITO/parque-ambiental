"use client";

// app/(panel)/reportes/tabla.tsx
// Detalle al pie, paginado de a 50. La página trae solo la página pedida:
// el paginado también es del servidor, no un slice sobre todo el rango.

import { useRouter } from "next/navigation";
import { fechaHora, SIN_DATO } from "@/lib/formato";
import type { Area, Llamado } from "@/lib/tipos";
import {
  filtroAQueryString,
  type FiltroReporte,
} from "@/lib/reportes-comunes";

export const POR_PAGINA = 50;

export function TablaDetalle({
  llamados,
  areas,
  filtro,
  pagina,
  total,
}: {
  llamados: Llamado[];
  areas: Area[];
  filtro: FiltroReporte;
  pagina: number;
  total: number;
}) {
  const router = useRouter();

  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const desde = total === 0 ? 0 : (pagina - 1) * POR_PAGINA + 1;
  const hasta = Math.min(pagina * POR_PAGINA, total);

  function irA(destino: number) {
    const parametros = new URLSearchParams(filtroAQueryString(filtro));
    if (destino > 1) parametros.set("pagina", String(destino));
    const consulta = parametros.toString();
    router.replace(consulta === "" ? "/reportes" : `/reportes?${consulta}`);
  }

  return (
    <section className="panel overflow-x-auto">
      <div className="flex items-center justify-between gap-3 border-b border-borde px-3 py-2">
        <span className="rotulo">Detalle de llamados</span>
        <div className="flex items-center gap-2">
          <span className="rotulo">
            {desde}–{hasta} de {total}
          </span>
          <button
            type="button"
            className="boton-plano"
            disabled={pagina <= 1}
            onClick={() => irA(pagina - 1)}
          >
            Anterior
          </button>
          <span className="rotulo">
            {pagina} / {paginas}
          </span>
          <button
            type="button"
            className="boton-plano"
            disabled={pagina >= paginas}
            onClick={() => irA(pagina + 1)}
          >
            Siguiente
          </button>
        </div>
      </div>

      <table className="tabla">
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
          {llamados.length === 0 ? (
            <tr>
              <td colSpan={8} className="text-tenue">
                Ningún llamado en el rango elegido.
              </td>
            </tr>
          ) : (
            llamados.map((llamado) => {
              const area = areas.find((item) => item.id === llamado.area_id);
              const atendido = llamado.estado === "ATENDIDO";

              return (
                <tr
                  key={llamado.id}
                  data-alerta={
                    atendido
                      ? "NINGUNO"
                      : llamado.tipo === "EMERGENCIA"
                        ? "EMERGENCIA"
                        : "ADVERTENCIA"
                  }
                >
                  <td>{fechaHora(llamado.creado_en)}</td>
                  <td className="text-texto">{area?.codigo ?? SIN_DATO}</td>
                  <td
                    className={
                      llamado.tipo === "EMERGENCIA" && !atendido
                        ? "text-emergencia"
                        : "text-tenue"
                    }
                  >
                    {llamado.tipo}
                  </td>
                  <td className="text-tenue">{llamado.origen}</td>
                  <td>{llamado.motivo ?? SIN_DATO}</td>
                  <td className={atendido ? "text-tenue" : "text-texto"}>
                    {llamado.estado}
                  </td>
                  <td className="text-tenue">
                    {llamado.atendido_por ?? SIN_DATO}
                  </td>
                  <td className="text-tenue">
                    {fechaHora(llamado.atendido_en)}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </section>
  );
}
