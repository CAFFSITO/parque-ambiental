"use client";

// app/(panel)/areas/gestor.tsx
// Listado de áreas + ficha en panel lateral. Sin librerías de tablas ni de
// formularios: HTML y estado de React.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TIPOS_AREA } from "@/lib/catalogos";
import { entero, numero } from "@/lib/formato";
import type { Area } from "@/lib/tipos";
import { Aviso, Campo, Etiqueta } from "../componentes/campos";
import { ConfirmarModal } from "../componentes/modal";
import { PanelLateral } from "../componentes/panel-lateral";
import {
  actualizarArea,
  cambiarActivaArea,
  crearArea,
  type EntradaArea,
} from "./acciones";

export type AreaConMetricas = Area & {
  empleados: number;
  llamados_abiertos: number;
};

type Ficha = EntradaArea & { id: number | null };

const FICHA_VACIA: Ficha = {
  id: null,
  codigo: "",
  nombre: "",
  tipo: "invernadero",
  temp_min: 15,
  temp_max: 30,
  hum_min: 40,
  hum_max: 80,
  activa: true,
};

function aFicha(area: Area): Ficha {
  return {
    id: area.id,
    codigo: area.codigo,
    nombre: area.nombre,
    tipo: area.tipo,
    temp_min: Number(area.temp_min),
    temp_max: Number(area.temp_max),
    hum_min: Number(area.hum_min),
    hum_max: Number(area.hum_max),
    activa: area.activa,
  };
}

export function GestorAreas({ areas }: { areas: AreaConMetricas[] }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();

  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [errorFicha, setErrorFicha] = useState<string | null>(null);
  const [aBajar, setABajar] = useState<AreaConMetricas | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  function abrirNueva() {
    setErrorFicha(null);
    setFicha({ ...FICHA_VACIA });
  }

  function abrirEdicion(area: AreaConMetricas) {
    setErrorFicha(null);
    setFicha(aFicha(area));
  }

  function editar<C extends keyof Ficha>(campo: C, valor: Ficha[C]) {
    setFicha((actual) => (actual ? { ...actual, [campo]: valor } : actual));
  }

  function guardar() {
    if (!ficha) return;
    setErrorFicha(null);

    const { id, ...entrada } = ficha;

    iniciar(async () => {
      const resultado =
        id === null
          ? await crearArea(entrada)
          : await actualizarArea(id, entrada);

      if (!resultado.ok) {
        setErrorFicha(resultado.error);
        return;
      }

      setFicha(null);
      setAviso(resultado.mensaje ?? "Listo.");
      router.refresh();
    });
  }

  function confirmarCambioDeEstado() {
    if (!aBajar) return;
    const objetivo = aBajar;

    iniciar(async () => {
      const resultado = await cambiarActivaArea(objetivo.id, !objetivo.activa);
      setABajar(null);
      setAviso(resultado.ok ? (resultado.mensaje ?? "Listo.") : resultado.error);
      if (resultado.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between border-b border-borde pb-2">
        <h1 className="text-[15px] font-semibold text-texto">Áreas</h1>
        <div className="flex items-center gap-3">
          <span className="rotulo">{areas.length} áreas</span>
          <button type="button" className="boton" onClick={abrirNueva}>
            Nueva área
          </button>
        </div>
      </div>

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
              <th>Estado</th>
              <th>Código</th>
              <th>Nombre</th>
              <th>Tipo</th>
              <th className="col-num">Rango temp. °C</th>
              <th className="col-num">Rango hum. %</th>
              <th className="col-num">Empleados</th>
              <th className="col-num">Llamados abiertos</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {areas.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-tenue">
                  No hay áreas cargadas.
                </td>
              </tr>
            ) : (
              areas.map((area) => (
                <tr key={area.id} data-baja={area.activa ? "no" : "si"}>
                  <td>
                    <Etiqueta
                      texto={area.activa ? "Activa" : "Baja"}
                      nivel={area.activa ? "NORMAL" : "NEUTRO"}
                    />
                  </td>
                  <td className="text-texto">{area.codigo}</td>
                  <td>{area.nombre}</td>
                  <td className="text-tenue">{area.tipo}</td>
                  <td className="col-num">
                    {numero(Number(area.temp_min), 0)} –{" "}
                    {numero(Number(area.temp_max), 0)}
                  </td>
                  <td className="col-num">
                    {numero(Number(area.hum_min), 0)} –{" "}
                    {numero(Number(area.hum_max), 0)}
                  </td>
                  <td className="col-num">{entero(area.empleados)}</td>
                  <td
                    className={`col-num ${
                      area.llamados_abiertos > 0 ? "text-advertencia" : ""
                    }`}
                  >
                    {entero(area.llamados_abiertos)}
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="boton-plano"
                        onClick={() => abrirEdicion(area)}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="boton-plano"
                        onClick={() => setABajar(area)}
                      >
                        {area.activa ? "Dar de baja" : "Reactivar"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {ficha ? (
        <PanelLateral
          titulo={ficha.id === null ? "Nueva área" : "Editar área"}
          subtitulo={ficha.id === null ? undefined : ficha.codigo}
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
                onClick={guardar}
                disabled={pendiente}
              >
                {pendiente ? "Guardando…" : "Guardar"}
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            {errorFicha ? <Aviso texto={errorFicha} /> : null}

            <div className="grid grid-cols-2 gap-3">
              <Campo etiqueta="Código" htmlFor="codigo">
                <input
                  id="codigo"
                  className="campo"
                  value={ficha.codigo}
                  maxLength={12}
                  onChange={(e) =>
                    editar("codigo", e.target.value.toUpperCase())
                  }
                />
              </Campo>

              <Campo etiqueta="Tipo" htmlFor="tipo">
                <select
                  id="tipo"
                  className="campo"
                  value={ficha.tipo}
                  onChange={(e) => editar("tipo", e.target.value)}
                >
                  {TIPOS_AREA.map((tipo) => (
                    <option key={tipo} value={tipo}>
                      {tipo}
                    </option>
                  ))}
                </select>
              </Campo>
            </div>

            <Campo etiqueta="Nombre" htmlFor="nombre">
              <input
                id="nombre"
                className="campo"
                value={ficha.nombre}
                onChange={(e) => editar("nombre", e.target.value)}
              />
            </Campo>

            <div className="border-t border-borde pt-3">
              <div className="rotulo mb-2">Umbrales de alerta</div>
              <p className="mb-3 text-tenue">
                El tablero evalúa cada lectura contra estos valores en el
                momento de mostrarla. Un cambio acá cambia el comportamiento
                del sistema apenas se guarda.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <Campo etiqueta="Temp. mínima °C" htmlFor="temp_min">
                  <input
                    id="temp_min"
                    type="number"
                    step="0.1"
                    className="campo"
                    value={ficha.temp_min}
                    onChange={(e) =>
                      editar("temp_min", Number(e.target.value))
                    }
                  />
                </Campo>

                <Campo etiqueta="Temp. máxima °C" htmlFor="temp_max">
                  <input
                    id="temp_max"
                    type="number"
                    step="0.1"
                    className="campo"
                    value={ficha.temp_max}
                    onChange={(e) =>
                      editar("temp_max", Number(e.target.value))
                    }
                  />
                </Campo>

                <Campo etiqueta="Humedad mínima %" htmlFor="hum_min">
                  <input
                    id="hum_min"
                    type="number"
                    step="0.1"
                    className="campo"
                    value={ficha.hum_min}
                    onChange={(e) => editar("hum_min", Number(e.target.value))}
                  />
                </Campo>

                <Campo etiqueta="Humedad máxima %" htmlFor="hum_max">
                  <input
                    id="hum_max"
                    type="number"
                    step="0.1"
                    className="campo"
                    value={ficha.hum_max}
                    onChange={(e) => editar("hum_max", Number(e.target.value))}
                  />
                </Campo>
              </div>
            </div>

            <div className="border-t border-borde pt-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={ficha.activa}
                  onChange={(e) => editar("activa", e.target.checked)}
                />
                <span>Área activa</span>
              </label>
            </div>
          </div>
        </PanelLateral>
      ) : null}

      {aBajar ? (
        <ConfirmarModal
          titulo={aBajar.activa ? "Dar de baja el área" : "Reactivar el área"}
          mensaje={
            aBajar.activa
              ? `El área ${aBajar.codigo} — ${aBajar.nombre} deja de mostrarse en el tablero y de generar alertas. No se borra ningún dato histórico.`
              : `El área ${aBajar.codigo} — ${aBajar.nombre} vuelve a mostrarse en el tablero y a evaluarse.`
          }
          textoConfirmar={aBajar.activa ? "Dar de baja" : "Reactivar"}
          peligro={aBajar.activa}
          pendiente={pendiente}
          alConfirmar={confirmarCambioDeEstado}
          alCancelar={() => setABajar(null)}
        />
      ) : null}
    </div>
  );
}
