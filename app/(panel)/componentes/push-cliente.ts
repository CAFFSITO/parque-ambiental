// app/(panel)/componentes/push-cliente.ts
// Lo que hay que hacer en el navegador para suscribirse al push. Vive acá
// porque lo usan dos lados: el enganche automático del panel y la pantalla de
// Avisos, y tienen que comportarse igual.

/**
 * Marca de "acá no los quiero". La pone la persona al desactivar en este
 * dispositivo y la respeta el enganche automático: sin esto, apagar los
 * avisos duraría hasta la próxima recarga, porque el permiso del navegador
 * sigue concedido y el sistema los volvería a prender.
 */
export const CLAVE_APAGADO = "pab_avisos_apagados";

export function estaApagadoAca(): boolean {
  try {
    return window.localStorage.getItem(CLAVE_APAGADO) === "1";
  } catch {
    // Modo incógnito con el almacenamiento bloqueado: se asume prendido.
    return false;
  }
}

export function marcarApagadoAca(apagado: boolean): void {
  try {
    if (apagado) window.localStorage.setItem(CLAVE_APAGADO, "1");
    else window.localStorage.removeItem(CLAVE_APAGADO);
  } catch {
    // Sin almacenamiento no se puede recordar: no es motivo para fallar.
  }
}

export function soportaPush(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * La clave VAPID viaja en base64url y pushManager.subscribe espera bytes.
 * El ArrayBuffer se crea a mano: el Uint8Array genérico que devuelve el
 * constructor puede estar respaldado por un SharedArrayBuffer y ahí no encaja
 * en BufferSource.
 */
export function aBytes(base64url: string): ArrayBuffer {
  const relleno = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + relleno).replace(/-/g, "+").replace(/_/g, "/");
  const crudo = window.atob(base64);

  const bufer = new ArrayBuffer(crudo.length);
  const salida = new Uint8Array(bufer);
  for (let i = 0; i < crudo.length; i += 1) salida[i] = crudo.charCodeAt(i);
  return bufer;
}

/**
 * Una clave VAPID válida es un punto P-256 sin comprimir: 65 bytes que
 * arrancan con 0x04. Chequearlo acá evita el críptico "push service error"
 * que devuelve el navegador cuando la clave llegó vacía o cortada.
 */
export function claveValida(clave: string): boolean {
  if (clave.length < 80) return false;
  try {
    const bytes = new Uint8Array(aBytes(clave));
    return bytes.length === 65 && bytes[0] === 4;
  } catch {
    return false;
  }
}

/** Nombre legible del dispositivo, para distinguirlo en la lista. */
export function nombreDelNavegador(): string {
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

export type Suscripcion = {
  endpoint: string;
  p256dh: string;
  auth: string;
  dispositivo: string;
};

export type ResultadoSuscripcion =
  | { ok: true; suscripcion: Suscripcion }
  | { ok: false; error: string };

function aPlano(suscripcion: PushSubscription): Suscripcion {
  const plano = suscripcion.toJSON();
  return {
    endpoint: suscripcion.endpoint,
    p256dh: plano.keys?.p256dh ?? "",
    auth: plano.keys?.auth ?? "",
    dispositivo: nombreDelNavegador(),
  };
}

/**
 * Traduce el error del navegador a algo accionable. "push service error" es
 * lo que devuelve Chrome para media docena de causas distintas y por sí solo
 * no dice nada.
 */
function explicar(fallo: unknown): string {
  const nombre =
    typeof fallo === "object" && fallo !== null && "name" in fallo
      ? String((fallo as { name: unknown }).name)
      : "";
  const mensaje = fallo instanceof Error ? fallo.message : String(fallo);

  if (/push service error|AbortError/i.test(`${nombre} ${mensaje}`)) {
    return (
      "El navegador no pudo registrarse en su servicio de push. " +
      "Suele ser una de tres: el navegador no llega a internet o hay un " +
      "proxy o firewall en el medio; el navegador tiene apagada la mensajería " +
      "push (en Brave, brave://settings/privacy; en Chrome con políticas de " +
      "empresa, puede estar bloqueada); o quedó una suscripción vieja con otra " +
      "clave. Probá recargar con Ctrl+F5 y, si sigue, en otro navegador."
    );
  }

  if (/NotAllowedError/i.test(nombre)) {
    return "El navegador no dio permiso para notificar en este sitio.";
  }

  if (/InvalidStateError/i.test(nombre)) {
    return "Ya había una suscripción distinta en este navegador. Recargá la página y volvé a intentar.";
  }

  return mensaje === "" ? "No se pudo suscribir en este dispositivo." : mensaje;
}

/**
 * Deja este navegador suscripto y devuelve los datos para guardar.
 *
 * `pedirPermiso` en false sirve para el enganche automático: solo continúa si
 * el permiso ya estaba dado, así nunca aparece un cartel sin que la persona
 * haya tocado nada.
 *
 * Si subscribe() falla teniendo una suscripción previa, la suelta y reintenta
 * una vez: es el caso de una suscripción vieja hecha con otra clave VAPID,
 * que el navegador rechaza sin decir por qué.
 */
export async function suscribir(
  clavePublica: string,
  pedirPermiso: boolean,
): Promise<ResultadoSuscripcion> {
  if (!soportaPush()) {
    return { ok: false, error: "Este navegador no admite avisos push." };
  }

  if (!claveValida(clavePublica)) {
    return {
      ok: false,
      error:
        "El servidor no entregó una clave VAPID válida. Revisá NEXT_PUBLIC_VAPID_PUBLIC_KEY y reiniciá el servidor.",
    };
  }

  if (Notification.permission !== "granted") {
    if (!pedirPermiso) return { ok: false, error: "Falta el permiso del navegador." };

    const respuesta = await Notification.requestPermission();
    if (respuesta !== "granted") {
      return {
        ok: false,
        error:
          "El navegador no dio permiso. Habilitá las notificaciones para este sitio y volvé a intentar.",
      };
    }
  }

  try {
    const registro = await navigator.serviceWorker.ready;
    const existente = await registro.pushManager.getSubscription();
    if (existente) return { ok: true, suscripcion: aPlano(existente) };

    const nueva = await registro.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: aBytes(clavePublica),
    });
    return { ok: true, suscripcion: aPlano(nueva) };
  } catch (fallo) {
    try {
      const registro = await navigator.serviceWorker.ready;
      const vieja = await registro.pushManager.getSubscription();
      if (!vieja) return { ok: false, error: explicar(fallo) };

      await vieja.unsubscribe();
      const nueva = await registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: aBytes(clavePublica),
      });
      return { ok: true, suscripcion: aPlano(nueva) };
    } catch {
      return { ok: false, error: explicar(fallo) };
    }
  }
}

/** Suelta la suscripción del navegador. Devuelve el endpoint que tenía. */
export async function desuscribir(): Promise<string | null> {
  if (!soportaPush()) return null;

  const registro = await navigator.serviceWorker.ready;
  const suscripcion = await registro.pushManager.getSubscription();
  if (!suscripcion) return null;

  const endpoint = suscripcion.endpoint;
  await suscripcion.unsubscribe();
  return endpoint;
}

/** Endpoint actual de este navegador, o null si no hay suscripción. */
export async function endpointActual(): Promise<string | null> {
  if (!soportaPush()) return null;

  try {
    const registro = await navigator.serviceWorker.ready;
    return (await registro.pushManager.getSubscription())?.endpoint ?? null;
  } catch {
    return null;
  }
}
