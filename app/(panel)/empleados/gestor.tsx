"use client";

// app/(panel)/empleados/gestor.tsx
// Lista compacta con filtros y buscador + ficha completa en diálogo centrado.
// Los filtros trabajan en memoria sobre la nómina ya cargada.
//
// Área, tarea y turno son selecciones múltiples: un empleado puede cubrir más
// de un área, hacer más de una tarea y rotar por más de un turno.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ESTADOS_EMPLEADO,
  nombreTurno,
  normalizarOpcion,
  TURNOS,
  type EstadoEmpleado,
} from "@/lib/catalogos";
import { fechaCorta, SIN_DATO } from "@/lib/formato";
import type { Area, Empleado } from "@/lib/tipos";
import { Aviso, Campo } from "../componentes/campos";
import { Desplegable } from "../componentes/desplegable";
import { Icono } from "../componentes/iconos";
import { CampoFecha } from "../componentes/fecha";
import { Chip, Dato, FilaDesplegable, Lista } from "../componentes/lista";
import { ConfirmarModal, ModalFicha } from "../componentes/modal";
import { Selector, type OpcionSelector } from "../componentes/selector";
import {
  actualizarEmpleado,
  cambiarEstadoEmpleado,
  eliminarEmpleadoSinUsuario,
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
  areas_ids: [],
  tareas: [],
  turnos: [],
  fecha_ingreso: "",
  estado: "activo",
  observaciones: "",
};

/**
 * Los arreglos son la fuente de verdad, pero una ficha guardada antes de la
 * migración solo tiene el valor único. Estos tres lectores devuelven siempre
 * la lista completa, venga de donde venga.
 */
function areasDe(empleado: Empleado): number[] {
  if (empleado.areas_ids?.length) return empleado.areas_ids;
  return empleado.area_id === null ? [] : [empleado.area_id];
}

function tareasDe(empleado: Empleado): string[] {
  if (empleado.tareas?.length) return empleado.tareas;
  return empleado.tarea ? [empleado.tarea] : [];
}

function turnosDe(empleado: Empleado): string[] {
  if (empleado.turnos?.length) return empleado.turnos;
  return empleado.turno ? [empleado.turno] : [];
}

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
    areas_ids: areasDe(empleado),
    tareas: tareasDe(empleado),
    turnos: turnosDe(empleado),
    fecha_ingreso: empleado.fecha_ingreso ?? "",
    estado: empleado.estado,
    observaciones: empleado.observaciones ?? "",
  };
}

function nivelDeEstado(
  estado: string,
): "NORMAL" | "ADVERTENCIA" | "EMERGENCIA" | "NINGUNO" {
  if (estado === "activo") return "NORMAL";
  if (estado === "licencia") return "ADVERTENCIA";
  return "NINGUNO";
}

/**
 * Qué impide borrar a cada empleado, ya resuelto por el servidor.
 *
 *   bloqueos []   -> se puede borrar.
 *   bloqueos [..] -> tiene un usuario ligado; solo se puede dar de baja.
 *
 * `llamados_legajo` NO bloquea: llamados.creado_por y atendido_por son texto
 * libre sin clave foránea. Se muestra como advertencia antes de confirmar.
 */
export type InfoBorrado = {
  bloqueos: string[];
  llamados_legajo: number;
};

export function GestorEmpleados({
  empleados,
  areas,
  borrado,
  tareasDisponibles,
  turnosGuardados,
}: {
  empleados: Empleado[];
  areas: Area[];
  /** null = falta sql/12: no se ofrece borrar. */
  borrado: Record<number, InfoBorrado> | null;
  tareasDisponibles: string[];
  turnosGuardados: string[];
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();

  const [filtroArea, setFiltroArea] = useState<string>("");
  const [aBorrar, setABorrar] = useState<Empleado | null>(null);

  /** Lo que el servidor dijo de este empleado, o null si no se pudo saber. */
  function infoBorrado(empleado: Empleado): InfoBorrado | null {
    return borrado?.[empleado.id] ?? null;
  }

  /**
   * Borrado definitivo. Es OTRA acción que dar de baja, a propósito: borrar no
   * se puede deshacer, y el servidor vuelve a contar antes de hacerlo.
   */
  function confirmarBorrado() {
    if (!aBorrar) return;
    const objetivo = aBorrar;

    iniciar(async () => {
      const resultado = await eliminarEmpleadoSinUsuario(objetivo.id);
      setABorrar(null);
      setAviso(resultado.ok ? (resultado.mensaje ?? "Listo.") : resultado.error);
      if (resultado.ok) router.refresh();
    });
  }
  const [filtroEstado, setFiltroEstado] = useState<string>("");
  const [busqueda, setBusqueda] = useState<string>("");

  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [errorFicha, setErrorFicha] = useState<string | null>(null);
  const [aBajar, setABajar] = useState<Empleado | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const nombrePorArea = useMemo(() => {
    const mapa = new Map<number, string>();
    for (const area of areas) {
      mapa.set(area.id, `${area.codigo} — ${area.nombre}`);
    }
    return mapa;
  }, [areas]);

  const codigoPorArea = useMemo(() => {
    const mapa = new Map<number, string>();
    for (const area of areas) mapa.set(area.id, area.codigo);
    return mapa;
  }, [areas]);

  const opcionesArea = useMemo<OpcionSelector[]>(
    () =>
      areas.map((area) => ({
        valor: String(area.id),
        etiqueta: `${area.codigo} — ${area.nombre}`,
      })),
    [areas],
  );

  const opcionesTarea = useMemo<OpcionSelector[]>(
    () => tareasDisponibles.map((tarea) => ({ valor: tarea, etiqueta: tarea })),
    [tareasDisponibles],
  );

  // Los tres turnos históricos se guardan por código y se muestran con nombre.
  // Uno creado a mano vale por su propio texto.
  const opcionesTurno = useMemo<OpcionSelector[]>(() => {
    const mapa = new Map<string, OpcionSelector>();
    for (const turno of TURNOS) {
      mapa.set(turno.codigo, {
        valor: turno.codigo,
        etiqueta: `${turno.codigo} — ${turno.nombre}`,
      });
    }
    for (const guardado of turnosGuardados) {
      const valor = normalizarOpcion(guardado);
      if (valor === "" || mapa.has(valor)) continue;
      mapa.set(valor, { valor, etiqueta: valor });
    }
    return [...mapa.values()];
  }, [turnosGuardados]);

  const visibles = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();

    return empleados.filter((empleado) => {
      if (
        filtroArea !== "" &&
        !areasDe(empleado).some((id) => String(id) === filtroArea)
      ) {
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

  /** Texto corto para la fila cerrada: códigos de área y turnos. */
  function resumenDe(empleado: Empleado): string {
    const codigos = areasDe(empleado)
      .map((id) => codigoPorArea.get(id) ?? SIN_DATO)
      .join(" · ");
    const turnos = turnosDe(empleado).map(nombreTurno).join(" · ");

    return [empleado.legajo, codigos || SIN_DATO, turnos]
      .filter((parte) => parte !== "")
      .join("  ·  ");
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between border-b border-borde pb-2">
        <h1 className="titulo-modulo">
          <Icono nombre="empleados" tamano={18} />
          Empleados
        </h1>
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
            <Desplegable
              id="filtro-area"
              valor={filtroArea}
              opciones={[
                { valor: "", etiqueta: "Todas" },
                ...areas.map((area) => ({
                  valor: String(area.id),
                  etiqueta: `${area.codigo} — ${area.nombre}`,
                })),
              ]}
              alCambiar={setFiltroArea}
            />
          </Campo>
        </div>

        <div className="w-[150px]">
          <Campo etiqueta="Estado" htmlFor="filtro-estado">
            <Desplegable
              id="filtro-estado"
              valor={filtroEstado}
              opciones={[
                { valor: "", etiqueta: "Todos" },
                ...ESTADOS_EMPLEADO.map((estado) => ({
                  valor: estado,
                  etiqueta: estado,
                })),
              ]}
              alCambiar={setFiltroEstado}
            />
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

      <Lista
        hayFilas={visibles.length > 0}
        vacio="Ningún empleado coincide con el filtro."
      >
        {visibles.map((empleado) => {
          const propias = areasDe(empleado);
          const tareas = tareasDe(empleado);
          const turnos = turnosDe(empleado);

          return (
            <FilaDesplegable
              key={empleado.id}
              clave={String(empleado.id)}
              nivel={nivelDeEstado(empleado.estado)}
              tenue={empleado.estado === "baja"}
              accion={
                <button
                  type="button"
                  className="boton boton-chico"
                  onClick={() => abrirEdicion(empleado)}
                >
                  Ficha
                </button>
              }
              titulo={`${empleado.apellido}, ${empleado.nombre}`}
              marcas={
                empleado.estado === "activo" ? null : (
                  <Chip
                    texto={empleado.estado}
                    nivel={nivelDeEstado(empleado.estado)}
                  />
                )
              }
              resumen={resumenDe(empleado)}
              detalle={
                <>
                  <Dato rotulo="Legajo">{empleado.legajo}</Dato>
                  <Dato rotulo="DNI">{empleado.dni}</Dato>
                  <Dato rotulo="Fecha de nacimiento">
                    {fechaCorta(empleado.fecha_nacimiento)}
                  </Dato>
                  <Dato rotulo="Teléfono">{empleado.telefono ?? SIN_DATO}</Dato>
                  <Dato rotulo="Email">{empleado.email ?? SIN_DATO}</Dato>
                  <Dato rotulo="Domicilio">
                    {empleado.domicilio ?? SIN_DATO}
                  </Dato>
                  <Dato rotulo="Áreas">
                    {propias.length === 0
                      ? SIN_DATO
                      : propias
                          .map((id) => nombrePorArea.get(id) ?? SIN_DATO)
                          .join(" · ")}
                  </Dato>
                  <Dato rotulo="Tareas">
                    {tareas.length === 0 ? SIN_DATO : tareas.join(" · ")}
                  </Dato>
                  <Dato rotulo="Turnos">
                    {turnos.length === 0
                      ? SIN_DATO
                      : turnos.map(nombreTurno).join(" · ")}
                  </Dato>
                  <Dato rotulo="Ingreso">
                    {fechaCorta(empleado.fecha_ingreso)}
                  </Dato>
                  <Dato rotulo="Estado">{empleado.estado}</Dato>
                  <Dato rotulo="Observaciones" ancho>
                    {empleado.observaciones ?? SIN_DATO}
                  </Dato>
                  <Dato rotulo="Borrado" ancho>
                    {(() => {
                      const info = infoBorrado(empleado);
                      if (info === null) {
                        return (
                          <span className="text-tenue">
                            No se puede saber qué depende de esta ficha: falta
                            correr sql/12_borrado_seguro.sql. Sin certeza no se
                            ofrece borrar.
                          </span>
                        );
                      }
                      if (info.bloqueos.length > 0) {
                        return (
                          <span className="text-tenue">
                            No se puede borrar porque tiene{" "}
                            {info.bloqueos.join(", ")}. Borrá o desvinculá el
                            usuario primero, o dalo de baja.
                          </span>
                        );
                      }
                      return info.llamados_legajo > 0
                        ? `Se puede borrar. Quedan ${info.llamados_legajo} llamado${info.llamados_legajo === 1 ? "" : "s"} con su legajo escrito, que no se van a poder resolver a esta ficha.`
                        : "No tiene usuario ligado: se puede borrar definitivamente.";
                    })()}
                  </Dato>
                </>
              }
              pie={
                <>
                  <button
                    type="button"
                    className="boton-plano"
                    onClick={() => setABajar(empleado)}
                  >
                    {empleado.estado === "baja" ? "Reactivar" : "Dar de baja"}
                  </button>

                  {/* Borrar solo se OFRECE cuando no hay usuario ligado. La
                      pantalla no es el control: eliminarEmpleadoSinUsuario()
                      vuelve a verificar. */}
                  {infoBorrado(empleado)?.bloqueos.length === 0 ? (
                    <button
                      type="button"
                      className="boton-plano"
                      onClick={() => setABorrar(empleado)}
                    >
                      Eliminar
                    </button>
                  ) : null}
                </>
              }
            />
          );
        })}
      </Lista>

      {ficha ? (
        <ModalFicha
          titulo={ficha.id === null ? "Nuevo empleado" : "Ficha del empleado"}
          subtitulo={
            ficha.id === null
              ? undefined
              : `${ficha.legajo} · ${ficha.apellido}, ${ficha.nombre}`
          }
          ancho={640}
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

              <Campo
                etiqueta="DNI"
                htmlFor="dni"
                ayuda="7 u 8 dígitos, sin puntos"
              >
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
                <CampoFecha
                  id="fecha_nacimiento"
                  valor={ficha.fecha_nacimiento}
                  alCambiar={(valor) => editar("fecha_nacimiento", valor)}
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

            <div className="flex flex-col gap-3 border-t border-borde pt-3">
              <Campo
                etiqueta="Áreas"
                htmlFor="areas"
                ayuda="Se pueden asignar varias. La primera es la que hereda el usuario del sistema."
              >
                <Selector
                  id="areas"
                  multiple
                  rotuloMenu="Áreas del parque"
                  opciones={opcionesArea}
                  valores={ficha.areas_ids.map(String)}
                  alCambiar={(valores) =>
                    editar("areas_ids", valores.map(Number))
                  }
                />
              </Campo>

              <Campo
                etiqueta="Tareas"
                htmlFor="tareas"
                ayuda="Elegí las que ya existen o escribí una nueva y apretá Enter."
              >
                <Selector
                  id="tareas"
                  multiple
                  creable
                  rotuloMenu="Tareas"
                  opciones={opcionesTarea}
                  valores={ficha.tareas}
                  alCambiar={(valores) => editar("tareas", valores)}
                />
              </Campo>

              <Campo
                etiqueta="Turnos"
                htmlFor="turnos"
                ayuda="Elegí los que ya existen o escribí uno nuevo y apretá Enter."
              >
                <Selector
                  id="turnos"
                  multiple
                  creable
                  rotuloMenu="Turnos"
                  opciones={opcionesTurno}
                  valores={ficha.turnos}
                  alCambiar={(valores) => editar("turnos", valores)}
                />
              </Campo>

              <Campo etiqueta="Fecha de ingreso" htmlFor="fecha_ingreso">
                <CampoFecha
                  id="fecha_ingreso"
                  valor={ficha.fecha_ingreso}
                  alCambiar={(valor) => editar("fecha_ingreso", valor)}
                />
              </Campo>
            </div>

            <Campo
              etiqueta="Estado"
              htmlFor="estado"
              ayuda="La baja es lógica: la ficha y su historial quedan en la base."
            >
              <Desplegable
                id="estado"
                valor={ficha.estado}
                opciones={ESTADOS_EMPLEADO.map((estado) => ({
                  valor: estado,
                  etiqueta: estado,
                }))}
                alCambiar={(valor) => editar("estado", valor)}
              />
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
        </ModalFicha>
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

      {aBorrar ? (
        <ConfirmarModal
          titulo="Eliminar al empleado"
          mensaje={`La ficha de ${aBorrar.apellido}, ${aBorrar.nombre} (${aBorrar.legajo}) se borra de la base y no se puede recuperar.${(infoBorrado(aBorrar)?.llamados_legajo ?? 0) > 0 ? ` Quedan ${infoBorrado(aBorrar)?.llamados_legajo} llamado(s) con su legajo escrito: no se borran, pero dejan de poder resolverse a una ficha.` : ""} Si la persona trabajó acá, dala de baja en vez de borrarla.`}
          textoConfirmar="Eliminar"
          peligro
          pendiente={pendiente}
          alConfirmar={confirmarBorrado}
          alCancelar={() => setABorrar(null)}
        />
      ) : null}
    </div>
  );
}
