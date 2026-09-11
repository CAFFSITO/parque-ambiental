"use client";

// app/(panel)/dispositivos/gestor.tsx
// Administración de la flota de nodos. Densidad de tablero: la fila cerrada
// dice código, área, estado y último contacto; abierta muestra la ficha
// completa y las acciones.
//
// Nada de acá inventa datos: todo llega de la tabla dispositivos y de lo que
// esos dispositivos escribieron. No hay ningún código de área ni de nodo
// escrito a mano en este archivo.
//
// El simulador ya no está en esta pantalla: vive en /diagnostico, se autentica
// con una credencial del dispositivo SIMULADO que simula y no puede escribir
// bajo la identidad de un nodo físico. Ver documents/contexto/80-simulador.md.

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { entero, fechaHora, hace, numero, SIN_DATO } from "@/lib/formato";
import type { TramoDeArea, UltimaLectura } from "@/lib/dispositivos";
import type {
  Area,
  CredencialPublica,
  DispositivoConEstado,
  EstadoConexion,
  Resultado,
} from "@/lib/tipos";
import { Aviso, Campo } from "../componentes/campos";
import { Desplegable } from "../componentes/desplegable";
import { Icono } from "../componentes/iconos";
import { Chip, Dato, FilaDesplegable, Lista } from "../componentes/lista";
import { ConfirmarModal, Modal, ModalFicha } from "../componentes/modal";
import {
  cambiarActivoDispositivo,
  cambiarAreaDispositivo,
  crearDispositivoNuevo,
  eliminarDispositivoSinLecturas,
  emitirCredencial,
  guardarDispositivo,
  revocarCredencialDispositivo,
  rotarCredencialDispositivo,
  type EntradaFichaDispositivo,
} from "./acciones";

const MS_SONDEO = 10_000;

/** Ventana de gracia que se ofrece al rotar la credencial de un nodo físico. */
const GRACIA_HORAS = 48;

export type FilaDispositivo = DispositivoConEstado & {
  credenciales: CredencialPublica[];
  /** Ids de las credenciales que hoy verifican. Lo resuelve el servidor. */
  vigentes: number[];
  ultima: UltimaLectura | null;
  historial: TramoDeArea[];
  /** null = no se pudo saber, y entonces no se ofrece borrar. */
  lecturas_totales: number | null;
};

type Ficha = EntradaFichaDispositivo & { id: number | null; codigoOriginal: string };

const FICHA_VACIA: Ficha = {
  id: null,
  codigoOriginal: "",
  codigo: "",
  nombre: "",
  modelo: "",
  area_id: null,
  naturaleza: "FISICO",
  reporta_temperatura: true,
  reporta_humedad: true,
  reporta_boton: true,
  acciona_rele: true,
  acciona_alarma: true,
  observaciones: "",
};

function aFicha(dispositivo: FilaDispositivo): Ficha {
  return {
    id: dispositivo.id,
    codigoOriginal: dispositivo.codigo,
    codigo: dispositivo.codigo,
    nombre: dispositivo.nombre,
    modelo: dispositivo.modelo ?? "",
    area_id: dispositivo.area_id,
    naturaleza: dispositivo.naturaleza,
    reporta_temperatura: dispositivo.reporta_temperatura,
    reporta_humedad: dispositivo.reporta_humedad,
    reporta_boton: dispositivo.reporta_boton,
    acciona_rele: dispositivo.acciona_rele,
    acciona_alarma: dispositivo.acciona_alarma,
    observaciones: dispositivo.observaciones ?? "",
  };
}

function textoConexion(estado: EstadoConexion): string {
  if (estado === "EN_LINEA") return "En línea";
  if (estado === "SIN_SENAL") return "Sin señal";
  return "Nunca reportó";
}

function nivelDeFila(
  dispositivo: FilaDispositivo,
): "NORMAL" | "ADVERTENCIA" | "EMERGENCIA" | "NINGUNO" {
  if (!dispositivo.activo) return "NINGUNO";
  if (dispositivo.conexion === "SIN_SENAL") return "EMERGENCIA";
  if (dispositivo.conexion === "NUNCA_REPORTO") return "ADVERTENCIA";
  return "NORMAL";
}

function capacidadesDe(dispositivo: FilaDispositivo): string {
  const reporta = [
    dispositivo.reporta_temperatura ? "temperatura" : null,
    dispositivo.reporta_humedad ? "humedad" : null,
    dispositivo.reporta_boton ? "botón" : null,
  ].filter(Boolean);

  const acciona = [
    dispositivo.acciona_rele ? "relé" : null,
    dispositivo.acciona_alarma ? "alarma" : null,
  ].filter(Boolean);

  const partes: string[] = [];
  partes.push(reporta.length ? `Reporta ${reporta.join(", ")}` : "No reporta nada");
  partes.push(acciona.length ? `acciona ${acciona.join(" y ")}` : "no acciona nada");
  return partes.join(" · ");
}

function textoCredencial(dispositivo: FilaDispositivo): string {
  if (dispositivo.credenciales.length === 0) {
    return "Sin credencial: no puede autenticarse";
  }
  if (dispositivo.vigentes.length === 0) {
    return `${dispositivo.credenciales.length} credencial${dispositivo.credenciales.length === 1 ? "" : "es"}, ninguna vigente`;
  }
  return `${dispositivo.vigentes.length} vigente${dispositivo.vigentes.length === 1 ? "" : "s"} de ${dispositivo.credenciales.length}`;
}

type Confirmacion = {
  titulo: string;
  mensaje: string;
  textoConfirmar: string;
  peligro: boolean;
  ejecutar: () => Promise<Resultado>;
};

export function GestorDispositivos({
  dispositivos,
  areas,
  umbralSegundos,
  historialDisponible,
}: {
  dispositivos: FilaDispositivo[];
  areas: Area[];
  umbralSegundos: number;
  historialDisponible: boolean;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();

  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [errorFicha, setErrorFicha] = useState<string | null>(null);

  const [asignando, setAsignando] = useState<FilaDispositivo | null>(null);
  const [areaElegidaId, setAreaElegidaId] = useState<string>("");

  const [credenciales, setCredenciales] = useState<FilaDispositivo | null>(null);
  const [secreto, setSecreto] = useState<{ codigo: string; valor: string } | null>(
    null,
  );

  const [confirmacion, setConfirmacion] = useState<Confirmacion | null>(null);

  const areasPorId = useMemo(
    () => new Map(areas.map((area) => [area.id, area])),
    [areas],
  );

  useEffect(() => {
    const id = setInterval(() => router.refresh(), MS_SONDEO);
    return () => clearInterval(id);
  }, [router]);

  function nombreDeArea(id: number | null): string {
    if (id === null) return "Sin área";
    const area = areasPorId.get(id);
    return area ? `${area.codigo} — ${area.nombre}` : `Área ${id} (no existe)`;
  }

  function correr(accion: () => Promise<Resultado>) {
    setError(null);
    setAviso(null);

    iniciar(async () => {
      const resultado = await accion();
      if (!resultado.ok) {
        setError(resultado.error);
        return;
      }
      setAviso(resultado.mensaje ?? "Listo.");
      router.refresh();
    });
  }

  function guardarFicha() {
    if (!ficha) return;
    setErrorFicha(null);

    const { id, codigoOriginal: _codigoOriginal, ...entrada } = ficha;
    void _codigoOriginal;

    iniciar(async () => {
      const resultado =
        id === null
          ? await crearDispositivoNuevo(entrada)
          : await guardarDispositivo(id, entrada);

      if (!resultado.ok) {
        setErrorFicha(resultado.error);
        return;
      }

      setFicha(null);
      setAviso(resultado.mensaje ?? "Listo.");
      router.refresh();
    });
  }

  function confirmarAsignacion() {
    if (!asignando) return;
    const destino = areaElegidaId === "" ? null : Number(areaElegidaId);
    const objetivo = asignando;

    setAsignando(null);
    correr(() => cambiarAreaDispositivo(objetivo.id, destino));
  }

  function pedirCredencial(dispositivo: FilaDispositivo, rotar: boolean) {
    setError(null);
    setAviso(null);

    iniciar(async () => {
      const resultado = rotar
        ? await rotarCredencialDispositivo(
            dispositivo.id,
            dispositivo.codigo,
            dispositivo.naturaleza === "FISICO" ? GRACIA_HORAS * 3600 : 0,
          )
        : await emitirCredencial(dispositivo.id, dispositivo.codigo);

      if (!resultado.ok) {
        setError(resultado.error);
        return;
      }

      setCredenciales(null);
      setSecreto({ codigo: resultado.codigo, valor: resultado.secreto });
      setAviso(resultado.mensaje);
      router.refresh();
    });
  }

  const fisicos = dispositivos.filter((d) => d.naturaleza === "FISICO").length;
  const enLinea = dispositivos.filter(
    (d) => d.activo && d.conexion === "EN_LINEA",
  ).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-borde pb-2">
        <h1 className="titulo-modulo min-w-0">
          <Icono nombre="dispositivos" tamano={18} />
          Dispositivos
        </h1>
        <div className="ml-auto flex min-w-0 items-center gap-3">
          <span className="rotulo whitespace-nowrap">
            {dispositivos.length} nodos · {fisicos} físicos · {enLinea} en línea
            · sin señal a los {umbralSegundos} s
          </span>
          {/* El simulador se fue a su propia pantalla. El enlace queda acá
              porque es desde donde se llega naturalmente: se crea el
              dispositivo simulado, y desde ahí se lo ejercita. */}
          <Link href="/diagnostico" className="boton-plano">
            Simulador
          </Link>
          <button
            type="button"
            className="boton"
            onClick={() => {
              setErrorFicha(null);
              setFicha({ ...FICHA_VACIA });
            }}
          >
            Crear dispositivo
          </button>
        </div>
      </div>

      {error ? (
        <div className="flex items-start justify-between gap-3">
          <Aviso texto={error} />
          <button
            type="button"
            className="boton-plano shrink-0"
            onClick={() => setError(null)}
          >
            Descartar
          </button>
        </div>
      ) : null}

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
        hayFilas={dispositivos.length > 0}
        vacio="No hay dispositivos registrados. Creá el primero con el botón de arriba."
      >
        {dispositivos.map((dispositivo) => {
          const sinCredencial = dispositivo.vigentes.length === 0;
          const puedeBorrarse = dispositivo.lecturas_totales === 0;

          return (
            <FilaDesplegable
              key={dispositivo.id}
              clave={String(dispositivo.id)}
              nivel={nivelDeFila(dispositivo)}
              tenue={!dispositivo.activo}
              accion={
                <button
                  type="button"
                  className="boton boton-chico"
                  onClick={() => {
                    setErrorFicha(null);
                    setFicha(aFicha(dispositivo));
                  }}
                >
                  Editar
                </button>
              }
              titulo={dispositivo.codigo}
              marcas={
                <>
                  {dispositivo.naturaleza === "SIMULADO" ? (
                    <Chip texto="Simulado" nivel="ADVERTENCIA" />
                  ) : null}
                  {!dispositivo.activo ? <Chip texto="Baja" /> : null}
                  {dispositivo.activo && dispositivo.conexion === "SIN_SENAL" ? (
                    <Chip texto="Sin señal" nivel="EMERGENCIA" />
                  ) : null}
                  {dispositivo.activo && sinCredencial ? (
                    <Chip texto="Sin credencial" nivel="ADVERTENCIA" />
                  ) : null}
                </>
              }
              resumen={`${dispositivo.area_id === null ? "Sin área" : nombreDeArea(dispositivo.area_id)} · ${textoConexion(dispositivo.conexion)} · ${hace(dispositivo.segundos_sin_reportar)}`}
              detalle={
                <>
                  <Dato rotulo="Naturaleza" destacado>
                    {dispositivo.naturaleza === "FISICO"
                      ? "Físico — hardware real"
                      : "Simulado — no corresponde a ningún aparato"}
                  </Dato>
                  <Dato rotulo="Nombre">{dispositivo.nombre}</Dato>
                  <Dato rotulo="Modelo">{dispositivo.modelo ?? SIN_DATO}</Dato>
                  <Dato rotulo="Estado">
                    {dispositivo.activo ? "Activo" : "Dado de baja"}
                  </Dato>
                  <Dato rotulo="Conexión">
                    {textoConexion(dispositivo.conexion)}
                    {dispositivo.segundos_sin_reportar !== null ? (
                      <span className="text-tenue">
                        {" "}
                        ({entero(dispositivo.segundos_sin_reportar)} s · umbral{" "}
                        {umbralSegundos} s)
                      </span>
                    ) : null}
                  </Dato>
                  <Dato rotulo="Área asignada">
                    {nombreDeArea(dispositivo.area_id)}
                  </Dato>
                  <Dato rotulo="Último contacto">
                    {fechaHora(dispositivo.ultimo_contacto_en)}
                  </Dato>
                  <Dato rotulo="Última lectura">
                    {dispositivo.ultima === null
                      ? SIN_DATO
                      : `${numero(dispositivo.ultima.temperatura)} °C · ${numero(dispositivo.ultima.humedad)} % — ${fechaHora(dispositivo.ultima.tomada_en)}`}
                  </Dato>
                  <Dato rotulo="Capacidades" ancho>
                    {capacidadesDe(dispositivo)}
                  </Dato>
                  <Dato rotulo="Credenciales">
                    {textoCredencial(dispositivo)}
                  </Dato>
                  <Dato rotulo="Lecturas registradas">
                    {dispositivo.lecturas_totales === null
                      ? SIN_DATO
                      : entero(dispositivo.lecturas_totales)}
                  </Dato>
                  <Dato rotulo="Alta">{fechaHora(dispositivo.creado_en)}</Dato>
                  <Dato rotulo="Historial de asignación" ancho>
                    {!historialDisponible ? (
                      <span className="text-tenue">
                        Falta correr sql/10_dispositivos_consultas.sql.
                      </span>
                    ) : dispositivo.historial.length === 0 ? (
                      "Todavía no escribió en ninguna área."
                    ) : (
                      <span className="flex flex-col gap-0.5">
                        {dispositivo.historial.map((tramo) => (
                          <span key={`${tramo.area_id}-${tramo.primera}`}>
                            {nombreDeArea(tramo.area_id)} ·{" "}
                            {entero(tramo.lecturas)} lecturas ·{" "}
                            {fechaHora(tramo.primera)} → {fechaHora(tramo.ultima)}
                          </span>
                        ))}
                      </span>
                    )}
                  </Dato>
                  {dispositivo.observaciones ? (
                    <Dato rotulo="Observaciones" ancho>
                      {dispositivo.observaciones}
                    </Dato>
                  ) : null}
                </>
              }
              pie={
                <>
                  <button
                    type="button"
                    className="boton-plano"
                    onClick={() => {
                      setAsignando(dispositivo);
                      setAreaElegidaId(
                        dispositivo.area_id === null
                          ? ""
                          : String(dispositivo.area_id),
                      );
                    }}
                  >
                    {dispositivo.area_id === null ? "Asignar área" : "Cambiar área"}
                  </button>

                  <button
                    type="button"
                    className="boton-plano"
                    onClick={() => setCredenciales(dispositivo)}
                  >
                    Credenciales
                  </button>

                  <button
                    type="button"
                    className="boton-plano"
                    onClick={() =>
                      setConfirmacion({
                        titulo: dispositivo.activo
                          ? "Dar de baja el dispositivo"
                          : "Reactivar el dispositivo",
                        mensaje: dispositivo.activo
                          ? `${dispositivo.codigo} deja de ser aceptado: sus datos dejan de guardarse y su relé queda apagado. No se borra ningún dato histórico.`
                          : `${dispositivo.codigo} vuelve a poder autenticarse y a recibir órdenes.`,
                        textoConfirmar: dispositivo.activo
                          ? "Dar de baja"
                          : "Reactivar",
                        peligro: dispositivo.activo,
                        ejecutar: () =>
                          cambiarActivoDispositivo(
                            dispositivo.id,
                            !dispositivo.activo,
                          ),
                      })
                    }
                  >
                    {dispositivo.activo ? "Dar de baja" : "Reactivar"}
                  </button>

                  {puedeBorrarse ? (
                    <button
                      type="button"
                      className="boton-plano"
                      onClick={() =>
                        setConfirmacion({
                          titulo: "Eliminar el dispositivo",
                          mensaje: `${dispositivo.codigo} no tiene ninguna lectura registrada, así que se puede borrar sin perder historia. Esta acción no se puede deshacer y también borra sus credenciales.`,
                          textoConfirmar: "Eliminar",
                          peligro: true,
                          ejecutar: () =>
                            eliminarDispositivoSinLecturas(dispositivo.id),
                        })
                      }
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

      {/* ---------------- Ficha de alta y edición ---------------- */}
      {ficha ? (
        <ModalFicha
          titulo={ficha.id === null ? "Nuevo dispositivo" : "Editar dispositivo"}
          subtitulo={ficha.id === null ? undefined : ficha.codigoOriginal}
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
                onClick={guardarFicha}
                disabled={pendiente}
              >
                {pendiente ? "Guardando…" : "Guardar"}
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            {errorFicha ? <Aviso texto={errorFicha} /> : null}

            <Campo
              etiqueta="Código"
              htmlFor="d-codigo"
              ayuda={
                ficha.id === null
                  ? "Tiene que ser exactamente el que está grabado en el firmware del nodo. No se puede cambiar después."
                  : "El código no se puede cambiar: está grabado en el firmware y es lo que ata cada lectura a este dispositivo. Cambiarlo rompería ese vínculo."
              }
            >
              <input
                id="d-codigo"
                className="campo"
                value={ficha.codigo}
                maxLength={64}
                readOnly={ficha.id !== null}
                disabled={ficha.id !== null}
                onChange={(e) =>
                  setFicha((actual) =>
                    actual ? { ...actual, codigo: e.target.value } : actual,
                  )
                }
              />
            </Campo>

            <Campo etiqueta="Nombre" htmlFor="d-nombre">
              <input
                id="d-nombre"
                className="campo"
                value={ficha.nombre}
                onChange={(e) =>
                  setFicha((actual) =>
                    actual ? { ...actual, nombre: e.target.value } : actual,
                  )
                }
              />
            </Campo>

            <div className="grid grid-cols-2 gap-3">
              <Campo etiqueta="Modelo" htmlFor="d-modelo">
                <input
                  id="d-modelo"
                  className="campo"
                  value={ficha.modelo}
                  onChange={(e) =>
                    setFicha((actual) =>
                      actual ? { ...actual, modelo: e.target.value } : actual,
                    )
                  }
                />
              </Campo>

              <Campo
                etiqueta="Naturaleza"
                htmlFor="d-naturaleza"
                ayuda={
                  ficha.id === null
                    ? "No se puede cambiar después."
                    : "Fija desde el alta."
                }
              >
                {ficha.id === null ? (
                  <Desplegable
                    id="d-naturaleza"
                    valor={ficha.naturaleza}
                    opciones={[
                      { valor: "FISICO", etiqueta: "Físico — hardware real" },
                      { valor: "SIMULADO", etiqueta: "Simulado — no es un aparato" },
                    ]}
                    alCambiar={(valor) =>
                      setFicha((actual) =>
                        actual ? { ...actual, naturaleza: valor } : actual,
                      )
                    }
                  />
                ) : (
                  <input
                    id="d-naturaleza"
                    className="campo"
                    readOnly
                    disabled
                    value={
                      ficha.naturaleza === "FISICO" ? "Físico" : "Simulado"
                    }
                  />
                )}
              </Campo>
            </div>

            {ficha.id === null ? (
              <Campo
                etiqueta="Área"
                htmlFor="d-area"
                ayuda="Se puede dejar sin área y asignarla después."
              >
                <Desplegable
                  id="d-area"
                  valor={ficha.area_id === null ? "" : String(ficha.area_id)}
                  opciones={[
                    { valor: "", etiqueta: "Sin área" },
                    ...areas.map((area) => ({
                      valor: String(area.id),
                      etiqueta: `${area.codigo} — ${area.nombre}${area.activa ? "" : " (baja)"}`,
                    })),
                  ]}
                  alCambiar={(valor) =>
                    setFicha((actual) =>
                      actual
                        ? { ...actual, area_id: valor === "" ? null : Number(valor) }
                        : actual,
                    )
                  }
                />
              </Campo>
            ) : null}

            <div className="border-t border-borde pt-3">
              <div className="titulo-seccion mb-1">Capacidades</div>
              <p className="mb-3 text-tenue">
                Qué mide y qué acciona este nodo. Desmarcar un actuador hace que
                el servidor le mande siempre la orden apagada.
              </p>

              <div className="flex flex-col gap-2">
                {(
                  [
                    ["reporta_temperatura", "Reporta temperatura"],
                    ["reporta_humedad", "Reporta humedad"],
                    ["reporta_boton", "Tiene botón físico"],
                    ["acciona_rele", "Acciona relé"],
                    ["acciona_alarma", "Acciona alarma"],
                  ] as const
                ).map(([clave, etiqueta]) => (
                  <label key={clave} className="flex items-center gap-2" htmlFor={`d-${clave}`}>
                    <input
                      id={`d-${clave}`}
                      type="checkbox"
                      checked={ficha[clave]}
                      onChange={(e) =>
                        setFicha((actual) =>
                          actual ? { ...actual, [clave]: e.target.checked } : actual,
                        )
                      }
                    />
                    <span>{etiqueta}</span>
                  </label>
                ))}
              </div>
            </div>

            <Campo etiqueta="Observaciones" htmlFor="d-obs">
              <textarea
                id="d-obs"
                className="campo"
                rows={3}
                value={ficha.observaciones}
                onChange={(e) =>
                  setFicha((actual) =>
                    actual ? { ...actual, observaciones: e.target.value } : actual,
                  )
                }
              />
            </Campo>
          </div>
        </ModalFicha>
      ) : null}

      {/* ---------------- Asignación de área ---------------- */}
      {asignando ? (
        <ModalFicha
          titulo="Área del dispositivo"
          subtitulo={asignando.codigo}
          alCerrar={() => setAsignando(null)}
          ancho={460}
          pie={
            <>
              <button
                type="button"
                className="boton-plano"
                onClick={() => setAsignando(null)}
                disabled={pendiente}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="boton"
                onClick={confirmarAsignacion}
                disabled={pendiente}
              >
                {pendiente ? "Aplicando…" : "Guardar"}
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <p className="text-tenue">
              El área decide los umbrales y la automatización de este nodo.
              Cambiarla no toca ninguna lectura ni ningún llamado ya guardado:
              esas filas conservan el área que tenían cuando se grabaron.
            </p>

            <Campo etiqueta="Área" htmlFor="a-area">
              <Desplegable
                id="a-area"
                valor={areaElegidaId}
                opciones={[
                  { valor: "", etiqueta: "Sin área" },
                  ...areas.map((area) => ({
                    valor: String(area.id),
                    etiqueta: `${area.codigo} — ${area.nombre}${area.activa ? "" : " (baja)"}`,
                  })),
                ]}
                alCambiar={setAreaElegidaId}
              />
            </Campo>

            {areaElegidaId === "" ? (
              <Aviso
                texto="Sin área, el nodo se sigue autenticando y sus lecturas se guardan, pero no se evalúan umbrales, no se generan llamados y el relé queda apagado."
                nivel="ADVERTENCIA"
              />
            ) : null}
          </div>
        </ModalFicha>
      ) : null}

      {/* ---------------- Credenciales ---------------- */}
      {credenciales ? (
        <Modal
          titulo={`Credenciales de ${credenciales.codigo}`}
          alCerrar={() => setCredenciales(null)}
          ancho={620}
        >
          <div className="flex flex-col gap-3">
            <p className="text-tenue">
              El secreto se muestra una sola vez, cuando se emite. Acá solo se
              ven el prefijo, el estado y las fechas: el hash no sale nunca del
              servidor.
            </p>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="boton"
                onClick={() => pedirCredencial(credenciales, false)}
                disabled={pendiente}
              >
                {pendiente ? "Emitiendo…" : "Emitir credencial"}
              </button>

              {credenciales.credenciales.length > 0 ? (
                <button
                  type="button"
                  className="boton-plano"
                  onClick={() => pedirCredencial(credenciales, true)}
                  disabled={pendiente}
                >
                  Rotar
                  {credenciales.naturaleza === "FISICO"
                    ? ` (gracia de ${GRACIA_HORAS} h)`
                    : ""}
                </button>
              ) : null}
            </div>

            {credenciales.naturaleza === "FISICO" ? (
              <p className="text-tenue">
                Al rotar un nodo físico, la credencial anterior sigue sirviendo{" "}
                {GRACIA_HORAS} horas. Es el tiempo para ir a reflashear el
                firmware: sin esa ventana el nodo queda sin autenticar en el acto.
              </p>
            ) : null}

            {credenciales.credenciales.length === 0 ? (
              <p className="lista-vacia">
                Este dispositivo no tiene ninguna credencial y no puede
                autenticarse.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {credenciales.credenciales.map((credencial) => {
                  const vigente = credenciales.vigentes.includes(credencial.id);

                  return (
                    <div
                      key={credencial.id}
                      className="flex flex-wrap items-center justify-between gap-2 border-t border-borde pt-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span>{credencial.prefijo ?? "sin prefijo"}</span>
                          <Chip
                            texto={credencial.estado}
                            nivel={
                              vigente
                                ? "NORMAL"
                                : credencial.estado === "REVOCADA"
                                  ? "EMERGENCIA"
                                  : "ADVERTENCIA"
                            }
                          />
                          <Chip texto={credencial.algoritmo} />
                          {credencial.origen === "LEGADO" ? (
                            <Chip texto="Heredada" nivel="ADVERTENCIA" />
                          ) : null}
                        </div>
                        <div className="text-tenue">
                          Creada {fechaHora(credencial.creada_en)}
                          {credencial.creada_por
                            ? ` por ${credencial.creada_por}`
                            : ""}
                          {" · "}
                          Último uso {fechaHora(credencial.usada_en)}
                          {credencial.expira_en
                            ? ` · Vence ${fechaHora(credencial.expira_en)}`
                            : ""}
                          {credencial.revocada_en
                            ? ` · Revocada ${fechaHora(credencial.revocada_en)}`
                            : ""}
                        </div>
                      </div>

                      {credencial.estado !== "REVOCADA" ? (
                        <button
                          type="button"
                          className="boton-plano shrink-0"
                          onClick={() => {
                            const dispositivo = credenciales;
                            setCredenciales(null);
                            setConfirmacion({
                              titulo: "Revocar la credencial",
                              mensaje: `La credencial deja de servir en el acto. ${dispositivo.codigo} no va a poder enviar más datos con ella, y su relé se apaga solo en menos de un minuto. La credencial no se borra: queda registrada.`,
                              textoConfirmar: "Revocar",
                              peligro: true,
                              ejecutar: () =>
                                revocarCredencialDispositivo(
                                  credencial.id,
                                  "Revocada desde la pantalla de Dispositivos.",
                                ),
                            });
                          }}
                        >
                          Revocar
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Modal>
      ) : null}

      {/* ---------------- Secreto, una sola vez ---------------- */}
      {secreto ? (
        <Modal
          titulo="Credencial nueva"
          alCerrar={() => setSecreto(null)}
          ancho={620}
        >
          <div className="flex flex-col gap-3">
            <Aviso
              texto="Este secreto se muestra UNA sola vez. No se guarda en la base y no se puede volver a consultar. Copialo ahora."
              nivel="ADVERTENCIA"
            />

            <Campo
              etiqueta={`Secreto de ${secreto.codigo}`}
              htmlFor="c-secreto"
              ayuda="Cargalo en el dispositivo antes de cerrar esta ventana."
            >
              <input
                id="c-secreto"
                className="campo"
                readOnly
                value={secreto.valor}
                onFocus={(e) => e.currentTarget.select()}
              />
            </Campo>

            <div className="flex justify-end border-t border-borde pt-3">
              <button
                type="button"
                className="boton"
                onClick={() => setSecreto(null)}
              >
                Ya lo copié
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* ---------------- Confirmaciones ---------------- */}
      {confirmacion ? (
        <ConfirmarModal
          titulo={confirmacion.titulo}
          mensaje={confirmacion.mensaje}
          textoConfirmar={confirmacion.textoConfirmar}
          peligro={confirmacion.peligro}
          pendiente={pendiente}
          alConfirmar={() => {
            const accion = confirmacion.ejecutar;
            setConfirmacion(null);
            correr(accion);
          }}
          alCancelar={() => setConfirmacion(null)}
        />
      ) : null}
    </div>
  );
}
