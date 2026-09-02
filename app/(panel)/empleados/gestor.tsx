"use client";

// app/(panel)/empleados/gestor.tsx
// Listado con filtros y buscador + ficha completa en panel lateral.
// Los filtros trabajan en memoria sobre la nómina ya cargada.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ESTADOS_EMPLEADO,
  nombreTurno,
  TAREAS,
  TURNOS,
  type EstadoEmpleado,
} from "@/lib/catalogos";
import { fechaCorta, SIN_DATO } from "@/lib/formato";
import type { Area, Empleado } from "@/lib/tipos";
import { Aviso, Campo, Etiqueta } from "../componentes/campos";
import { ConfirmarModal } from "../componentes/modal";
import { PanelLateral } from "../componentes/panel-lateral";
import {
  actualizarEmpleado,
  cambiarEstadoEmpleado,
  crearEmpleado,
  type EntradaEmpleado,
} from "./acciones";

type Ficha = EntradaEmpleado & { id: number | null };

const FICHA_VACIA: Ficha = {
  id: null,
  legajo: "",
  nombre: "",
  apellido: "",
  dni: "",
  fecha_nacimiento: "",
  telefono: "",
  email: "",
  domicilio: "",
  area_id: null,
  tarea: "",
  turno: "M",
  fecha_ingreso: "",
  estado: "activo",
  observaciones: "",
};

function aFicha(empleado: Empleado): Ficha {
  return {
    id: empleado.id,
    legajo: empleado.legajo,
    nombre: empleado.nombre,
    apellido: empleado.apellido,
    dni: empleado.dni,
    fecha_nacimiento: empleado.fecha_nacimiento ?? "",
    telefono: empleado.telefono ?? "",
    email: empleado.email ?? "",
    domicilio: empleado.domicilio ?? "",
    area_id: empleado.area_id,
    tarea: empleado.tarea ?? "",
    turno: empleado.turno ?? "",
    fecha_ingreso: empleado.fecha_ingreso ?? "",
    estado: empleado.estado,
    observaciones: empleado.observaciones ?? "",
  };
}

function nivelDeEstado(
  estado: string,
): "NORMAL" | "ADVERTENCIA" | "EMERGENCIA" | "NEUTRO" {
  if (estado === "activo") return "NORMAL";
  if (estado === "licencia") return "ADVERTENCIA";
  return "NEUTRO";
}

export function GestorEmpleados({
  empleados,
  areas,
}: {
  empleados: Empleado[];
  areas: Area[];
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();

  const [filtroArea, setFiltroArea] = useState<string>("");
  const [filtroEstado, setFiltroEstado] = useState<string>("");
  const [busqueda, setBusqueda] = useState<string>("");

  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [errorFicha, setErrorFicha] = useState<string | null>(null);
  const [aBajar, setABajar] = useState<Empleado | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const nombrePorArea = useMemo(() => {
    const mapa = new Map<number, string>();
    for (const area of areas) mapa.set(area.id, `${area.codigo} — ${area.nombre}`);
    return mapa;
  }, [areas]);

  const visibles = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();

    return empleados.filter((empleado) => {
      if (filtroArea !== "" && String(empleado.area_id ?? "") !== filtroArea) {
        return false;
      }
      if (filtroEstado !== "" && empleado.estado !== filtroEstado) return false;
      if (texto === "") return true;

      return (
        empleado.apellido.toLowerCase().includes(texto) ||
        empleado.legajo.toLowerCase().includes(texto)
      );
    });
  }, [empleados, filtroArea, filtroEstado, busqueda]);

  function abrirNuevo() {
    setErrorFicha(null);
    setFicha({ ...FICHA_VACIA });
  }

  function abrirEdicion(empleado: Empleado) {
    setErrorFicha(null);
    setFicha(aFicha(empleado));
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
          ? await crearEmpleado(entrada)
          : await actualizarEmpleado(id, entrada);

      if (!resultado.ok) {
        setErrorFicha(resultado.error);
        return;
      }

      setFicha(null);
      setAviso(resultado.mensaje ?? "Listo.");
      router.refresh();
    });
  }

  function confirmarBaja() {
    if (!aBajar) return;
    const objetivo = aBajar;
    const nuevoEstado: EstadoEmpleado =
      objetivo.estado === "baja" ? "activo" : "baja";

    iniciar(async () => {
      const resultado = await cambiarEstadoEmpleado(objetivo.id, nuevoEstado);
      setABajar(null);
      setAviso(resultado.ok ? (resultado.mensaje ?? "Listo.") : resultado.error);
      if (resultado.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between border-b border-borde pb-2">
        <h1 className="text-[15px] font-semibold text-texto">Empleados</h1>
        <div className="flex items-center gap-3">
          <span className="rotulo">
            {visibles.length} de {empleados.length}
          </span>
          <button type="button" className="boton" onClick={abrirNuevo}>
            Nuevo empleado
          </button>
        </div>
      </div>

      <section className="panel flex flex-wrap items-end gap-3 p-3">
        <div className="w-[220px]">
          <Campo etiqueta="Buscar por apellido o legajo" htmlFor="busqueda">
            <input
              id="busqueda"
              className="campo"
              value={busqueda}
              placeholder="Barrios · PAB-0001"
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </Campo>
        </div>

        <div className="w-[240px]">
          <Campo etiqueta="Área" htmlFor="filtro-area">
            <select
              id="filtro-area"
              className="campo"
              value={filtroArea}
              onChange={(e) => setFiltroArea(e.target.value)}
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

        <div className="w-[150px]">
          <Campo etiqueta="Estado" htmlFor="filtro-estado">
            <select
              id="filtro-estado"
              className="campo"
              value={filtroEstado}
              onChange={(e) => setFiltroEstado(e.target.value)}
            >
              <option value="">Todos</option>
              {ESTADOS_EMPLEADO.map((estado) => (
                <option key={estado} value={estado}>
                  {estado}
                </option>
              ))}
            </select>
          </Campo>
        </div>

        <button
          type="button"
          className="boton-plano"
          onClick={() => {
            setBusqueda("");
            setFiltroArea("");
            setFiltroEstado("");
          }}
        >
          Limpiar filtros
        </button>
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
              <th>Legajo</th>
              <th>Apellido y nombre</th>
              <th className="col-num">DNI</th>
              <th>Área</th>
              <th>Tarea</th>
              <th>Turno</th>
              <th>Estado</th>
              <th>Ingreso</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-tenue">
                  Ningún empleado coincide con el filtro.
                </td>
              </tr>
            ) : (
              visibles.map((empleado) => (
                <tr
                  key={empleado.id}
                  data-baja={empleado.estado === "baja" ? "si" : "no"}
                >
                  <td className="text-texto">{empleado.legajo}</td>
                  <td>
                    {empleado.apellido}, {empleado.nombre}
                  </td>
                  <td className="col-num">{empleado.dni}</td>
                  <td className="text-tenue">
                    {empleado.area_id === null
                      ? SIN_DATO
                      : (nombrePorArea.get(empleado.area_id) ?? SIN_DATO)}
                  </td>
                  <td className="text-tenue">{empleado.tarea ?? SIN_DATO}</td>
                  <td className="text-tenue">{nombreTurno(empleado.turno)}</td>
                  <td>
                    <Etiqueta
                      texto={empleado.estado}
                      nivel={nivelDeEstado(empleado.estado)}
                    />
                  </td>
                  <td>{fechaCorta(empleado.fecha_ingreso)}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="boton-plano"
                        onClick={() => abrirEdicion(empleado)}
                      >
                        Ficha
                      </button>
                      <button
                        type="button"
                        className="boton-plano"
                        onClick={() => setABajar(empleado)}
                      >
                        {empleado.estado === "baja" ? "Reactivar" : "Dar de baja"}
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
          titulo={ficha.id === null ? "Nuevo empleado" : "Ficha del empleado"}
          subtitulo={
            ficha.id === null
              ? undefined
              : `${ficha.legajo} · ${ficha.apellido}, ${ficha.nombre}`
          }
          ancho={480}
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
              <Campo etiqueta="Legajo" htmlFor="legajo">
                <input
                  id="legajo"
                  className="campo"
                  value={ficha.legajo}
                  onChange={(e) =>
                    editar("legajo", e.target.value.toUpperCase())
                  }
                />
              </Campo>

              <Campo etiqueta="DNI" htmlFor="dni" ayuda="7 u 8 dígitos, sin puntos">
                <input
                  id="dni"
                  className="campo"
                  inputMode="numeric"
                  value={ficha.dni}
                  onChange={(e) =>
                    editar("dni", e.target.value.replace(/\D/g, ""))
                  }
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

              <Campo etiqueta="Apellido" htmlFor="apellido">
                <input
                  id="apellido"
                  className="campo"
                  value={ficha.apellido}
                  onChange={(e) => editar("apellido", e.target.value)}
                />
              </Campo>

              <Campo etiqueta="Fecha de nacimiento" htmlFor="fecha_nacimiento">
                <input
                  id="fecha_nacimiento"
                  type="date"
                  className="campo"
                  value={ficha.fecha_nacimiento}
                  onChange={(e) => editar("fecha_nacimiento", e.target.value)}
                />
              </Campo>

              <Campo etiqueta="Teléfono" htmlFor="telefono">
                <input
                  id="telefono"
                  className="campo"
                  value={ficha.telefono}
                  onChange={(e) => editar("telefono", e.target.value)}
                />
              </Campo>
            </div>

            <Campo etiqueta="Email" htmlFor="email">
              <input
                id="email"
                type="email"
                className="campo"
                value={ficha.email}
                onChange={(e) => editar("email", e.target.value)}
              />
            </Campo>

            <Campo etiqueta="Domicilio" htmlFor="domicilio">
              <input
                id="domicilio"
                className="campo"
                value={ficha.domicilio}
                onChange={(e) => editar("domicilio", e.target.value)}
              />
            </Campo>

            <div className="grid grid-cols-2 gap-3 border-t border-borde pt-3">
              <Campo etiqueta="Área" htmlFor="area">
                <select
                  id="area"
                  className="campo"
                  value={ficha.area_id === null ? "" : String(ficha.area_id)}
                  onChange={(e) =>
                    editar(
                      "area_id",
                      e.target.value === "" ? null : Number(e.target.value),
                    )
                  }
                >
                  <option value="">Sin asignar</option>
                  {areas.map((area) => (
                    <option key={area.id} value={String(area.id)}>
                      {area.codigo} — {area.nombre}
                    </option>
                  ))}
                </select>
              </Campo>

              <Campo etiqueta="Tarea" htmlFor="tarea">
                <select
                  id="tarea"
                  className="campo"
                  value={ficha.tarea}
                  onChange={(e) => editar("tarea", e.target.value)}
                >
                  <option value="">Sin asignar</option>
                  {TAREAS.map((tarea) => (
                    <option key={tarea} value={tarea}>
                      {tarea}
                    </option>
                  ))}
                </select>
              </Campo>

              <Campo etiqueta="Turno" htmlFor="turno">
                <select
                  id="turno"
                  className="campo"
                  value={ficha.turno}
                  onChange={(e) => editar("turno", e.target.value)}
                >
                  <option value="">Sin asignar</option>
                  {TURNOS.map((turno) => (
                    <option key={turno.codigo} value={turno.codigo}>
                      {turno.codigo} — {turno.nombre}
                    </option>
                  ))}
                </select>
              </Campo>

              <Campo etiqueta="Fecha de ingreso" htmlFor="fecha_ingreso">
                <input
                  id="fecha_ingreso"
                  type="date"
                  className="campo"
                  value={ficha.fecha_ingreso}
                  onChange={(e) => editar("fecha_ingreso", e.target.value)}
                />
              </Campo>
            </div>

            <Campo
              etiqueta="Estado"
              htmlFor="estado"
              ayuda="La baja es lógica: la ficha y su historial quedan en la base."
            >
              <select
                id="estado"
                className="campo"
                value={ficha.estado}
                onChange={(e) => editar("estado", e.target.value)}
              >
                {ESTADOS_EMPLEADO.map((estado) => (
                  <option key={estado} value={estado}>
                    {estado}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo etiqueta="Observaciones" htmlFor="observaciones">
              <textarea
                id="observaciones"
                className="campo"
                rows={3}
                value={ficha.observaciones}
                onChange={(e) => editar("observaciones", e.target.value)}
              />
            </Campo>
          </div>
        </PanelLateral>
      ) : null}

      {aBajar ? (
        <ConfirmarModal
          titulo={
            aBajar.estado === "baja"
              ? "Reactivar al empleado"
              : "Dar de baja al empleado"
          }
          mensaje={
            aBajar.estado === "baja"
              ? `${aBajar.apellido}, ${aBajar.nombre} (${aBajar.legajo}) vuelve al estado activo.`
              : `${aBajar.apellido}, ${aBajar.nombre} (${aBajar.legajo}) pasa a estado baja. Es una baja lógica: la ficha no se borra y los llamados históricos siguen referenciando su legajo.`
          }
          textoConfirmar={aBajar.estado === "baja" ? "Reactivar" : "Dar de baja"}
          peligro={aBajar.estado !== "baja"}
          pendiente={pendiente}
          alConfirmar={confirmarBaja}
          alCancelar={() => setABajar(null)}
        />
      ) : null}
    </div>
  );
}
