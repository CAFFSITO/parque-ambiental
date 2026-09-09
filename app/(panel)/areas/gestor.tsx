"use client";

// app/(panel)/areas/gestor.tsx
// Lista compacta de áreas + ficha en diálogo centrado. Sin librerías de tablas ni
// de formularios: HTML y estado de React.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { entero, numero } from "@/lib/formato";
import type { Area } from "@/lib/tipos";
import { Aviso, Campo } from "../componentes/campos";
import { Icono } from "../componentes/iconos";
import { Chip, Dato, FilaDesplegable, Lista } from "../componentes/lista";
import { ConfirmarModal, ModalFicha } from "../componentes/modal";
import { Selector, type OpcionSelector } from "../componentes/selector";
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
  tipo: "",
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

export function GestorAreas({
  areas,
  tiposDisponibles,
}: {
  areas: AreaConMetricas[];
  tiposDisponibles: string[];
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();

  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [errorFicha, setErrorFicha] = useState<string | null>(null);
  const [aBajar, setABajar] = useState<AreaConMetricas | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const opcionesTipo = useMemo<OpcionSelector[]>(
    () => tiposDisponibles.map((tipo) => ({ valor: tipo, etiqueta: tipo })),
    [tiposDisponibles],
  );

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
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-borde pb-2">
        <h1 className="titulo-modulo min-w-0">
          <Icono nombre="areas" tamano={18} />
          Áreas
        </h1>
        <div className="ml-auto flex min-w-0 items-center gap-3">
          <span className="rotulo whitespace-nowrap">{areas.length} áreas</span>
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

      <Lista hayFilas={areas.length > 0} vacio="No hay áreas cargadas.">
        {areas.map((area) => (
          <FilaDesplegable
            key={area.id}
            clave={String(area.id)}
            nivel={
              area.llamados_abiertos > 0
                ? "ADVERTENCIA"
                : area.activa
                  ? "NORMAL"
                  : "NINGUNO"
            }
            tenue={!area.activa}
            accion={
              <button
                type="button"
                className="boton boton-chico"
                onClick={() => abrirEdicion(area)}
              >
                Editar
              </button>
            }
            titulo={area.codigo}
            marcas={
              area.activa ? null : <Chip texto="Baja" />
            }
            resumen={area.nombre}
            detalle={
              <>
                <Dato rotulo="Nombre">{area.nombre}</Dato>
                <Dato rotulo="Tipo">{area.tipo}</Dato>
                <Dato rotulo="Estado">{area.activa ? "Activa" : "Baja"}</Dato>
                <Dato rotulo="Rango de temperatura">
                  {numero(Number(area.temp_min), 0)} –{" "}
                  {numero(Number(area.temp_max), 0)} °C
                </Dato>
                <Dato rotulo="Rango de humedad">
                  {numero(Number(area.hum_min), 0)} –{" "}
                  {numero(Number(area.hum_max), 0)} %
                </Dato>
                <Dato rotulo="Empleados asignados">
                  {entero(area.empleados)}
                </Dato>
                <Dato rotulo="Llamados abiertos">
                  {entero(area.llamados_abiertos)}
                </Dato>
              </>
            }
            pie={
              <button
                type="button"
                className="boton-plano"
                onClick={() => setABajar(area)}
              >
                {area.activa ? "Dar de baja" : "Reactivar"}
              </button>
            }
          />
        ))}
      </Lista>

      {ficha ? (
        <ModalFicha
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

            <Campo etiqueta="Código" htmlFor="codigo">
              <input
                id="codigo"
                className="campo"
                value={ficha.codigo}
                maxLength={12}
                onChange={(e) => editar("codigo", e.target.value.toUpperCase())}
              />
            </Campo>

            <Campo
              etiqueta="Tipo"
              htmlFor="tipo"
              ayuda="Elegí uno de los tipos ya creados o escribí uno nuevo y apretá Enter."
            >
              <Selector
                id="tipo"
                rotuloMenu="Tipos de área"
                creable
                opciones={opcionesTipo}
                valores={ficha.tipo === "" ? [] : [ficha.tipo]}
                alCambiar={(valores) => editar("tipo", valores[0] ?? "")}
              />
            </Campo>

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
                    onChange={(e) => editar("temp_min", Number(e.target.value))}
                  />
                </Campo>

                <Campo etiqueta="Temp. máxima °C" htmlFor="temp_max">
                  <input
                    id="temp_max"
                    type="number"
                    step="0.1"
                    className="campo"
                    value={ficha.temp_max}
                    onChange={(e) => editar("temp_max", Number(e.target.value))}
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
        </ModalFicha>
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
