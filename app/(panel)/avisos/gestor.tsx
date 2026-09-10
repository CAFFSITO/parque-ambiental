"use client";

// app/(panel)/avisos/gestor.tsx
// Los avisos vienen prendidos: el panel deja suscripto cada dispositivo desde
// el que se entra (ver avisos-automaticos.tsx). Esta pantalla existe sobre
// todo para lo contrario —apagarlos donde molesten— y para volver a
// prenderlos si uno se arrepiente.
//
// El permiso lo da el navegador, no la cuenta: por eso todo se decide por
// dispositivo. En el celular se puede dejar solo el push y silenciar el grupo
// de Telegram, en la compu al revés, y lo que elige una persona no toca lo de
// las demás.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fechaHora, SIN_DATO } from "@/lib/formato";
import type { FilaSuscripcion } from "@/lib/push";
import type { Sesion } from "@/lib/tipos";
import { Aviso } from "../componentes/campos";
import { Chip, Dato, FilaDesplegable, Lista } from "../componentes/lista";
import {
  desuscribir,
  endpointActual,
  marcarApagadoAca,
  soportaPush,
  suscribir,
} from "../componentes/push-cliente";
import {
  borrarSuscripcion,
  cambiarSuscripcion,
  cambiarTelegram,
  guardarSuscripcion,
  probarPush,
} from "./acciones";

type Soporte = "midiendo" | "si" | "no";

export function GestorAvisos({
  sesion,
  dispositivos,
  telegramActivo,
  clavePublica,
  hayClaves,
  faltaMigracion,
}: {
  sesion: Sesion;
  dispositivos: FilaSuscripcion[];
  telegramActivo: boolean;
  clavePublica: string;
  hayClaves: boolean;
  faltaMigracion: boolean;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();

  const [soporte, setSoporte] = useState<Soporte>("midiendo");
  const [permiso, setPermiso] = useState<NotificationPermission>("default");
  const [endpointLocal, setEndpointLocal] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Qué puede este navegador y si ya está suscripto. En iPhone solo existe
  // PushManager con la app agregada a la pantalla de inicio.
  //
  // Todo se resuelve en una sola pasada asincrónica y recién ahí se toca el
  // estado: medir el navegador es hablar con un sistema externo, y escribir
  // el estado en el cuerpo del efecto encadenaría renders.
  useEffect(() => {
    let vigente = true;

    const medir = async () => {
      if (!soportaPush()) {
        if (vigente) setSoporte("no");
        return;
      }

      const endpoint = await endpointActual();
      if (!vigente) return;

      setSoporte("si");
      setPermiso(Notification.permission);
      setEndpointLocal(endpoint);
    };

    void medir();

    return () => {
      vigente = false;
    };
  }, []);

  const filaLocal =
    endpointLocal === null
      ? null
      : (dispositivos.find((fila) => fila.endpoint === endpointLocal) ?? null);

  const activoAca = filaLocal?.activa === true;

  function contar(resultado: { ok: boolean; mensaje?: string; error?: string }) {
    if (resultado.ok) {
      setError(null);
      setAviso(resultado.mensaje ?? "Listo.");
      router.refresh();
    } else {
      setAviso(null);
      setError(resultado.error ?? "No se pudo completar.");
    }
  }

  /** Vuelve a prender los avisos en este dispositivo. */
  function activarAca() {
    setError(null);
    setAviso(null);

    iniciar(async () => {
      const resultado = await suscribir(clavePublica, true);
      setPermiso(Notification.permission);

      if (!resultado.ok) {
        setAviso(null);
        setError(resultado.error);
        return;
      }

      marcarApagadoAca(false);
      setEndpointLocal(resultado.suscripcion.endpoint);
      contar(await guardarSuscripcion(resultado.suscripcion));
    });
  }

  /** Suelta la suscripción del navegador y borra la fila. */
  function quitarAca() {
    setError(null);
    setAviso(null);

    iniciar(async () => {
      try {
        const endpoint = (await desuscribir()) ?? endpointLocal;

        // Antes que nada la marca: si no, el enganche automático del panel
        // los volvería a prender en la próxima pantalla.
        marcarApagadoAca(true);
        setEndpointLocal(null);

        if (endpoint) contar(await borrarSuscripcion(endpoint));
        else {
          contar({ ok: true, mensaje: "Avisos apagados en este dispositivo." });
        }
      } catch (fallo) {
        setError(
          fallo instanceof Error
            ? `No se pudo desactivar: ${fallo.message}`
            : "No se pudo desactivar en este dispositivo.",
        );
      }
    });
  }

  function alternar(fila: FilaSuscripcion) {
    iniciar(async () => {
      // Apagar el dispositivo desde el que se está mirando también deja la
      // marca local, por lo mismo que quitarAca.
      if (fila.endpoint === endpointLocal) marcarApagadoAca(fila.activa);
      contar(await cambiarSuscripcion(fila.id, !fila.activa));
    });
  }

  function quitar(fila: FilaSuscripcion) {
    if (fila.endpoint === endpointLocal) {
      quitarAca();
      return;
    }
    iniciar(async () => contar(await borrarSuscripcion(fila.endpoint)));
  }

  function probar() {
    iniciar(async () => contar(await probarPush()));
  }

  function alternarTelegram() {
    iniciar(async () => contar(await cambiarTelegram(!telegramActivo)));
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="cabecera-seccion">
          <span className="titulo-seccion">Avisos</span>
        </div>
        <p className="contexto-tablero">
          Un llamado nuevo avisa por dos caminos independientes. Los avisos del
          navegador vienen prendidos en cada dispositivo desde el que entrás;
          acá se apagan donde molesten.
        </p>
      </div>

      {faltaMigracion ? (
        <Aviso texto="Falta correr sql/05_avisos.sql en Supabase: hasta entonces no se pueden guardar los avisos push." />
      ) : null}

      {!hayClaves ? (
        <Aviso
          nivel="ADVERTENCIA"
          texto="El servidor no tiene cargadas las claves VAPID (NEXT_PUBLIC_VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY): los avisos push no salen."
        />
      ) : null}

      {error ? <Aviso texto={error} /> : null}
      {aviso ? <Aviso nivel="NORMAL" texto={aviso} /> : null}

      <section className="panel p-4">
        <div className="cabecera-seccion">
          <span className="titulo-seccion">Push en este dispositivo</span>
          {activoAca ? (
            <Chip texto="Prendido" nivel="NORMAL" />
          ) : (
            <Chip texto="Apagado" />
          )}
        </div>

        {soporte === "no" ? (
          <p className="text-tenue">
            Este navegador no admite avisos push. En iPhone hay que agregar la
            app a la pantalla de inicio y abrirla desde ahí.
          </p>
        ) : (
          <>
            <p className="text-tenue">
              {activoAca
                ? "Este dispositivo recibe un aviso por cada llamado nuevo, aunque el panel esté cerrado."
                : permiso === "denied"
                  ? "El navegador tiene bloqueadas las notificaciones para este sitio. Desbloquealas desde el candado de la barra de direcciones y volvé a prenderlos."
                  : "Los apagaste en este dispositivo. Se pueden volver a prender cuando quieras."}
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              {activoAca ? (
                <>
                  <button
                    type="button"
                    className="boton-plano"
                    disabled={pendiente}
                    onClick={quitarAca}
                  >
                    {pendiente ? "Apagando…" : "Desactivar en este dispositivo"}
                  </button>
                  <button
                    type="button"
                    className="boton-plano"
                    disabled={pendiente}
                    onClick={probar}
                  >
                    Probar
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="boton"
                  disabled={pendiente || soporte !== "si" || !hayClaves}
                  onClick={activarAca}
                >
                  {pendiente ? "Prendiendo…" : "Volver a activar acá"}
                </button>
              )}
            </div>
          </>
        )}
      </section>

      <div>
        <div className="cabecera-seccion">
          <span className="titulo-seccion">Mis dispositivos</span>
          <span className="rotulo">
            {dispositivos.length} registrado
            {dispositivos.length === 1 ? "" : "s"}
          </span>
        </div>

        <Lista
          hayFilas={dispositivos.length > 0}
          vacio="Todavía no se registró ningún dispositivo con avisos."
        >
          {dispositivos.map((fila) => {
            const esteMismo = fila.endpoint === endpointLocal;

            return (
              <FilaDesplegable
                key={fila.id}
                clave={String(fila.id)}
                tenue={!fila.activa}
                accion={
                  <button
                    type="button"
                    className="boton-plano boton-chico"
                    disabled={pendiente}
                    onClick={() => alternar(fila)}
                  >
                    {fila.activa ? "Apagar" : "Prender"}
                  </button>
                }
                titulo={fila.dispositivo ?? "Dispositivo sin nombre"}
                marcas={esteMismo ? <Chip texto="Este" nivel="NORMAL" /> : null}
                resumen={
                  fila.activa
                    ? `Recibe avisos · desde ${fechaHora(fila.creada_en)}`
                    : `Apagado · desde ${fechaHora(fila.creada_en)}`
                }
                detalle={
                  <>
                    <Dato rotulo="Estado" destacado>
                      {fila.activa ? "Recibe avisos" : "Apagado"}
                    </Dato>
                    <Dato rotulo="Activado el">
                      {fechaHora(fila.creada_en)}
                    </Dato>
                    <Dato rotulo="Último aviso">
                      {fila.usada_en ? fechaHora(fila.usada_en) : SIN_DATO}
                    </Dato>
                  </>
                }
                pie={
                  <button
                    type="button"
                    className="boton-plano boton-peligro"
                    disabled={pendiente}
                    onClick={() => quitar(fila)}
                  >
                    Quitar este dispositivo
                  </button>
                }
              />
            );
          })}
        </Lista>
      </div>

      <section className="panel p-4">
        <div className="cabecera-seccion">
          <span className="titulo-seccion">Telegram</span>
          {telegramActivo ? (
            <Chip texto="Activo" nivel="NORMAL" />
          ) : (
            <Chip texto="Apagado" />
          )}
        </div>

        <p className="text-tenue">
          Telegram avisa al grupo del parque, no a un dispositivo: el
          interruptor vale para todo el sistema y lo maneja el administrador. Si
          en tu teléfono querés solo el push, silenciá el grupo desde la app de
          Telegram y dejá el push prendido acá.
        </p>

        {sesion.rol === "ADMINISTRADOR" ? (
          <div className="mt-3">
            <button
              type="button"
              className="boton-plano"
              disabled={pendiente}
              onClick={alternarTelegram}
            >
              {telegramActivo
                ? "Dejar de mandar a Telegram"
                : "Volver a mandar a Telegram"}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
