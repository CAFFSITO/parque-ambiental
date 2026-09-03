"use client";

// app/(panel)/llamados/gestor.tsx
// Lista operativa con filtros en la URL y sondeo cada 10 segundos.
// Sin websockets ni Realtime: router.refresh() vuelve a correr el componente
// de servidor con los mismos filtros y no se rompe en serverless.
//
// Cada llamado es una fila compacta: primero el botón Atender, después lo
// mínimo para decidir. El resto de la ficha aparece al desplegarla.

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
import { Desplegable } from "../componentes/desplegable";
import { Icono } from "../componentes/iconos";
import { CampoFecha } from "../componentes/fecha";
import { Chip, Dato, FilaDesplegable, Lista } from "../componentes/lista";
import { ModalFicha } from "../componentes/modal";
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
        <h1 className="titulo-modulo">
          <Icono nombre="llamados" tamano={18} />
          Llamados
        </h1>
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
              <Desplegable
                id="f-area"
                valor={filtros.area}
                opciones={[
                  { valor: "", etiqueta: "Todas" },
                  ...areas.map((area) => ({
                    valor: String(area.id),
                    etiqueta: `${area.codigo} — ${area.nombre}`,
                  })),
                ]}
                alCambiar={(valor) => cambiarFiltro("area", valor)}
              />
            </Campo>
          </div>
        ) : null}

        <div className="w-[140px]">
          <Campo etiqueta="Tipo" htmlFor="f-tipo">
            <Desplegable
              id="f-tipo"
              valor={filtros.tipo}
              opciones={[
                { valor: "", etiqueta: "Todos" },
                ...TIPOS_LLAMADO.map((tipo) => ({ valor: tipo, etiqueta: tipo })),
              ]}
              alCambiar={(valor) => cambiarFiltro("tipo", valor)}
            />
          </Campo>
        </div>

        <div className="w-[140px]">
          <Campo etiqueta="Origen" htmlFor="f-origen">
            <Desplegable
              id="f-origen"
              valor={filtros.origen}
              opciones={[
                { valor: "", etiqueta: "Todos" },
                ...ORIGENES_LLAMADO.map((origen) => ({
                  valor: origen,
                  etiqueta: origen,
                })),
              ]}
              alCambiar={(valor) => cambiarFiltro("origen", valor)}
            />
          </Campo>
        </div>

        <div className="w-[160px]">
          <Campo etiqueta="Estado" htmlFor="f-estado">
            <Desplegable
              id="f-estado"
              valor={filtros.estado}
              opciones={[
                { valor: "", etiqueta: "Todos" },
                ...ESTADOS_LLAMADO.map((estado) => ({
                  valor: estado,
                  etiqueta: estado,
                })),
              ]}
              alCambiar={(valor) => cambiarFiltro("estado", valor)}
            />
          </Campo>
        </div>

        <div className="w-[150px]">
          <Campo etiqueta="Desde" htmlFor="f-desde">
            <CampoFecha
              id="f-desde"
              valor={filtros.desde}
              alCambiar={(valor) => cambiarFiltro("desde", valor)}
            />
          </Campo>
        </div>

        <div className="w-[150px]">
          <Campo etiqueta="Hasta" htmlFor="f-hasta">
            <CampoFecha
              id="f-hasta"
              valor={filtros.hasta}
              alCambiar={(valor) => cambiarFiltro("hasta", valor)}
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

      <Lista
        hayFilas={llamados.length > 0}
        vacio="Ningún llamado coincide con el filtro."
      >
        {llamados.map((llamado) => {
          const area = areas.find((item) => item.id === llamado.area_id);
          const atendido = llamado.estado === "ATENDIDO";
          const nivel = nivelDeFila(llamado);

          return (
            <FilaDesplegable
              key={llamado.id}
              clave={String(llamado.id)}
              nivel={nivel}
              tenue={atendido}
              accion={
                atendido ? (
                  <Chip texto="Atendido" />
                ) : (
                  <button
                    type="button"
                    className="boton boton-chico"
                    disabled={pendiente}
                    onClick={() => atender(llamado.id)}
                  >
                    {pendiente ? "…" : "Atender"}
                  </button>
                )
              }
              titulo={llamado.motivo ?? SIN_DATO}
              marcas={
                llamado.tipo === "EMERGENCIA" ? (
                  <Chip
                    texto="Emergencia"
                    nivel={atendido ? "NINGUNO" : "EMERGENCIA"}
                  />
                ) : null
              }
              resumen={`${area?.codigo ?? SIN_DATO} · ${fechaHora(llamado.creado_en)}`}
              detalle={
                <>
                  <Dato rotulo="Área">
                    {area ? `${area.codigo} — ${area.nombre}` : SIN_DATO}
                  </Dato>
                  <Dato rotulo="Fecha y hora">
                    {fechaHora(llamado.creado_en)}
                  </Dato>
                  <Dato rotulo="Tipo">{llamado.tipo}</Dato>
                  <Dato rotulo="Origen">{llamado.origen}</Dato>
                  <Dato rotulo="Estado">{llamado.estado}</Dato>
                  <Dato rotulo="Creado por">
                    {llamado.creado_por ?? SIN_DATO}
                  </Dato>
                  <Dato rotulo="Atendido por">
                    {llamado.atendido_por ?? SIN_DATO}
                  </Dato>
                  <Dato rotulo="Atendido en">
                    {fechaHora(llamado.atendido_en)}
                  </Dato>
                  <Dato rotulo="Detalle" ancho>
                    {llamado.detalle ?? SIN_DATO}
                  </Dato>
                </>
              }
              pie={
                atendido ? null : (
                  <button
                    type="button"
                    className="boton"
                    disabled={pendiente}
                    onClick={() => atender(llamado.id)}
                  >
                    {pendiente ? "Marcando…" : "Marcar como atendido"}
                  </button>
                )
              }
            />
          );
        })}
      </Lista>

      {truncado ? (
        <p className="rotulo">
          Se muestran los llamados más recientes. Acotá el rango de fechas para
          ver los anteriores.
        </p>
      ) : null}

      {ficha ? (
        <ModalFicha
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
                <Desplegable
                  id="n-area"
                  valor={ficha.area_id === null ? "" : String(ficha.area_id)}
                  opciones={[
                    { valor: "", etiqueta: "Elegí un área" },
                    ...areas.map((area) => ({
                      valor: String(area.id),
                      etiqueta: `${area.codigo} — ${area.nombre}`,
                    })),
                  ]}
                  alCambiar={(valor) =>
                    setFicha((actual) =>
                      actual
                        ? {
                            ...actual,
                            area_id: valor === "" ? null : Number(valor),
                          }
                        : actual,
                    )
                  }
                />
              )}
            </Campo>

            {sesion.rol === "EMPLEADO" ? (
              <p className="text-tenue">
                El área queda fija en la tuya: el servidor ignora cualquier otra.
              </p>
            ) : null}

            <Campo etiqueta="Tipo" htmlFor="n-tipo">
              <Desplegable
                id="n-tipo"
                valor={ficha.tipo}
                opciones={TIPOS_LLAMADO.map((tipo) => ({
                  valor: tipo,
                  etiqueta: tipo,
                }))}
                alCambiar={(valor) =>
                  setFicha((actual) =>
                    actual ? { ...actual, tipo: valor } : actual,
                  )
                }
              />
            </Campo>

            <Campo etiqueta="Motivo" htmlFor="n-motivo">
              <Desplegable
                id="n-motivo"
                valor={ficha.motivo}
                opciones={MOTIVOS_MANUALES.map((motivo) => ({
                  valor: motivo,
                  etiqueta: motivo,
                }))}
                alCambiar={(valor) =>
                  setFicha((actual) =>
                    actual ? { ...actual, motivo: valor } : actual,
                  )
                }
              />
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
        </ModalFicha>
      ) : null}
    </div>
  );
}
