"use client";

// app/(panel)/movil/gestor.tsx
// Optimizada para 390 px: tarjetas grandes, un solo dato importante por
// renglón y botones de 44 px, el mínimo cómodo para el pulgar.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LARGO_MAXIMO_MOTIVO, TIPOS_LLAMADO } from "@/lib/catalogos";
import type { MotivosPorTipo } from "@/lib/motivos";
import { fechaHora, SIN_DATO } from "@/lib/formato";
import type { Area, Llamado } from "@/lib/tipos";
import {
  atenderLlamado,
  crearLlamado,
  crearMotivo,
} from "../llamados/acciones";
import { Aviso, Campo } from "../componentes/campos";
import { Icono } from "../componentes/iconos";
import { Desplegable } from "../componentes/desplegable";

const MS_SONDEO = 10_000;

type FichaNueva = {
  area_id: number | null;
  tipo: string;
  motivo: string;
  detalle: string;
};

/** "hace 3 min", "hace 2 h", "hace 4 d". */
function haceCuanto(desde: string): string {
  const minutos = Math.max(
    0,
    Math.round((Date.now() - new Date(desde).getTime()) / 60000),
  );

  if (minutos < 1) return "recién";
  if (minutos < 60) return `hace ${minutos} min`;

  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;

  return `hace ${Math.round(horas / 24)} d`;
}

export function GestorMovil({
  llamados,
  areas,
  areasPropias,
  motivos: motivosIniciales,
}: {
  llamados: Llamado[];
  areas: Area[];
  areasPropias: number[];
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
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const fichaAbierta = ficha !== null;

  useEffect(() => {
    const escritorio = window.matchMedia("(min-width: 901px)");
    const salirDeVistaMovil = (evento: MediaQueryListEvent) => {
      if (evento.matches) router.replace("/");
    };

    if (escritorio.matches) router.replace("/");
    escritorio.addEventListener("change", salirDeVistaMovil);
    return () => escritorio.removeEventListener("change", salirDeVistaMovil);
  }, [router]);

  useEffect(() => {
    if (fichaAbierta) return;
    const id = setInterval(() => router.refresh(), MS_SONDEO);
    return () => clearInterval(id);
  }, [fichaAbierta, router]);

  function atender(id: number) {
    iniciar(async () => {
      const resultado = await atenderLlamado(id);
      setAviso(resultado.ok ? (resultado.mensaje ?? "Listo.") : resultado.error);
      if (resultado.ok) router.refresh();
    });
  }

  function abrirNuevo() {
    setError(null);
    setFicha({
      // Arranca en la primera área a cargo, pero se puede cambiar.
      area_id: areasPropias[0] ?? null,
      tipo: "NORMAL",
      motivo: motivosDe("NORMAL")[0] ?? "",
      detalle: "",
    });
    setNuevoMotivo(null);
  }

  function guardar() {
    if (!ficha) return;
    setError(null);

    iniciar(async () => {
      const resultado = await crearLlamado(ficha);
      if (!resultado.ok) {
        setError(resultado.error);
        return;
      }
      setFicha(null);
      setAviso(resultado.mensaje ?? "Llamado creado.");
      router.refresh();
    });
  }

  /** Crea el motivo en el tipo elegido y lo deja seleccionado. */
  function guardarMotivo() {
    if (!ficha || nuevoMotivo === null) return;
    const tipo = ficha.tipo;
    const texto = nuevoMotivo;
    setError(null);

    iniciar(async () => {
      const resultado = await crearMotivo(tipo, texto);
      if (!resultado.ok) {
        setError(resultado.error);
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
    <div className="solo-movil mx-auto flex w-full max-w-[420px] flex-col gap-3">
      <div className="flex items-baseline justify-between border-b border-borde pb-2">
        <h1 className="titulo-modulo">
          <Icono nombre="llamados" tamano={18} />
          Llamados abiertos
        </h1>
        <span className="rotulo">
          {areasPropias.length > 0
            ? `${areasPropias.length} a cargo, primero`
            : "Todas"}
        </span>
      </div>

      {aviso ? <Aviso texto={aviso} nivel="NORMAL" /> : null}
      {error && !fichaAbierta ? <Aviso texto={error} /> : null}

      <button
        type="button"
        className="boton w-full"
        style={{ height: 48 }}
        onClick={abrirNuevo}
      >
        Generar llamado
      </button>

      {ficha ? (
        <section className="panel flex flex-col gap-3 p-3">
          <div className="flex items-center justify-between">
            <span className="rotulo">Nuevo llamado</span>
            <button
              type="button"
              className="boton-plano"
              style={{ height: 32 }}
              onClick={() => setFicha(null)}
            >
              Cancelar
            </button>
          </div>

          {error ? <Aviso texto={error} /> : null}

          <Campo etiqueta="Área" htmlFor="m-area">
            <Desplegable
              id="m-area"
              estilo={{ height: 44 }}
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

          <Campo etiqueta="Tipo" htmlFor="m-tipo">
            <Desplegable
              id="m-tipo"
              estilo={{ height: 44 }}
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
                        motivo: motivosDe(valor)[0] ?? "",
                      }
                    : actual,
                )
              }
            />
          </Campo>

          <Campo etiqueta="Motivo" htmlFor="m-motivo">
            <div className="flex flex-col gap-2">
              <Desplegable
                id="m-motivo"
                estilo={{ height: 44 }}
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
                    className="campo min-w-0 flex-1" style={{ height: 44 }}
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
                    className="boton" style={{ height: 44 }}
                    onClick={guardarMotivo}
                    disabled={pendiente}
                  >
                    Agregar
                  </button>
                  <button
                    type="button"
                    className="boton-plano" style={{ height: 44 }}
                    onClick={() => setNuevoMotivo(null)}
                    disabled={pendiente}
                  >
                    Descartar
                  </button>
                </div>
              )}
            </div>
          </Campo>

          <Campo etiqueta="Detalle" htmlFor="m-detalle">
            <textarea
              id="m-detalle"
              className="campo"
              rows={3}
              value={ficha.detalle}
              placeholder="Qué pasó y qué hace falta."
              onChange={(evento) =>
                setFicha((actual) =>
                  actual ? { ...actual, detalle: evento.target.value } : actual,
                )
              }
            />
          </Campo>

          <button
            type="button"
            className="boton w-full"
            style={{ height: 48 }}
            onClick={guardar}
            disabled={pendiente}
          >
            {pendiente ? "Creando…" : "Crear llamado"}
          </button>
        </section>
      ) : null}

      {llamados.length === 0 ? (
        <section className="panel p-4">
          <p className="text-tenue">
            No hay llamados abiertos. Todo en orden por acá.
          </p>
        </section>
      ) : (
        llamados.map((llamado) => {
          const area = areas.find((item) => item.id === llamado.area_id);
          const grave = llamado.tipo === "EMERGENCIA";

          return (
            <article
              key={llamado.id}
              className="panel p-3"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span
                  className={`text-[13px] font-semibold ${
                    grave ? "text-emergencia" : "text-advertencia"
                  }`}
                >
                  {llamado.tipo}
                </span>
                <span className="rotulo">{haceCuanto(llamado.creado_en)}</span>
              </div>

              <p className="mt-1 text-[15px] leading-tight text-texto">
                {llamado.motivo ?? SIN_DATO}
              </p>

              <p className="mt-1 text-tenue">
                {area ? `${area.codigo} — ${area.nombre}` : SIN_DATO}
              </p>

              {llamado.detalle ? (
                <p className="mt-1.5 text-tenue">{llamado.detalle}</p>
              ) : null}

              <p className="mt-1.5 rotulo">{fechaHora(llamado.creado_en)}</p>

              <button
                type="button"
                className="boton mt-3 w-full"
                style={{ height: 44 }}
                disabled={pendiente}
                onClick={() => atender(llamado.id)}
              >
                Atender
              </button>
            </article>
          );
        })
      )}
    </div>
  );
}
