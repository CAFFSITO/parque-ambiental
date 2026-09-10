// lib/registro.ts
// Log estructurado de la ingesta. SOLO servidor.
//
// POR QUÉ UNA LÍNEA JSON Y NO TEXTO SUELTO
//
// Vercel captura stdout y, cuando la línea es JSON válido, la indexa por
// campos: se puede filtrar por `evento`, por `dispositivo` o por `modo` sin
// escribir expresiones regulares sobre prosa. Los `console.warn` sueltos que
// había antes servían para leer una request a mano; no sirven para responder
// "¿cuántas peticiones entraron por el fallback global en la última hora?",
// que es justamente la compuerta que decide si el fallback se puede apagar
// (12-contrato-ingest-objetivo.md §8.4).
//
// QUÉ NO SE ESCRIBE ACÁ, NUNCA
//
//   * La cabecera `x-device-key`, entera o en fragmentos.
//   * El `secreto_hash` de ninguna credencial.
//   * El prefijo de la credencial. Existe para reconocer un secreto filtrado;
//     ponerlo en un log lo convierte en lo que vino a detectar.
//   * Contraseñas, tokens de sesión y cualquier variable de entorno.
//
// La identidad que se registra es el CÓDIGO del dispositivo, que es público:
// está grabado en el firmware, se ve en la pantalla de Dispositivos y viaja en
// el cuerpo de cada petición.
//
// El id de la credencial (un entero) sí se registra: no revela el secreto y es
// lo que permite auditar cuál de varias credenciales de un mismo aparato se
// está usando durante una rotación.

import "server-only";

/** Cómo terminó la autenticación de la petición. */
export type ResultadoAutenticacion =
  | "CREDENCIAL_PROPIA"
  | "CLAVE_GLOBAL"
  | "RECHAZADO"
  | "DISPOSITIVO_INACTIVO"
  | "DISPOSITIVO_NO_REGISTRADO"
  | "SIN_CLAVE"
  | "CUERPO_INVALIDO";

/**
 * Con qué entró.
 *
 * `compatibilidad` es la señal que hay que vigilar antes de apagar el fallback
 * global: mientras aparezca, hay algún aparato que todavía no tiene credencial
 * propia.
 */
export type ModoAutenticacion = "credencial" | "compatibilidad" | "ninguno";

export type EventoIngesta = {
  /** Código declarado en el cuerpo. Puede no coincidir con el resuelto. */
  declarado: string | null;
  /** Código del dispositivo al que el servidor atribuyó la lectura. */
  dispositivo: string | null;
  resultado: ResultadoAutenticacion;
  modo: ModoAutenticacion;
  /** Id de la credencial que verificó. Nunca el secreto ni su prefijo. */
  credencial_id: number | null;
  /** Código del área resuelta desde dispositivos.area_id. */
  area: string | null;
  /** Código de área que declaró el cuerpo, si declaró alguno. */
  area_declarada: string | null;
  /** true si el cuerpo declaró un área distinta de la asignada. */
  discrepancia_area: boolean;
  /** true si el cuerpo declaró un código distinto del dueño de la credencial. */
  discrepancia_dispositivo: boolean;
  rele: boolean | null;
  alarma: boolean | null;
  /** Condiciones que encendieron el actuador, si alguna. */
  motivos_rele: string[];
  temperatura: number | null;
  humedad: number | null;
  boton: string | null;
  /** Cuántos llamados se crearon o refrescaron en esta petición. */
  llamados: number;
  estado_http: number;
  /** Milisegundos que tardó el handler. El firmware corta a los 6000. */
  ms: number;
};

/** Valores neutros, para que quien registre solo complete lo que sabe. */
const VACIO: EventoIngesta = {
  declarado: null,
  dispositivo: null,
  resultado: "RECHAZADO",
  modo: "ninguno",
  credencial_id: null,
  area: null,
  area_declarada: null,
  discrepancia_area: false,
  discrepancia_dispositivo: false,
  rele: null,
  alarma: null,
  motivos_rele: [],
  temperatura: null,
  humedad: null,
  boton: null,
  llamados: 0,
  estado_http: 500,
  ms: 0,
};

/**
 * Emite UNA línea JSON por petición de /api/ingest.
 *
 * Nunca lanza: un fallo del log no puede voltear una lectura que ya se guardó
 * ni demorar la respuesta al nodo, que corta a los 6 segundos.
 *
 * El nivel se elige por el código de respuesta, no por el contenido: 5xx va a
 * `console.error`, 4xx a `console.warn`, el resto a `console.log`. Así las
 * alertas de la plataforma se pueden atar al nivel sin releer el JSON.
 */
export function registrarIngesta(evento: Partial<EventoIngesta>): void {
  try {
    const completo: EventoIngesta = { ...VACIO, ...evento };
    const linea = JSON.stringify({
      evento: "ingest",
      momento: new Date().toISOString(),
      ...completo,
    });

    if (completo.estado_http >= 500) console.error(linea);
    else if (completo.estado_http >= 400) console.warn(linea);
    else console.log(linea);
  } catch {
    // Si ni siquiera se pudo serializar, se pierde el log. No se propaga.
  }
}
