"use client";

// app/(panel)/avisos/gestor.tsx
// Los avisos push se piden por dispositivo: el permiso lo da el navegador, no
// la cuenta. Por eso la pantalla separa "este dispositivo" del resto: en el
// celular se prende el push y se silencia el grupo de Telegram, en la compu
// se puede hacer al revés, y la elección de una persona no toca la de otra.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fechaHora, SIN_DATO } from "@/lib/formato";
import type { FilaSuscripcion } from "@/lib/push";
import type { Sesion } from "@/lib/tipos";
import { Aviso } from "../componentes/campos";
import { Chip, Dato, FilaDesplegable, Lista } from "../componentes/lista";
import {
  borrarSuscripcion,
  cambiarSuscripcion,
  cambiarTelegram,
  guardarSuscripcion,
  probarPush,
} from "./acciones";

type Soporte = "midiendo" | "si" | "no";

/**
 * La clave VAPID viaja en base64url y pushManager.subscribe espera bytes.
 * El ArrayBuffer se crea a mano: el Uint8Array genérico que devuelve el
 * constructor puede estar respaldado por un SharedArrayBuffer y ahí no
 * encaja en BufferSource.
 */
function aBytes(base64url: string): ArrayBuffer {
  const relleno = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + relleno).replace(/-/g, "+").replace(/_/g, "/");
  const crudo = window.atob(base64);

  const bufer = new ArrayBuffer(crudo.length);
  const salida = new Uint8Array(bufer);
  for (let i = 0; i < crudo.length; i += 1) salida[i] = crudo.charCodeAt(i);
  return bufer;
}

/** Nombre legible del dispositivo, para distinguirlo en la lista. */
function nombreDelNavegador(): string {
  const ua = navigator.userAgent;

  const navegador = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Navegador";

  const sistema = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/.test(ua)
      ? "iPhone o iPad"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "Mac"
          : /Linux/.test(ua)
            ? "Linux"
            : "escritorio";

  return `${navegador} en ${sistema}`;
}

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
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        if (vigente) setSoporte("no");
        return;
      }

      let endpoint: string | null = null;
      try {
        const registro = await navigator.serviceWorker.ready;
        endpoint = (await registro.pushManager.getSubscription())?.endpoint ?? null;
      } catch {
        // El service worker puede no estar listo todavía: el soporte se
        // informa igual y la suscripción se lee la próxima vez.
      }

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

  /** Pide permiso, se suscribe en el navegador y guarda la suscripción. */
  function activarAca() {
    setError(null);
    setAviso(null);

    iniciar(async () => {
      try {
        const respuesta = await Notification.requestPermission();
        setPermiso(respuesta);

        if (respuesta !== "granted") {
          setError(
            "El navegador no dio permiso. Habilitá las notificaciones para este sitio y volvé a intentar.",
          );
          return;
        }

        const registro = await navigator.serviceWorker.ready;
        const existente = await registro.pushManager.getSubscription();
        const suscripcion =
          existente ??
          (await registro.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: aBytes(clavePublica),
          }));

        const plano = suscripcion.toJSON();
        setEndpointLocal(suscripcion.endpoint);

        contar(
          await guardarSuscripcion({
            endpoint: suscripcion.endpoint,
            p256dh: plano.keys?.p256dh ?? "",
            auth: plano.keys?.auth ?? "",
            dispositivo: nombreDelNavegador(),
          }),
        );
      } catch (fallo) {
        setError(
          fallo instanceof Error
            ? `No se pudo activar: ${fallo.message}`
            : "No se pudo activar en este dispositivo.",
        );
      }
    });
  }

  /** Suelta la suscripción del navegador y borra la fila. */
  function quitarAca() {
    setError(null);
    setAviso(null);

    iniciar(async () => {
      try {
        const registro = await navigator.serviceWorker.ready;
        const suscripcion = await registro.pushManager.getSubscription();
        const endpoint = suscripcion?.endpoint ?? endpointLocal;

        await suscripcion?.unsubscribe();
        setEndpointLocal(null);

        if (endpoint) contar(await borrarSuscripcion(endpoint));
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
    iniciar(async () => contar(await cambiarSuscripcion(fila.id, !fila.activa)));
  }

  function quitar(fila: FilaSuscripcion) {
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
          Un llamado nuevo avisa por dos caminos independientes. En un mismo
          teléfono podés tener los dos, uno solo o ninguno.
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
            <Chip texto="Activo" nivel="NORMAL" />
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
                  ? "El navegador tiene bloqueadas las notificaciones para este sitio. Desbloquealas desde el candado de la barra de direcciones y volvé a intentar."
                  : "Activalo para que este dispositivo reciba los llamados nuevos."}
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
                    Desactivar acá
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
                  {pendiente ? "Activando…" : "Activar en este dispositivo"}
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
          vacio="Todavía no activaste los avisos en ningún dispositivo."
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
