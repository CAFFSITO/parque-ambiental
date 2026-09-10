"use client";

// app/(panel)/areas/gestor.tsx
// Lista compacta de áreas + ficha en diálogo centrado. Sin librerías de tablas ni
// de formularios: HTML y estado de React.
//
// La ficha configura tres cosas distintas, y el formulario las separa a
// propósito en tres secciones:
//
//   * UMBRALES DE ALERTA -> definen la normalidad. Salirse genera un llamado,
//     siempre, en las cuatro condiciones.
//   * AUTOMATIZACIÓN -> decide cuál de esos cuatro desvíos, además, enciende el
//     actuador del nodo.
//   * DISPOSITIVOS ASIGNADOS -> qué nodos miden esta área.
//
// Por eso cada casilla de automatización muestra al lado el umbral vigente: la
// casilla no define un valor, elige qué hacer con un valor que se define arriba.
//
// FUENTE DE VERDAD DE LA ASIGNACIÓN
// Asignar y desasignar se hacen con cambiarAreaDispositivo(), la MISMA Server
// Action que usa la pantalla de Dispositivos. No se escribió una acción propia
// en areas/acciones.ts, y es deliberado: la regla de cardinalidad —un
// dispositivo tiene un área vigente, asignar a otra reasigna y no duplica— vive
// en dispositivos.area_id, que es una sola columna escalar. Una segunda acción
// que escribiera esa misma columna sería una segunda copia de la regla, y las
// dos copias se separan tarde o temprano.
//
// Consecuencia visible: los cambios de dispositivo se aplican en el momento, no
// al apretar Guardar. La ficha lo dice.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CONDICIONES,
  claveDeCondicion,
  etiquetaCondicion,
  type CondicionActuador,
} from "@/lib/automatizacion";
import { entero, fechaHora, hace, numero } from "@/lib/formato";
import type {
  AreaConAutomatizacion,
  DispositivoConEstado,
  EstadoConexion,
  Resultado,
} from "@/lib/tipos";
import { Aviso, Campo } from "../componentes/campos";
import { Desplegable } from "../componentes/desplegable";
import { Icono } from "../componentes/iconos";
import { Chip, Dato, FilaDesplegable, Lista } from "../componentes/lista";
import { ConfirmarModal, ModalFicha } from "../componentes/modal";
import { Selector, type OpcionSelector } from "../componentes/selector";
import { cambiarAreaDispositivo } from "../dispositivos/acciones";
import {
  actualizarArea,
  cambiarActivaArea,
  eliminarAreaVacia,
  crearArea,
  type EntradaArea,
} from "./acciones";

export type AreaConMetricas = AreaConAutomatizacion & {
  empleados: number;
  llamados_abiertos: number;
  dispositivos: number;
  /**
   * Por qué NO se puede borrar el área, ya resuelto por el servidor.
   *
   *   null -> no se pudo averiguar (falta sql/12). No se ofrece borrar.
   *   []   -> no cuelga nada: se puede borrar.
   *   [..] -> tiene historia: solo se puede dar de baja.
   */
  bloqueos: string[] | null;
};

type Ficha = EntradaArea & { id: number | null };

/**
 * Un área nueva nace con la misma automatización que tienen hoy las ocho
 * existentes, que es la que dejó el backfill de sql/07_automatizacion_areas.sql:
 * ventilar cuando hace más calor que el máximo, regar cuando hay menos humedad
 * que el mínimo. Así una pantalla de área nueva no sorprende a quien ya conoce
 * el comportamiento del parque.
 */
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
  auto_temp_baja: false,
  auto_temp_alta: true,
  auto_hum_baja: true,
  auto_hum_alta: false,
};

function aFicha(area: AreaConAutomatizacion): Ficha {
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
    auto_temp_baja: area.auto_temp_baja,
    auto_temp_alta: area.auto_temp_alta,
    auto_hum_baja: area.auto_hum_baja,
    auto_hum_alta: area.auto_hum_alta,
  };
}

/** El umbral que gobierna cada condición, con su unidad y su comparación. */
function limiteDe(ficha: Ficha, condicion: CondicionActuador): string {
  switch (condicion) {
    case "TEMP_BAJA":
      return `menos de ${numero(ficha.temp_min)} °C`;
    case "TEMP_ALTA":
      return `más de ${numero(ficha.temp_max)} °C`;
    case "HUM_BAJA":
      return `menos de ${numero(ficha.hum_min)} %`;
    case "HUM_ALTA":
      return `más de ${numero(ficha.hum_max)} %`;
  }
}

/** Las condiciones que un área tiene marcadas, para el resumen de la lista. */
function automatizacionDe(area: AreaConAutomatizacion): CondicionActuador[] {
  return CONDICIONES.filter((condicion) => area[claveDeCondicion(condicion)]);
}

function textoConexion(estado: EstadoConexion): string {
  if (estado === "EN_LINEA") return "En línea";
  if (estado === "SIN_SENAL") return "Sin señal";
  return "Nunca reportó";
}

export function GestorAreas({
  areas,
  tiposDisponibles,
  dispositivos,
}: {
  areas: AreaConMetricas[];
  tiposDisponibles: string[];
  dispositivos: DispositivoConEstado[];
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();

  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [errorFicha, setErrorFicha] = useState<string | null>(null);
  const [aBajar, setABajar] = useState<AreaConMetricas | null>(null);
  const [aBorrar, setABorrar] = useState<AreaConMetricas | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [aAsignar, setAAsignar] = useState<string>("");

  const opcionesTipo = useMemo<OpcionSelector[]>(
    () => tiposDisponibles.map((tipo) => ({ valor: tipo, etiqueta: tipo })),
    [tiposDisponibles],
  );

  const areasPorId = useMemo(
    () => new Map(areas.map((area) => [area.id, area])),
    [areas],
  );

  /** Agrupado en el cliente: la página trae la flota entera en una consulta. */
  const dispositivosPorArea = useMemo(() => {
    const mapa = new Map<number, DispositivoConEstado[]>();
    for (const dispositivo of dispositivos) {
      if (dispositivo.area_id === null) continue;
      const lista = mapa.get(dispositivo.area_id) ?? [];
      lista.push(dispositivo);
      mapa.set(dispositivo.area_id, lista);
    }
    return mapa;
  }, [dispositivos]);

  const asignados = ficha?.id === null ? [] : (dispositivosPorArea.get(ficha?.id ?? -1) ?? []);

  /**
   * Candidatos a asignar: los activos que no están ya en esta área. Incluye a
   * los que están en otra, porque asignar reasigna —un dispositivo tiene un
   * área vigente y no dos—, y la opción dice de dónde se lo va a sacar.
   */
  const candidatos = useMemo(() => {
    if (!ficha || ficha.id === null) return [];
    return dispositivos.filter(
      (dispositivo) => dispositivo.activo && dispositivo.area_id !== ficha.id,
    );
  }, [dispositivos, ficha]);

  function abrirNueva() {
    setErrorFicha(null);
    setAAsignar("");
    setFicha({ ...FICHA_VACIA });
  }

  function abrirEdicion(area: AreaConMetricas) {
    setErrorFicha(null);
    setAAsignar("");
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

  /**
   * Borrado definitivo. Es OTRA acción que dar de baja, a propósito: borrar no
   * se puede deshacer, y el servidor vuelve a contar antes de hacerlo.
   */
  function confirmarBorrado() {
    if (!aBorrar) return;
    const objetivo = aBorrar;

    iniciar(async () => {
      const resultado = await eliminarAreaVacia(objetivo.id);
      setABorrar(null);
      setAviso(resultado.ok ? (resultado.mensaje ?? "Listo.") : resultado.error);
      if (resultado.ok) router.refresh();
    });
  }

  /** Asignar y desasignar comparten acción: cambia la misma columna escalar. */
  function moverDispositivo(dispositivoId: number, areaId: number | null) {
    setErrorFicha(null);

    iniciar(async () => {
      const resultado: Resultado = await cambiarAreaDispositivo(
        dispositivoId,
        areaId,
      );

      if (!resultado.ok) {
        setErrorFicha(resultado.error);
        return;
      }

      setAAsignar("");
      setAviso(resultado.mensaje ?? "Listo.");
      router.refresh();
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
        {areas.map((area) => {
          const automatizada = automatizacionDe(area);
          const nodos = dispositivosPorArea.get(area.id) ?? [];
          const huerfanos = !area.activa && nodos.length > 0;

          return (
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
                <>
                  {area.activa ? null : <Chip texto="Baja" />}
                  {huerfanos ? (
                    <Chip texto="Con dispositivos" nivel="ADVERTENCIA" />
                  ) : null}
                </>
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
                  <Dato rotulo="Automatización">
                    {automatizada.length === 0
                      ? "Sin automatización"
                      : automatizada.map(etiquetaCondicion).join(" · ")}
                  </Dato>
                  <Dato rotulo="Dispositivos asignados" ancho>
                    {nodos.length === 0
                      ? "Ninguno"
                      : nodos
                          .map(
                            (nodo) =>
                              `${nodo.codigo} (${textoConexion(nodo.conexion)})`,
                          )
                          .join(" · ")}
                  </Dato>
                  <Dato rotulo="Empleados asignados">
                    {entero(area.empleados)}
                  </Dato>
                  <Dato rotulo="Llamados abiertos">
                    {entero(area.llamados_abiertos)}
                  </Dato>
                  <Dato rotulo="Borrado" ancho>
                    {area.bloqueos === null ? (
                      <span className="text-tenue">
                        No se puede saber qué depende de esta área: falta correr
                        sql/12_borrado_seguro.sql. Sin certeza no se ofrece
                        borrar.
                      </span>
                    ) : area.bloqueos.length === 0 ? (
                      "No le cuelga nada: se puede borrar definitivamente."
                    ) : (
                      <span className="text-tenue">
                        No se puede borrar porque tiene {area.bloqueos.join(", ")}.
                        Dala de baja, o reasigná lo que cuelga primero.
                      </span>
                    )}
                  </Dato>
                </>
              }
              pie={
                <>
                  <button
                    type="button"
                    className="boton-plano"
                    onClick={() => setABajar(area)}
                  >
                    {area.activa ? "Dar de baja" : "Reactivar"}
                  </button>

                  {/* Borrar solo se OFRECE cuando no cuelga nada. La pantalla
                      no es el control: eliminarAreaVacia() vuelve a contar. */}
                  {area.bloqueos !== null && area.bloqueos.length === 0 ? (
                    <button
                      type="button"
                      className="boton-plano"
                      onClick={() => setABorrar(area)}
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
              <div className="titulo-seccion mb-1">Automatización</div>
              <p className="mb-3 text-tenue">
                Las cuatro condiciones generan un llamado siempre. Marcá las que
                además tienen que encender el actuador del nodo. Desmarcar una
                casilla apaga una bomba, nunca apaga una alerta.
              </p>

              <div className="flex flex-col gap-2">
                {CONDICIONES.map((condicion) => {
                  const clave = claveDeCondicion(condicion);

                  return (
                    <label
                      key={condicion}
                      className="flex items-start gap-2"
                      htmlFor={clave}
                    >
                      <input
                        id={clave}
                        type="checkbox"
                        className="mt-1 shrink-0"
                        checked={ficha[clave]}
                        onChange={(e) => editar(clave, e.target.checked)}
                      />
                      <span className="min-w-0">
                        {etiquetaCondicion(condicion)}{" "}
                        <span className="text-tenue">
                          ({limiteDe(ficha, condicion)})
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>

              {!ficha.auto_temp_baja &&
              !ficha.auto_temp_alta &&
              !ficha.auto_hum_baja &&
              !ficha.auto_hum_alta ? (
                <p className="mt-3 text-tenue">
                  Sin ninguna casilla marcada, el actuador de esta área nunca se
                  enciende. Las alertas siguen funcionando igual.
                </p>
              ) : null}
            </div>

            <div className="border-t border-borde pt-3">
              <div className="titulo-seccion mb-1">Dispositivos asignados</div>

              {ficha.id === null ? (
                <p className="text-tenue">
                  Guardá el área primero. Después se le pueden asignar
                  dispositivos desde acá o desde la pantalla de Dispositivos.
                </p>
              ) : (
                <>
                  <p className="mb-3 text-tenue">
                    Los nodos que miden esta área. Estos cambios se aplican en el
                    momento, no al apretar Guardar.
                  </p>

                  {!ficha.activa && asignados.length > 0 ? (
                    <div className="mb-3">
                      <Aviso
                        texto={`El área está dada de baja y todavía tiene ${asignados.length} dispositivo${asignados.length === 1 ? "" : "s"} asignado${asignados.length === 1 ? "" : "s"}. Sus lecturas se siguen guardando, pero no generan llamados y su actuador queda apagado. Dar de baja un área no desasigna nada: si el nodo se mudó, reasignalo.`}
                        nivel="ADVERTENCIA"
                      />
                    </div>
                  ) : null}

                  {asignados.length === 0 ? (
                    <p className="text-tenue">
                      Ningún dispositivo asignado. Sin nodo, esta área no recibe
                      lecturas.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {asignados.map((nodo) => (
                        <div
                          key={nodo.id}
                          className="flex flex-wrap items-center justify-between gap-2 border-t border-borde pt-2"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span>{nodo.codigo}</span>
                              <Chip
                                texto={textoConexion(nodo.conexion)}
                                nivel={
                                  nodo.conexion === "EN_LINEA"
                                    ? "NORMAL"
                                    : nodo.conexion === "SIN_SENAL"
                                      ? "EMERGENCIA"
                                      : "ADVERTENCIA"
                                }
                              />
                              {nodo.naturaleza === "SIMULADO" ? (
                                <Chip texto="Simulado" nivel="ADVERTENCIA" />
                              ) : null}
                              {!nodo.activo ? <Chip texto="Baja" /> : null}
                            </div>
                            <div className="text-tenue">
                              Último contacto {hace(nodo.segundos_sin_reportar)}
                              {nodo.ultimo_contacto_en
                                ? ` · ${fechaHora(nodo.ultimo_contacto_en)}`
                                : ""}
                            </div>
                          </div>

                          <button
                            type="button"
                            className="boton-plano shrink-0"
                            onClick={() => moverDispositivo(nodo.id, null)}
                            disabled={pendiente}
                          >
                            Desasignar
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 border-t border-borde pt-3">
                    <Campo
                      etiqueta="Asignar dispositivo"
                      htmlFor="asignar-dispositivo"
                      ayuda="Un dispositivo tiene un área vigente: asignarlo acá lo saca de la que tenga hoy."
                    >
                      <div className="flex items-center gap-2">
                        <Desplegable
                          id="asignar-dispositivo"
                          valor={aAsignar}
                          placeholder={
                            candidatos.length === 0
                              ? "No hay dispositivos disponibles"
                              : "Elegí un dispositivo"
                          }
                          deshabilitado={candidatos.length === 0 || pendiente}
                          opciones={candidatos.map((nodo) => ({
                            valor: String(nodo.id),
                            etiqueta:
                              nodo.area_id === null
                                ? `${nodo.codigo} — sin área`
                                : `${nodo.codigo} — hoy en ${areasPorId.get(nodo.area_id)?.codigo ?? `área ${nodo.area_id}`}`,
                          }))}
                          alCambiar={setAAsignar}
                        />

                        <button
                          type="button"
                          className="boton shrink-0"
                          disabled={aAsignar === "" || pendiente}
                          onClick={() =>
                            moverDispositivo(Number(aAsignar), ficha.id)
                          }
                        >
                          Asignar
                        </button>
                      </div>
                    </Campo>
                  </div>
                </>
              )}
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
              <p className="mt-2 text-tenue">
                Un área dada de baja sigue guardando lecturas, pero no genera
                llamados y su actuador queda apagado. Sus dispositivos siguen
                asignados: dar de baja un área no desasigna nada.
              </p>
            </div>
          </div>
        </ModalFicha>
      ) : null}

      {aBajar ? (
        <ConfirmarModal
          titulo={aBajar.activa ? "Dar de baja el área" : "Reactivar el área"}
          mensaje={
            aBajar.activa
              ? `El área ${aBajar.codigo} — ${aBajar.nombre} deja de mostrarse en el tablero, de generar alertas y de accionar su actuador.${aBajar.dispositivos > 0 ? ` Sus ${aBajar.dispositivos} dispositivo${aBajar.dispositivos === 1 ? "" : "s"} quedan asignados: no se desasigna nada.` : ""} No se borra ningún dato histórico.`
              : `El área ${aBajar.codigo} — ${aBajar.nombre} vuelve a mostrarse en el tablero, a evaluarse y a accionar su actuador.`
          }
          textoConfirmar={aBajar.activa ? "Dar de baja" : "Reactivar"}
          peligro={aBajar.activa}
          pendiente={pendiente}
          alConfirmar={confirmarCambioDeEstado}
          alCancelar={() => setABajar(null)}
        />
      ) : null}

      {aBorrar ? (
        <ConfirmarModal
          titulo="Eliminar el área"
          mensaje={`El área ${aBorrar.codigo} — ${aBorrar.nombre} se borra de la base y no se puede recuperar. Se ofrece porque no tiene ninguna lectura, ningún llamado, ningún dispositivo, ningún empleado y ningún usuario asociado: no hay historia que perder. Si el área operó alguna vez, dala de baja en vez de borrarla.`}
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
