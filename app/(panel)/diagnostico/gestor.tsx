"use client";

// app/(panel)/diagnostico/gestor.tsx
// Simulador de nodo. Arma una lectura y la manda a /api/ingest por HTTP, con
// una credencial real de un dispositivo simulado, y muestra sin adornos qué
// respondió el servidor.
//
// Nada de esta pantalla inventa identificadores. La lista de dispositivos sale
// de la tabla dispositivos filtrada por naturaleza, y lo que viaja al servidor
// es el id de la fila elegida, no una cadena de texto armada acá. La versión
// anterior de este simulador construía el nombre del nodo con
// `NODO-${codigo}-01`, que para el área INV-N daba exactamente NODO-INV-N-01,
// el identificador del hardware. Ese mecanismo no existe más.

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fechaHora, hace, numero, SIN_DATO } from "@/lib/formato";
import type { UltimaLectura } from "@/lib/dispositivos";
import type { Area, DispositivoConEstado, EstadoConexion } from "@/lib/tipos";
import { Aviso, Campo } from "../componentes/campos";
import { Desplegable } from "../componentes/desplegable";
import { Icono } from "../componentes/iconos";
import { Chip, Dato } from "../componentes/lista";
import { simularLectura, type ResultadoSimulacion } from "./acciones";

export type FilaSimulado = DispositivoConEstado & {
  ultima: UltimaLectura | null;
};

type Simulacion = {
  temperatura: number;
  humedad: number;
  /** El DHT del nodo manda null cuando falla. Se puede reproducir. */
  sinTemperatura: boolean;
  sinHumedad: boolean;
  boton: string;
};

const SIMULACION_BASE: Simulacion = {
  temperatura: 25,
  humedad: 60,
  sinTemperatura: false,
  sinHumedad: false,
  boton: "NINGUNO",
};

function textoConexion(estado: EstadoConexion): string {
  if (estado === "EN_LINEA") return "En línea";
  if (estado === "SIN_SENAL") return "Sin señal";
  return "Nunca reportó";
}

/** Punto medio del rango del área, que es de donde conviene arrancar. */
function medio(minimo: number, maximo: number): number {
  return Math.round(((Number(minimo) + Number(maximo)) / 2) * 10) / 10;
}

export function GestorDiagnostico({
  simulados,
  areas,
  umbralSegundos,
  minutosCredencial,
  fisicos,
}: {
  simulados: FilaSimulado[];
  areas: Area[];
  umbralSegundos: number;
  minutosCredencial: number;
  fisicos: number;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();

  const areasPorId = useMemo(
    () => new Map(areas.map((area) => [area.id, area])),
    [areas],
  );

  const [elegidoId, setElegidoId] = useState<string>(
    simulados[0] ? String(simulados[0].id) : "",
  );

  const elegido = simulados.find(
    (dispositivo) => String(dispositivo.id) === elegidoId,
  );
  const area = elegido?.area_id != null ? areasPorId.get(elegido.area_id) : undefined;

  const [simulacion, setSimulacion] = useState<Simulacion>(() => {
    const primera = simulados[0];
    const suArea =
      primera?.area_id != null ? areasPorId.get(primera.area_id) : undefined;
    if (!suArea) return { ...SIMULACION_BASE };
    return {
      ...SIMULACION_BASE,
      temperatura: medio(suArea.temp_min, suArea.temp_max),
      humedad: medio(suArea.hum_min, suArea.hum_max),
    };
  });

  const [resultado, setResultado] = useState<ResultadoSimulacion | null>(null);

  function cambiarDispositivo(valor: string) {
    setElegidoId(valor);
    setResultado(null);

    const nuevo = simulados.find(
      (dispositivo) => String(dispositivo.id) === valor,
    );
    const suArea =
      nuevo?.area_id != null ? areasPorId.get(nuevo.area_id) : undefined;
    if (!suArea) return;

    setSimulacion((actual) => ({
      ...actual,
      temperatura: medio(suArea.temp_min, suArea.temp_max),
      humedad: medio(suArea.hum_min, suArea.hum_max),
    }));
  }

  function enviar() {
    if (!elegido) return;
    setResultado(null);

    iniciar(async () => {
      const respuesta = await simularLectura({
        dispositivoId: elegido.id,
        temperatura: simulacion.sinTemperatura ? null : simulacion.temperatura,
        humedad: simulacion.sinHumedad ? null : simulacion.humedad,
        boton: simulacion.boton,
      });

      setResultado(respuesta);
      if (respuesta.ok) router.refresh();
    });
  }

  const fueraDeTemp =
    area !== undefined &&
    !simulacion.sinTemperatura &&
    (simulacion.temperatura > Number(area.temp_max) ||
      simulacion.temperatura < Number(area.temp_min));

  const fueraDeHum =
    area !== undefined &&
    !simulacion.sinHumedad &&
    (simulacion.humedad > Number(area.hum_max) ||
      simulacion.humedad < Number(area.hum_min));

  const nadaQueMandar =
    simulacion.sinTemperatura &&
    simulacion.sinHumedad &&
    simulacion.boton === "NINGUNO";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-borde pb-2">
        <h1 className="titulo-modulo min-w-0">
          <Icono nombre="diagnostico" tamano={18} />
          Diagnóstico
        </h1>
        <span className="rotulo ml-auto whitespace-nowrap">
          {simulados.length} simulados · {fisicos} físicos, fuera de alcance
        </span>
      </div>

      <section className="panel">
        <div className="flex flex-col gap-2 p-3">
          <p>
            Esta pantalla manda una lectura a <code>/api/ingest</code> por HTTP,
            con una credencial real de un dispositivo <strong>simulado</strong>.
            No escribe en la base por atajo: pasa por la misma autenticación, la
            misma resolución de área, los mismos umbrales y el mismo antirrebote
            que atraviesa el nodo del invernadero.
          </p>
          <p className="text-tenue">
            Solo se pueden simular dispositivos con naturaleza SIMULADO. Los
            físicos ni siquiera aparecen en el desplegable, y si alguien
            invocara la acción con el identificador de uno, el servidor la
            rechaza: una medición inventada no puede quedar atribuida a un
            aparato que mide de verdad. La credencial que usa el simulador es
            propia del dispositivo simulado, dura {minutosCredencial} minutos y
            no es la clave del nodo físico.
          </p>
        </div>
      </section>

      {simulados.length === 0 ? (
        <section className="panel">
          <p className="lista-vacia">
            No hay ningún dispositivo con naturaleza SIMULADO. Creá uno en{" "}
            <Link href="/dispositivos" className="underline">
              Dispositivos
            </Link>{" "}
            —con naturaleza <strong>Simulado</strong> y un área asignada— y
            volvé acá.
          </p>
        </section>
      ) : (
        <>
          <section className="panel">
            <div className="border-b border-borde px-3 py-2">
              <span className="rotulo">Lectura a enviar</span>
            </div>

            <div className="flex flex-col gap-3 p-3">
              <Campo
                etiqueta="Dispositivo simulado"
                htmlFor="s-dispositivo"
                ayuda="La lectura se atribuye a este dispositivo y a ningún otro: lo determina su credencial, no el cuerpo de la petición."
              >
                <Desplegable
                  id="s-dispositivo"
                  valor={elegidoId}
                  opciones={simulados.map((dispositivo) => {
                    const suArea =
                      dispositivo.area_id != null
                        ? areasPorId.get(dispositivo.area_id)
                        : undefined;
                    return {
                      valor: String(dispositivo.id),
                      etiqueta:
                        `${dispositivo.codigo} — ${suArea ? suArea.codigo : "sin área"}` +
                        `${dispositivo.activo ? "" : " (baja)"}`,
                    };
                  })}
                  alCambiar={cambiarDispositivo}
                />
              </Campo>

              {elegido ? (
                <div className="fila-detalle">
                  <Dato rotulo="Naturaleza" destacado>
                    <span className="inline-flex items-center gap-2">
                      Simulado — no corresponde a ningún aparato
                      <Chip texto="Simulado" nivel="ADVERTENCIA" />
                    </span>
                  </Dato>
                  <Dato rotulo="Nombre">{elegido.nombre}</Dato>
                  <Dato rotulo="Área asignada">
                    {area
                      ? `${area.codigo} — ${area.nombre}${area.activa ? "" : " (baja)"}`
                      : "Sin área"}
                  </Dato>
                  <Dato rotulo="Estado">
                    {elegido.activo ? "Activo" : "Dado de baja"}
                  </Dato>
                  <Dato rotulo="Conexión">
                    {textoConexion(elegido.conexion)}
                    <span className="text-tenue">
                      {" "}
                      ({hace(elegido.segundos_sin_reportar)} · umbral{" "}
                      {umbralSegundos} s)
                    </span>
                  </Dato>
                  <Dato rotulo="Última lectura">
                    {elegido.ultima === null
                      ? SIN_DATO
                      : `${numero(elegido.ultima.temperatura)} °C · ${numero(elegido.ultima.humedad)} % — ${fechaHora(elegido.ultima.tomada_en)}`}
                  </Dato>
                </div>
              ) : null}

              {elegido && !elegido.activo ? (
                <Aviso
                  texto="Este dispositivo está dado de baja: /api/ingest no lo autentica y la lectura no se guardaría. Reactivalo desde Dispositivos."
                  nivel="ADVERTENCIA"
                />
              ) : null}

              {elegido && !area ? (
                <Aviso
                  texto="Este dispositivo no tiene área asignada: la lectura se va a guardar con área nula, no se evalúan umbrales, no se generan llamados y el actuador queda apagado. Asignale un área desde Dispositivos para que la simulación muestre el circuito completo."
                  nivel="ADVERTENCIA"
                />
              ) : null}

              <Campo
                etiqueta={`Temperatura: ${simulacion.sinTemperatura ? "sin dato" : `${numero(simulacion.temperatura)} °C`}`}
                htmlFor="s-temp"
                ayuda={
                  area
                    ? `Rango del área: ${numero(Number(area.temp_min), 0)} a ${numero(Number(area.temp_max), 0)} °C`
                    : "Sin área no hay rango contra el cual comparar."
                }
              >
                <input
                  id="s-temp"
                  type="range"
                  min={-10}
                  max={60}
                  step={0.5}
                  className="w-full"
                  disabled={simulacion.sinTemperatura}
                  value={simulacion.temperatura}
                  onChange={(e) =>
                    setSimulacion((actual) => ({
                      ...actual,
                      temperatura: Number(e.target.value),
                    }))
                  }
                />
              </Campo>

              <label className="flex items-center gap-2" htmlFor="s-sin-temp">
                <input
                  id="s-sin-temp"
                  type="checkbox"
                  checked={simulacion.sinTemperatura}
                  onChange={(e) =>
                    setSimulacion((actual) => ({
                      ...actual,
                      sinTemperatura: e.target.checked,
                    }))
                  }
                />
                <span>
                  Sin dato de temperatura
                  <span className="text-tenue">
                    {" "}
                    — es lo que manda el nodo cuando el sensor falla
                  </span>
                </span>
              </label>

              <Campo
                etiqueta={`Humedad: ${simulacion.sinHumedad ? "sin dato" : `${numero(simulacion.humedad)} %`}`}
                htmlFor="s-hum"
                ayuda={
                  area
                    ? `Rango del área: ${numero(Number(area.hum_min), 0)} a ${numero(Number(area.hum_max), 0)} %`
                    : "Sin área no hay rango contra el cual comparar."
                }
              >
                <input
                  id="s-hum"
                  type="range"
                  min={0}
                  max={100}
                  step={0.5}
                  className="w-full"
                  disabled={simulacion.sinHumedad}
                  value={simulacion.humedad}
                  onChange={(e) =>
                    setSimulacion((actual) => ({
                      ...actual,
                      humedad: Number(e.target.value),
                    }))
                  }
                />
              </Campo>

              <label className="flex items-center gap-2" htmlFor="s-sin-hum">
                <input
                  id="s-sin-hum"
                  type="checkbox"
                  checked={simulacion.sinHumedad}
                  onChange={(e) =>
                    setSimulacion((actual) => ({
                      ...actual,
                      sinHumedad: e.target.checked,
                    }))
                  }
                />
                <span>
                  Sin dato de humedad
                  <span className="text-tenue">
                    {" "}
                    — es lo que manda el nodo cuando el sensor falla
                  </span>
                </span>
              </label>

              <Campo
                etiqueta="Botón del nodo"
                htmlFor="s-boton"
                ayuda="Simula el pulsador físico del ESP32."
              >
                <Desplegable
                  id="s-boton"
                  valor={simulacion.boton}
                  opciones={[
                    { valor: "NINGUNO", etiqueta: "NINGUNO" },
                    {
                      valor: "NORMAL",
                      etiqueta: "NORMAL — solicitud de asistencia",
                    },
                    {
                      valor: "EMERGENCIA",
                      etiqueta: "EMERGENCIA — botón de emergencia",
                    },
                  ]}
                  alCambiar={(valor) =>
                    setSimulacion((actual) => ({ ...actual, boton: valor }))
                  }
                />
              </Campo>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-borde pt-3">
                <span className="rotulo">
                  {nadaQueMandar
                    ? "Sin magnitudes y sin botón no hay nada que simular"
                    : fueraDeTemp || fueraDeHum
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
                  disabled={pendiente || !elegido || nadaQueMandar}
                >
                  {pendiente ? "Enviando…" : "Enviar lectura"}
                </button>
              </div>
            </div>
          </section>

          {resultado ? (
            <ResultadoSimulacionPanel resultado={resultado} />
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * Lo que respondió el servidor, mostrado tal cual llegó.
 *
 * El punto de este bloque es que quien mira entienda qué acaba de pasar y qué
 * NO pasó: el navegador está viendo una decisión, no un efecto físico.
 */
function ResultadoSimulacionPanel({
  resultado,
}: {
  resultado: ResultadoSimulacion;
}) {
  const respuesta = resultado.ok ? resultado.respuesta : resultado.respuesta;
  const llamados = respuesta?.llamados ?? [];
  const avisos = respuesta?.avisos ?? [];

  return (
    <section className="panel">
      <div className="flex flex-wrap items-center gap-2 border-b border-borde px-3 py-2">
        <span className="rotulo">Respuesta del servidor</span>
        {resultado.estado !== undefined ? (
          <Chip
            texto={`HTTP ${resultado.estado}`}
            nivel={resultado.ok ? "NORMAL" : "EMERGENCIA"}
          />
        ) : null}
      </div>

      <div className="flex flex-col gap-3 p-3">
        {!resultado.ok ? <Aviso texto={resultado.error} /> : null}

        {resultado.llamado ? (
          <div>
            <div className="titulo-seccion mb-1">Petición generada</div>
            <pre className="overflow-x-auto rounded-pab bg-panel-alto px-2 py-1.5 text-tenue whitespace-pre-wrap break-all">
              {`${resultado.llamado.metodo} ${resultado.llamado.url}\n` +
                Object.entries(resultado.llamado.cabeceras)
                  .map(([nombre, valor]) => `${nombre}: ${valor}`)
                  .join("\n") +
                `\n\n${resultado.llamado.cuerpo}`}
            </pre>
            <p className="mt-1 text-tenue">
              La clave va enmascarada a propósito: se muestra el prefijo, que es
              para lo que existe. El secreto no sale del servidor.
            </p>
          </div>
        ) : null}

        {resultado.ok ? (
          <>
            <div className="fila-detalle">
              <Dato rotulo="Relé" destacado>
                {resultado.respuesta.rele ? "ENCENDIDO" : "apagado"}
              </Dato>
              <Dato rotulo="Alarma" destacado>
                {resultado.respuesta.alarma ? "ACTIVA" : "inactiva"}
              </Dato>
              <Dato rotulo="Área resuelta">
                {resultado.respuesta.area ?? "Sin área"}
              </Dato>
              <Dato rotulo="Dispositivo atribuido">
                {resultado.respuesta.dispositivo ?? SIN_DATO}
              </Dato>
            </div>

            <Aviso
              texto={
                "Lo que ves acá es la DECISIÓN del servidor, no un efecto físico. " +
                "Esta pantalla no acciona ningún relé ni hace sonar ninguna sirena: " +
                "el relé lo acciona el ESP32 cuando recibe esta misma respuesta en " +
                "su próximo reporte, leyendo los campos rele y alarma. Con un nodo " +
                "simulado no hay ningún aparato del otro lado que la reciba."
              }
              nivel="NORMAL"
            />

            <div>
              <div className="titulo-seccion mb-1">
                Llamados generados ({llamados.length})
              </div>
              {llamados.length === 0 ? (
                <p className="text-tenue">
                  Ninguno. La lectura entró dentro de rango, o el área no evalúa
                  umbrales.
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  {llamados.map((llamado, indice) => (
                    <div
                      key={`${llamado.motivo}-${indice}`}
                      className="flex flex-wrap items-center gap-2 border-t border-borde pt-1"
                    >
                      <Chip
                        texto={llamado.tipo}
                        nivel={
                          llamado.tipo === "EMERGENCIA" ? "EMERGENCIA" : "ADVERTENCIA"
                        }
                      />
                      <span>{llamado.motivo}</span>
                      <span className="text-tenue">({llamado.resultado})</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-1 text-tenue">
                <code>creado</code> es un llamado nuevo;{" "}
                <code>actualizado</code> es el antirrebote agrupando con uno que
                ya estaba abierto para la misma área y el mismo motivo. Se ven
                enteros en{" "}
                <Link href="/llamados" className="underline">
                  Llamados
                </Link>
                .
              </p>
            </div>
          </>
        ) : null}

        {avisos.length > 0 ? (
          <div>
            <div className="titulo-seccion mb-1">Avisos del servidor</div>
            <ul className="flex flex-col gap-1">
              {avisos.map((aviso, indice) => (
                <li key={indice} className="text-tenue">
                  · {aviso}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
