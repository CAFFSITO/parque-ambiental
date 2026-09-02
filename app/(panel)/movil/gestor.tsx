"use client";

// app/(panel)/movil/gestor.tsx
// Optimizada para 390 px: tarjetas grandes, un solo dato importante por
// renglón y botones de 44 px, el mínimo cómodo para el pulgar.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MOTIVOS_MANUALES, TIPOS_LLAMADO } from "@/lib/catalogos";
import { fechaHora, SIN_DATO } from "@/lib/formato";
import type { Area, Llamado, Sesion } from "@/lib/tipos";
import { atenderLlamado, crearLlamado } from "../llamados/acciones";
import { Aviso, Campo } from "../componentes/campos";

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
  sesion,
}: {
  llamados: Llamado[];
  areas: Area[];
  sesion: Sesion;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();

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
      area_id: sesion.rol === "EMPLEADO" ? sesion.area_id : null,
      tipo: "NORMAL",
      motivo: MOTIVOS_MANUALES[0],
      detalle: "",
    });
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

  const areaPropia =
    sesion.area_id === null
      ? undefined
      : areas.find((area) => area.id === sesion.area_id);

  return (
    <div className="solo-movil mx-auto flex w-full max-w-[420px] flex-col gap-3">
      <div className="flex items-baseline justify-between border-b border-borde pb-2">
        <h1 className="text-[15px] font-semibold text-texto">Llamados abiertos</h1>
        <span className="rotulo">
          {sesion.rol === "EMPLEADO"
            ? (areaPropia?.codigo ?? SIN_DATO)
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
            {sesion.rol === "EMPLEADO" ? (
              <input
                id="m-area"
                className="campo"
                readOnly
                style={{ height: 44 }}
                value={
                  areaPropia
                    ? `${areaPropia.codigo} — ${areaPropia.nombre}`
                    : SIN_DATO
                }
              />
            ) : (
              <select
                id="m-area"
                className="campo"
                style={{ height: 44 }}
                value={ficha.area_id === null ? "" : String(ficha.area_id)}
                onChange={(evento) =>
                  setFicha((actual) =>
                    actual
                      ? {
                          ...actual,
                          area_id:
                            evento.target.value === ""
                              ? null
                              : Number(evento.target.value),
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

          <Campo etiqueta="Tipo" htmlFor="m-tipo">
            <select
              id="m-tipo"
              className="campo"
              style={{ height: 44 }}
              value={ficha.tipo}
              onChange={(evento) =>
                setFicha((actual) =>
                  actual ? { ...actual, tipo: evento.target.value } : actual,
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

          <Campo etiqueta="Motivo" htmlFor="m-motivo">
            <select
              id="m-motivo"
              className="campo"
              style={{ height: 44 }}
              value={ficha.motivo}
              onChange={(evento) =>
                setFicha((actual) =>
                  actual ? { ...actual, motivo: evento.target.value } : actual,
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
