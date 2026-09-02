"use client";

// app/(panel)/dispositivos/gestor.tsx
// Estado de los nodos + simulador. Con esto la demo funciona aunque no haya
// hardware ni conectividad para el nodo.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { entero, fechaHora, numero, SIN_DATO } from "@/lib/formato";
import type { Area, NivelEstado } from "@/lib/tipos";
import { Aviso, Campo, Etiqueta } from "../componentes/campos";
import { simularLectura } from "./acciones";

const MS_SONDEO = 10_000;

export type FilaDispositivo = {
  dispositivo: string;
  area_id: number | null;
  ultima: string;
  segundos: number;
};

type Simulacion = {
  area: string;
  temperatura: number;
  humedad: number;
  boton: string;
};

function nivelPorSilencio(segundos: number, umbral: number): NivelEstado {
  if (segundos > umbral) return "EMERGENCIA";
  if (segundos > umbral / 2) return "ADVERTENCIA";
  return "NORMAL";
}

/** Nombre de nodo que se le propone al simulador para cada área. */
function nodoDe(codigo: string): string {
  return `NODO-${codigo}-01`;
}

export function GestorDispositivos({
  dispositivos,
  areas,
  umbralSegundos,
}: {
  dispositivos: FilaDispositivo[];
  areas: Area[];
  umbralSegundos: number;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();

  const primerArea = areas[0];

  const [simulacion, setSimulacion] = useState<Simulacion>({
    area: primerArea?.codigo ?? "",
    temperatura: primerArea ? Number(primerArea.temp_max) : 25,
    humedad: primerArea ? Number(primerArea.hum_min) : 60,
    boton: "NINGUNO",
  });

  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => router.refresh(), MS_SONDEO);
    return () => clearInterval(id);
  }, [router]);

  const areaElegida = areas.find((area) => area.codigo === simulacion.area);

  function cambiarArea(codigo: string) {
    const area = areas.find((item) => item.codigo === codigo);
    setSimulacion((actual) => ({
      ...actual,
      area: codigo,
      // Arranca en el centro del rango del área nueva.
      temperatura: area
        ? Math.round(((Number(area.temp_min) + Number(area.temp_max)) / 2) * 10) /
          10
        : actual.temperatura,
      humedad: area
        ? Math.round(((Number(area.hum_min) + Number(area.hum_max)) / 2) * 10) /
          10
        : actual.humedad,
    }));
  }

  function enviar() {
    setError(null);
    setAviso(null);

    iniciar(async () => {
      const resultado = await simularLectura({
        dispositivo: nodoDe(simulacion.area),
        area: simulacion.area,
        temperatura: simulacion.temperatura,
        humedad: simulacion.humedad,
        boton: simulacion.boton,
      });

      if (!resultado.ok) {
        setError(resultado.error);
        return;
      }

      setAviso(resultado.mensaje ?? "Lectura enviada.");
      router.refresh();
    });
  }

  // Anticipo de lo que va a decidir el servidor, para que se vea la relación
  // entre los umbrales y el resultado antes de apretar el botón.
  const fueraDeTemp =
    areaElegida !== undefined &&
    (simulacion.temperatura > Number(areaElegida.temp_max) ||
      simulacion.temperatura < Number(areaElegida.temp_min));

  const fueraDeHum =
    areaElegida !== undefined &&
    (simulacion.humedad > Number(areaElegida.hum_max) ||
      simulacion.humedad < Number(areaElegida.hum_min));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between border-b border-borde pb-2">
        <h1 className="text-[15px] font-semibold text-texto">Dispositivos</h1>
        <span className="rotulo">
          {dispositivos.length} nodos · sin señal a los {umbralSegundos} s
        </span>
      </div>

      <section className="panel overflow-x-auto">
        <div className="border-b border-borde px-3 py-2">
          <span className="rotulo">Último reporte de cada nodo</span>
        </div>
        <table className="tabla">
          <thead>
            <tr>
              <th>Estado</th>
              <th>Dispositivo</th>
              <th>Área</th>
              <th>Última lectura</th>
              <th className="col-num">Hace (s)</th>
            </tr>
          </thead>
          <tbody>
            {dispositivos.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-tenue">
                  Ningún nodo reportó en las últimas 24 horas.
                </td>
              </tr>
            ) : (
              dispositivos.map((nodo) => {
                const area = areas.find((item) => item.id === nodo.area_id);
                const nivel = nivelPorSilencio(nodo.segundos, umbralSegundos);

                return (
                  <tr key={nodo.dispositivo}>
                    <td>
                      <Etiqueta
                        texto={
                          nivel === "EMERGENCIA" ? "Sin señal" : "Reportando"
                        }
                        nivel={nivel}
                      />
                    </td>
                    <td className="text-texto">{nodo.dispositivo}</td>
                    <td className="text-tenue">
                      {area ? `${area.codigo} — ${area.nombre}` : SIN_DATO}
                    </td>
                    <td>{fechaHora(nodo.ultima)}</td>
                    <td
                      className={`col-num ${
                        nivel === "EMERGENCIA" ? "text-emergencia" : ""
                      }`}
                    >
                      {entero(nodo.segundos)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <div className="border-b border-borde px-3 py-2">
          <span className="rotulo">Simulador</span>
        </div>

        <div className="flex flex-col gap-3 p-3">
          <p className="text-tenue">
            Envía una lectura real a <code>/api/ingest</code> con la clave del
            dispositivo. Sirve para demostrar el sistema completo sin nodo
            físico.
          </p>

          {error ? <Aviso texto={error} /> : null}
          {aviso ? <Aviso texto={aviso} nivel="NORMAL" /> : null}

          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Área" htmlFor="s-area">
              <select
                id="s-area"
                className="campo"
                value={simulacion.area}
                onChange={(e) => cambiarArea(e.target.value)}
              >
                {areas.map((area) => (
                  <option key={area.id} value={area.codigo}>
                    {area.codigo} — {area.nombre}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo etiqueta="Dispositivo" htmlFor="s-nodo">
              <input
                id="s-nodo"
                className="campo"
                readOnly
                value={nodoDe(simulacion.area)}
              />
            </Campo>
          </div>

          <Campo
            etiqueta={`Temperatura: ${numero(simulacion.temperatura)} °C`}
            htmlFor="s-temp"
            ayuda={
              areaElegida
                ? `Rango del área: ${numero(Number(areaElegida.temp_min), 0)} a ${numero(Number(areaElegida.temp_max), 0)} °C`
                : undefined
            }
          >
            <input
              id="s-temp"
              type="range"
              min={-10}
              max={60}
              step={0.5}
              className="w-full"
              value={simulacion.temperatura}
              onChange={(e) =>
                setSimulacion((actual) => ({
                  ...actual,
                  temperatura: Number(e.target.value),
                }))
              }
            />
          </Campo>

          <Campo
            etiqueta={`Humedad: ${numero(simulacion.humedad)} %`}
            htmlFor="s-hum"
            ayuda={
              areaElegida
                ? `Rango del área: ${numero(Number(areaElegida.hum_min), 0)} a ${numero(Number(areaElegida.hum_max), 0)} %`
                : undefined
            }
          >
            <input
              id="s-hum"
              type="range"
              min={0}
              max={100}
              step={0.5}
              className="w-full"
              value={simulacion.humedad}
              onChange={(e) =>
                setSimulacion((actual) => ({
                  ...actual,
                  humedad: Number(e.target.value),
                }))
              }
            />
          </Campo>

          <Campo
            etiqueta="Botón del nodo"
            htmlFor="s-boton"
            ayuda="Simula el pulsador físico del ESP32."
          >
            <select
              id="s-boton"
              className="campo"
              value={simulacion.boton}
              onChange={(e) =>
                setSimulacion((actual) => ({
                  ...actual,
                  boton: e.target.value,
                }))
              }
            >
              <option value="NINGUNO">NINGUNO</option>
              <option value="NORMAL">NORMAL — solicitud de asistencia</option>
              <option value="EMERGENCIA">
                EMERGENCIA — botón de emergencia
              </option>
            </select>
          </Campo>

          <div className="flex items-center justify-between border-t border-borde pt-3">
            <span className="rotulo">
              {fueraDeTemp || fueraDeHum
                ? `Fuera de rango: ${[
                    fueraDeTemp ? "temperatura" : null,
                    fueraDeHum ? "humedad" : null,
                  ]
                    .filter(Boolean)
                    .join(" y ")} · el servidor va a generar llamado`
                : "Dentro de rango · sin llamado, salvo que uses el botón"}
            </span>

            <button
              type="button"
              className="boton"
              onClick={enviar}
              disabled={pendiente || areas.length === 0}
            >
              {pendiente ? "Enviando…" : "Enviar lectura"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
