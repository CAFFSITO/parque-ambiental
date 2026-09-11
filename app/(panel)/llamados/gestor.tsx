"use client";

// app/(panel)/llamados/gestor.tsx
// Lista operativa con filtros en la URL y sondeo cada 10 segundos.
// Sin websockets ni Realtime: router.refresh() vuelve a correr el componente
// de servidor con los mismos filtros y no se rompe en serverless.
//
// Cada llamado es una fila compacta: primero el botón Atender, después lo
// mínimo para decidir. El resto de la ficha aparece al desplegarla.
//
// El área no restringe a nadie: se puede crear y atender en cualquiera. Las
// áreas a cargo (que pueden ser varias) solo ordenan —el servidor manda sus
// llamados arriba— y se marcan con un chip para que se note por qué están ahí.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ESTADOS_LLAMADO,
  etiquetaEstado,
  LARGO_MAXIMO_MOTIVO,
  ORIGENES_LLAMADO,
  TIPOS_LLAMADO,
} from "@/lib/catalogos";
import type { MotivosPorTipo } from "@/lib/motivos";
import { fechaHora, SIN_DATO } from "@/lib/formato";
import type { Area, Llamado, Sesion } from "@/lib/tipos";
import { Aviso, Campo } from "../componentes/campos";
import { Desplegable } from "../componentes/desplegable";
import { Icono } from "../componentes/iconos";
import { CampoFecha } from "../componentes/fecha";
import { Chip, Dato, FilaDesplegable, Lista } from "../componentes/lista";
import { ModalFicha } from "../componentes/modal";
import {
  atenderLlamado,
  cancelarAtencion,
  crearLlamado,
  crearMotivo,
} from "./acciones";

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
  areasPropias,
  sesion,
  filtros,
  truncado,
  motivos: motivosIniciales,
}: {
  llamados: Llamado[];
  areas: Area[];
  areasPropias: number[];
  sesion: Sesion;
  filtros: Filtros;
  truncado: boolean;
  /** Motivos de carga manual, separados por tipo. Ver lib/motivos.ts. */
  motivos: MotivosPorTipo;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();

  // Los motivos arrancan con lo que trajo el servidor y se actualizan en el
  // acto cuando alguien crea uno, sin esperar al sondeo.
  const [motivos, setMotivos] = useState<MotivosPorTipo>(motivosIniciales);
  /** null = el campo de motivo nuevo está cerrado. */
  const [nuevoMotivo, setNuevoMotivo] = useState<string | null>(null);

  /** Solo los motivos del tipo elegido: NORMAL no ofrece los de emergencia. */
  function motivosDe(tipo: string): string[] {
    return tipo === "EMERGENCIA" ? motivos.EMERGENCIA : motivos.NORMAL;
  }

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

  function cancelar(id: number) {
    iniciar(async () => {
      const resultado = await cancelarAtencion(id);
      setAviso(resultado.ok ? (resultado.mensaje ?? "Listo.") : resultado.error);
      if (resultado.ok) router.refresh();
    });
  }

  function abrirNuevo() {
    setErrorFicha(null);
    setFicha({
      // Arranca en la primera área a cargo porque es la apuesta más probable,
      // pero se puede cambiar por cualquier otra.
      area_id: areasPropias[0] ?? null,
      tipo: "NORMAL",
      motivo: motivosDe("NORMAL")[0] ?? "",
      detalle: "",
    });
    setNuevoMotivo(null);
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

  /** Crea el motivo en el tipo elegido y lo deja seleccionado. */
  function guardarMotivo() {
    if (!ficha || nuevoMotivo === null) return;
    const tipo = ficha.tipo;
    const texto = nuevoMotivo;
    setErrorFicha(null);

    iniciar(async () => {
      const resultado = await crearMotivo(tipo, texto);
      if (!resultado.ok) {
        setErrorFicha(resultado.error);
        return;
      }
      setMotivos(resultado.motivos);
      setFicha((actual) =>
        actual ? { ...actual, motivo: resultado.motivo } : actual,
      );
      setNuevoMotivo(null);
    });
  }

  const mias = new Set(areasPropias);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between border-b border-borde pb-2">
        <h1 className="titulo-modulo">
          <Icono nombre="llamados" tamano={18} />
          Llamados
        </h1>
        <div className="flex items-center gap-3">
          {areasPropias.length > 0 ? (
            <span className="rotulo">
              {areasPropias.length} área
              {areasPropias.length === 1 ? "" : "s"} a cargo
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
                  etiqueta: etiquetaEstado(estado),
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
                <>
                  {llamado.area_id !== null && mias.has(llamado.area_id) ? (
                    <Chip texto="A cargo" />
                  ) : null}
                  {llamado.tipo === "EMERGENCIA" ? (
                    <Chip
                      texto="Emergencia"
                      nivel={atendido ? "NINGUNO" : "EMERGENCIA"}
                    />
                  ) : null}
                </>
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
                  <Dato rotulo="Estado">{etiquetaEstado(llamado.estado)}</Dato>
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
                atendido ? (
                  <button
                    type="button"
                    className="boton-plano"
                    disabled={pendiente}
                    onClick={() => cancelar(llamado.id)}
                  >
                    {pendiente ? "Cancelando…" : "Cancelar el atendido"}
                  </button>
                ) : null
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
          cerrarEnCabecera={false}
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

            <Campo
              etiqueta="Área"
              htmlFor="n-area"
              ayuda="Cualquier área del parque, no solo las que tenés a cargo."
            >
              <Desplegable
                id="n-area"
                valor={ficha.area_id === null ? "" : String(ficha.area_id)}
                opciones={[
                  { valor: "", etiqueta: "Elegí un área" },
                  ...areas.map((area) => ({
                    valor: String(area.id),
                    etiqueta: mias.has(area.id)
                      ? `${area.codigo} — ${area.nombre} (a cargo)`
                      : `${area.codigo} — ${area.nombre}`,
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
            </Campo>

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
                    actual
                      ? {
                          ...actual,
                          tipo: valor,
                          // Al cambiar de tipo, el motivo pasa al primero del
                          // tipo nuevo: uno de emergencia no puede quedar
                          // colgado en un llamado normal.
                          motivo: motivosDe(valor)[0] ?? "",
                        }
                      : actual,
                  )
                }
              />
            </Campo>

            <Campo etiqueta="Motivo" htmlFor="n-motivo">
              <div className="flex flex-col gap-2">
                <Desplegable
                  id="n-motivo"
                  valor={ficha.motivo}
                  opciones={motivosDe(ficha.tipo).map((motivo) => ({
                    valor: motivo,
                    etiqueta: motivo,
                  }))}
                  alCambiar={(valor) =>
                    setFicha((actual) =>
                      actual ? { ...actual, motivo: valor } : actual,
                    )
                  }
                />

                {nuevoMotivo === null ? (
                  <button
                    type="button"
                    className="boton-plano self-start"
                    onClick={() => setNuevoMotivo("")}
                    disabled={pendiente}
                  >
                    + Crear motivo {ficha.tipo === "EMERGENCIA" ? "de emergencia" : "normal"}
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <input
                      className="campo min-w-0 flex-1"
                      value={nuevoMotivo}
                      maxLength={LARGO_MAXIMO_MOTIVO}
                      autoFocus
                      aria-label="Motivo nuevo"
                      placeholder={
                        ficha.tipo === "EMERGENCIA"
                          ? "Nuevo motivo de emergencia"
                          : "Nuevo motivo normal"
                      }
                      onChange={(evento) => setNuevoMotivo(evento.target.value)}
                      onKeyDown={(evento) => {
                        if (evento.key === "Enter") {
                          evento.preventDefault();
                          guardarMotivo();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="boton"
                      onClick={guardarMotivo}
                      disabled={pendiente}
                    >
                      Agregar
                    </button>
                    <button
                      type="button"
                      className="boton-plano"
                      onClick={() => setNuevoMotivo(null)}
                      disabled={pendiente}
                    >
                      Descartar
                    </button>
                  </div>
                )}
              </div>
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
