"use client";

// app/(panel)/llamados/gestor.tsx
// Tabla operativa con filtros en la URL y sondeo cada 10 segundos.
// Sin websockets ni Realtime: router.refresh() vuelve a correr el componente
// de servidor con los mismos filtros y no se rompe en serverless.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ESTADOS_LLAMADO,
  MOTIVOS_MANUALES,
  ORIGENES_LLAMADO,
  TIPOS_LLAMADO,
} from "@/lib/catalogos";
import { fechaHora, SIN_DATO } from "@/lib/formato";
import type { Area, Llamado, Sesion } from "@/lib/tipos";
import { Aviso, Campo } from "../componentes/campos";
import { PanelLateral } from "../componentes/panel-lateral";
import { atenderLlamado, crearLlamado } from "./acciones";

const MS_SONDEO = 10_000;

export type Filtros = {
  area: string;
  tipo: string;
  origen: string;
  estado: string;
  desde: string;
  hasta: string;
};

type FichaNueva = {
  area_id: number | null;
  tipo: string;
  motivo: string;
  detalle: string;
};

/** Rojo emergencia sin atender, ámbar normal sin atender, sin color atendida. */
function nivelDeFila(llamado: Llamado): "EMERGENCIA" | "ADVERTENCIA" | "NINGUNO" {
  if (llamado.estado === "ATENDIDO") return "NINGUNO";
  return llamado.tipo === "EMERGENCIA" ? "EMERGENCIA" : "ADVERTENCIA";
}

export function GestorLlamados({
  llamados,
  areas,
  sesion,
  filtros,
  truncado,
}: {
  llamados: Llamado[];
  areas: Area[];
  sesion: Sesion;
  filtros: Filtros;
  truncado: boolean;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();

  const [ficha, setFicha] = useState<FichaNueva | null>(null);
  const [errorFicha, setErrorFicha] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [sondeoActivo, setSondeoActivo] = useState(true);
  const [ultimoRefresco, setUltimoRefresco] = useState<string>("");

  const fichaAbierta = ficha !== null;

  // Sondeo cada 10 s. Se suspende mientras la ficha de alta está abierta para
  // no pisar lo que la persona está escribiendo.
  useEffect(() => {
    if (!sondeoActivo || fichaAbierta) return;

    const id = setInterval(() => {
      router.refresh();
      setUltimoRefresco(fechaHora(new Date()));
    }, MS_SONDEO);

    return () => clearInterval(id);
  }, [sondeoActivo, fichaAbierta, router]);

  function cambiarFiltro(campo: keyof Filtros, valor: string) {
    const siguientes: Filtros = { ...filtros, [campo]: valor };
    const parametros = new URLSearchParams();

    for (const [clave, dato] of Object.entries(siguientes)) {
      if (dato !== "") parametros.set(clave, dato);
    }

    const consulta = parametros.toString();
    router.replace(consulta === "" ? "/llamados" : `/llamados?${consulta}`);
  }

  function limpiarFiltros() {
    router.replace("/llamados");
  }

  function atender(id: number) {
    iniciar(async () => {
      const resultado = await atenderLlamado(id);
      setAviso(resultado.ok ? (resultado.mensaje ?? "Listo.") : resultado.error);
      if (resultado.ok) router.refresh();
    });
  }

  function abrirNuevo() {
    setErrorFicha(null);
    setFicha({
      area_id: sesion.rol === "EMPLEADO" ? sesion.area_id : null,
      tipo: "NORMAL",
      motivo: MOTIVOS_MANUALES[0],
      detalle: "",
    });
  }

  function guardarNuevo() {
    if (!ficha) return;
    setErrorFicha(null);

    iniciar(async () => {
      const resultado = await crearLlamado(ficha);

      if (!resultado.ok) {
        setErrorFicha(resultado.error);
        return;
      }

      setFicha(null);
      setAviso(resultado.mensaje ?? "Listo.");
      router.refresh();
    });
  }

  const areaPropia =
    sesion.rol === "EMPLEADO" && sesion.area_id !== null
      ? areas.find((area) => area.id === sesion.area_id)
      : undefined;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between border-b border-borde pb-2">
        <h1 className="text-[15px] font-semibold text-texto">Llamados</h1>
        <div className="flex items-center gap-3">
          {sesion.rol === "EMPLEADO" ? (
            <span className="rotulo">
              Área {areaPropia?.codigo ?? SIN_DATO}
            </span>
          ) : null}
          <span className="rotulo">
            {llamados.length}
            {truncado ? "+" : ""} llamados
          </span>
          <button
            type="button"
            className="boton-plano"
            onClick={() => setSondeoActivo((activo) => !activo)}
            title="Sondeo automático cada 10 segundos"
          >
            {sondeoActivo ? "Pausar refresco" : "Reanudar refresco"}
          </button>
          <button type="button" className="boton" onClick={abrirNuevo}>
            Nuevo llamado
          </button>
        </div>
      </div>

      <section className="panel flex flex-wrap items-end gap-3 p-3">
        {sesion.rol === "ADMINISTRADOR" ? (
          <div className="w-[210px]">
            <Campo etiqueta="Área" htmlFor="f-area">
              <select
                id="f-area"
                className="campo"
                value={filtros.area}
                onChange={(e) => cambiarFiltro("area", e.target.value)}
              >
                <option value="">Todas</option>
                {areas.map((area) => (
                  <option key={area.id} value={String(area.id)}>
                    {area.codigo} — {area.nombre}
                  </option>
                ))}
              </select>
            </Campo>
          </div>
        ) : null}

        <div className="w-[140px]">
          <Campo etiqueta="Tipo" htmlFor="f-tipo">
            <select
              id="f-tipo"
              className="campo"
              value={filtros.tipo}
              onChange={(e) => cambiarFiltro("tipo", e.target.value)}
            >
              <option value="">Todos</option>
              {TIPOS_LLAMADO.map((tipo) => (
                <option key={tipo} value={tipo}>
                  {tipo}
                </option>
              ))}
            </select>
          </Campo>
        </div>

        <div className="w-[140px]">
          <Campo etiqueta="Origen" htmlFor="f-origen">
            <select
              id="f-origen"
              className="campo"
              value={filtros.origen}
              onChange={(e) => cambiarFiltro("origen", e.target.value)}
            >
              <option value="">Todos</option>
              {ORIGENES_LLAMADO.map((origen) => (
                <option key={origen} value={origen}>
                  {origen}
                </option>
              ))}
            </select>
          </Campo>
        </div>

        <div className="w-[160px]">
          <Campo etiqueta="Estado" htmlFor="f-estado">
            <select
              id="f-estado"
              className="campo"
              value={filtros.estado}
              onChange={(e) => cambiarFiltro("estado", e.target.value)}
            >
              <option value="">Todos</option>
              {ESTADOS_LLAMADO.map((estado) => (
                <option key={estado} value={estado}>
                  {estado}
                </option>
              ))}
            </select>
          </Campo>
        </div>

        <div className="w-[150px]">
          <Campo etiqueta="Desde" htmlFor="f-desde">
            <input
              id="f-desde"
              type="date"
              className="campo"
              value={filtros.desde}
              onChange={(e) => cambiarFiltro("desde", e.target.value)}
            />
          </Campo>
        </div>

        <div className="w-[150px]">
          <Campo etiqueta="Hasta" htmlFor="f-hasta">
            <input
              id="f-hasta"
              type="date"
              className="campo"
              value={filtros.hasta}
              onChange={(e) => cambiarFiltro("hasta", e.target.value)}
            />
          </Campo>
        </div>

        <button type="button" className="boton-plano" onClick={limpiarFiltros}>
          Limpiar filtros
        </button>

        <span className="rotulo ml-auto">
          {sondeoActivo
            ? `Refresco 10 s${ultimoRefresco ? ` · último ${ultimoRefresco}` : ""}`
            : "Refresco pausado"}
        </span>
      </section>

      {aviso ? (
        <div className="flex items-start justify-between gap-3">
          <Aviso texto={aviso} nivel="NORMAL" />
          <button
            type="button"
            className="boton-plano shrink-0"
            onClick={() => setAviso(null)}
          >
            Descartar
          </button>
        </div>
      ) : null}

      <section className="panel overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr>
              <th>Fecha y hora</th>
              <th>Área</th>
              <th>Tipo</th>
              <th>Origen</th>
              <th>Motivo</th>
              <th>Detalle</th>
              <th>Estado</th>
              <th>Atendido por</th>
              <th>Atendido en</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            {llamados.length === 0 ? (
              <tr>
                <td colSpan={10} className="text-tenue">
                  Ningún llamado coincide con el filtro.
                </td>
              </tr>
            ) : (
              llamados.map((llamado) => {
                const area = areas.find((item) => item.id === llamado.area_id);
                const atendido = llamado.estado === "ATENDIDO";

                return (
                  <tr key={llamado.id} data-alerta={nivelDeFila(llamado)}>
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
                    <td
                      className="max-w-[380px] truncate text-tenue"
                      title={llamado.detalle ?? undefined}
                    >
                      {llamado.detalle ?? SIN_DATO}
                    </td>
                    <td className={atendido ? "text-tenue" : "text-texto"}>
                      {llamado.estado}
                    </td>
                    <td className="text-tenue">
                      {llamado.atendido_por ?? SIN_DATO}
                    </td>
                    <td className="text-tenue">
                      {fechaHora(llamado.atendido_en)}
                    </td>
                    <td>
                      {atendido ? (
                        <span className="text-tenue">—</span>
                      ) : (
                        <button
                          type="button"
                          className="boton-plano"
                          disabled={pendiente}
                          onClick={() => atender(llamado.id)}
                        >
                          Atender
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>

      {truncado ? (
        <p className="rotulo">
          Se muestran los llamados más recientes. Acotá el rango de fechas para
          ver los anteriores.
        </p>
      ) : null}

      {ficha ? (
        <PanelLateral
          titulo="Nuevo llamado"
          subtitulo="Carga manual"
          alCerrar={() => setFicha(null)}
          pie={
            <>
              <button
                type="button"
                className="boton-plano"
                onClick={() => setFicha(null)}
                disabled={pendiente}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="boton"
                onClick={guardarNuevo}
                disabled={pendiente}
              >
                {pendiente ? "Creando…" : "Crear llamado"}
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            {errorFicha ? <Aviso texto={errorFicha} /> : null}

            <Campo etiqueta="Área" htmlFor="n-area">
              {sesion.rol === "EMPLEADO" ? (
                <input
                  id="n-area"
                  className="campo"
                  readOnly
                  value={
                    areaPropia
                      ? `${areaPropia.codigo} — ${areaPropia.nombre}`
                      : SIN_DATO
                  }
                />
              ) : (
                <select
                  id="n-area"
                  className="campo"
                  value={ficha.area_id === null ? "" : String(ficha.area_id)}
                  onChange={(e) =>
                    setFicha((actual) =>
                      actual
                        ? {
                            ...actual,
                            area_id:
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                          }
                        : actual,
                    )
                  }
                >
                  <option value="">Elegí un área</option>
                  {areas.map((area) => (
                    <option key={area.id} value={String(area.id)}>
                      {area.codigo} — {area.nombre}
                    </option>
                  ))}
                </select>
              )}
            </Campo>

            {sesion.rol === "EMPLEADO" ? (
              <p className="text-tenue">
                El área queda fija en la tuya: el servidor ignora cualquier otra.
              </p>
            ) : null}

            <Campo etiqueta="Tipo" htmlFor="n-tipo">
              <select
                id="n-tipo"
                className="campo"
                value={ficha.tipo}
                onChange={(e) =>
                  setFicha((actual) =>
                    actual ? { ...actual, tipo: e.target.value } : actual,
                  )
                }
              >
                {TIPOS_LLAMADO.map((tipo) => (
                  <option key={tipo} value={tipo}>
                    {tipo}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo etiqueta="Motivo" htmlFor="n-motivo">
              <select
                id="n-motivo"
                className="campo"
                value={ficha.motivo}
                onChange={(e) =>
                  setFicha((actual) =>
                    actual ? { ...actual, motivo: e.target.value } : actual,
                  )
                }
              >
                {MOTIVOS_MANUALES.map((motivo) => (
                  <option key={motivo} value={motivo}>
                    {motivo}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo etiqueta="Detalle" htmlFor="n-detalle">
              <textarea
                id="n-detalle"
                className="campo"
                rows={4}
                value={ficha.detalle}
                placeholder="Qué pasó, dónde, qué hace falta."
                onChange={(e) =>
                  setFicha((actual) =>
                    actual ? { ...actual, detalle: e.target.value } : actual,
                  )
                }
              />
            </Campo>

            <p className="text-tenue">
              Se registra con origen EMPLEADO y creado por {sesion.usuario}.
            </p>
          </div>
        </PanelLateral>
      ) : null}
    </div>
  );
}
