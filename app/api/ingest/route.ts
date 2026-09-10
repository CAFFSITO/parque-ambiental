// app/api/ingest/route.ts
// Endpoint del nodo ESP32. Sigue siendo una de las rutas abiertas sin sesión
// (ver RUTAS_PUBLICAS en proxy.ts): se autentica con la cabecera x-device-key.
//
// QUÉ CAMBIÓ RESPECTO DE LA VERSIÓN ANTERIOR
//   1. La clave ya no se compara contra una constante global: identifica una
//      CREDENCIAL, y la credencial identifica un DISPOSITIVO.
//   2. El área sale SIEMPRE de dispositivos.area_id. El campo body.area se
//      sigue aceptando, ya no es obligatorio, y no decide nada: el propio
//      firmware pide esto en su encabezado, donde dice que "area" viaja solo
//      por compatibilidad y que el backend debe ignorarlo para decidir a qué
//      área pertenece el nodo.
//   3. La lectura guarda además dispositivo_id.
//
// QUÉ NO CAMBIÓ, Y NO PUEDE CAMBIAR
//   * La respuesta 200 sigue teniendo `rele` y `alarma` como booleanos en la
//     raíz. El firmware lee exactamente esos dos campos, con
//     `datos["rele"] | false`: si se renombraran, ArduinoJson devolvería false
//     sin error y el relé quedaría apagado para siempre y la sirena muda, con
//     el nodo reportando 200 OK y aparentando salud total.
//   * El cálculo de `rele` es byte por byte el de antes. Separarlo en los
//     cuatro interruptores de automatización de la tabla areas es la etapa
//     siguiente: acá las columnas auto_* se leen pero NO se usan.
//   * El antirrebote de registrarLlamado() y los textos de MOTIVOS no se tocan:
//     son la clave de deduplicación de los llamados abiertos.
//
// OBSERVABILIDAD
// Cada petición emite UNA línea JSON con registrarIngesta() (lib/registro.ts):
// quién declaró ser, a qué dispositivo se lo atribuyó, cómo autenticó, el área
// resuelta, si hubo discrepancia con lo declarado y qué se decidió del relé.
// Sin claves, sin hashes y sin prefijos de credencial. Es lo que permite
// responder desde los logs de Vercel si el nodo entra por credencial propia o
// por el fallback global, que es la compuerta del paso 9 del despliegue.
//
// SOBRE LOS CÓDIGOS DE RESPUESTA
// El firmware trata CUALQUIER 200 con JSON válido como "servidor vivo" y le
// resetea el failsafe de 45 segundos. Cualquier cosa que no sea 200 deja el
// relé en su último estado hasta que ese failsafe lo apague. Por eso, cuando
// hay que apagar el relé YA, la respuesta correcta es 200 con rele:false, no
// un 4xx: el 4xx tarda 45 segundos, pierde la lectura y deja el botón
// pendiente reintentándose cada 10 segundos.

import { after, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { MOTIVOS } from "@/lib/catalogos";
import { fechaHora, numero } from "@/lib/formato";
import {
  detalleDeDesvio,
  evaluarDesvios,
  hayEmergenciaAbierta,
  registrarLlamado,
} from "@/lib/alertas";
import { decidirActuadorDeArea, etiquetaCondicion } from "@/lib/automatizacion";
import { autenticarDispositivo, registrarUso } from "@/lib/credenciales";
import {
  buscarPorCodigo,
  puedeOperar,
  registrarContacto,
  resolverArea,
} from "@/lib/dispositivos";
import { registrarIngesta } from "@/lib/registro";
import type { AreaConAutomatizacion, Dispositivo } from "@/lib/tipos";

type Boton = "NINGUNO" | "NORMAL" | "EMERGENCIA";

type CuerpoIngesta = {
  dispositivo: string;
  /** Informativo. Ya no es obligatorio y no decide el área. */
  area: string | null;
  temperatura: number | null;
  humedad: number | null;
  boton: Boton;
};

/**
 * Interruptor del fallback a la clave global única.
 *
 * Default CERRADO: ausente, vacía o distinta de "1" significa que el fallback
 * NO existe. Solo el valor literal "1" lo enciende.
 *
 * Fallar cerrado acá es observable, no silencioso: sin credencial el nodo
 * recibe 401, a los 45 segundos su propio failsafe apaga el relé —estado
 * seguro— y a los 90 la vigilancia levanta "Sensor sin señal". El sistema
 * grita, que es lo que se quiere de un fallo de autenticación.
 */
const FLAG_CLAVE_GLOBAL = "INGEST_PERMITE_CLAVE_GLOBAL";

/** Tope del cuerpo. El nodo manda unos 120 bytes; esto es holgado y acotado. */
const MAXIMO_BYTES_CUERPO = 8 * 1024;

/**
 * Rango físicamente posible de cada magnitud. Lo que caiga afuera es un sensor
 * roto o un dato corrupto, y se descarta EN VEZ de guardarse.
 *
 * Se descarta el valor, no la petición: devolver 400 dejaría al nodo sin
 * órdenes y con el botón pendiente reintentándose cada 10 segundos mientras el
 * sensor siga fallando. Descartando la magnitud, la lectura entra con ese campo
 * en null —que es lo mismo que manda el firmware cuando el DHT devuelve NaN— y
 * el nodo sigue recibiendo `rele` y `alarma`.
 */
const TEMPERATURA_MINIMA_FISICA = -40;
const TEMPERATURA_MAXIMA_FISICA = 85;
const HUMEDAD_MINIMA_FISICA = 0;
const HUMEDAD_MAXIMA_FISICA = 100;

function json(cuerpo: unknown, status: number): Response {
  return Response.json(cuerpo, { status });
}

function esBoton(valor: unknown): valor is Boton {
  return valor === "NINGUNO" || valor === "NORMAL" || valor === "EMERGENCIA";
}

/** Acepta número o string numérico; cualquier otra cosa es null. */
function aNumero(valor: unknown): number | null {
  if (typeof valor === "number" && Number.isFinite(valor)) return valor;
  if (typeof valor === "string" && valor.trim() !== "") {
    const convertido = Number(valor);
    if (Number.isFinite(convertido)) return convertido;
  }
  return null;
}

function enRango(valor: number, minimo: number, maximo: number): boolean {
  return valor >= minimo && valor <= maximo;
}

function leerCuerpo(crudo: unknown): CuerpoIngesta | string {
  if (typeof crudo !== "object" || crudo === null) {
    return "El cuerpo tiene que ser un objeto JSON.";
  }

  const cuerpo = crudo as Record<string, unknown>;

  const dispositivo =
    typeof cuerpo.dispositivo === "string" ? cuerpo.dispositivo.trim() : "";
  if (dispositivo === "") return "Falta el campo dispositivo.";

  // 'area' pasó a ser opcional. El firmware la manda solo por compatibilidad y
  // el área real sale de la asignación registrada del dispositivo.
  const areaCruda = typeof cuerpo.area === "string" ? cuerpo.area.trim() : "";
  const area = areaCruda === "" ? null : areaCruda.toUpperCase();

  const boton = cuerpo.boton === undefined ? "NINGUNO" : cuerpo.boton;
  if (!esBoton(boton)) {
    return "El campo boton tiene que ser NINGUNO, NORMAL o EMERGENCIA.";
  }

  return {
    dispositivo,
    area,
    temperatura: aNumero(cuerpo.temperatura),
    humedad: aNumero(cuerpo.humedad),
    boton,
  };
}

type Autenticacion =
  | { estado: "OK"; dispositivo: Dispositivo; credencialId: number | null; compatibilidad: boolean }
  | { estado: "INACTIVO"; codigo: string }
  | { estado: "NO_REGISTRADO"; codigo: string }
  | { estado: "RECHAZADO"; motivo: string };

/**
 * Cascada de autenticación.
 *
 *   1. Credencial propia del dispositivo. La clave se hashea y se busca por
 *      índice; si eso no da, se prueba el camino heredado con bcrypt, que
 *      necesita el código declarado en el cuerpo. Es el camino del nodo físico,
 *      que todavía tiene grabada la clave vieja.
 *   2. Clave global, solo si el flag de compatibilidad está encendido. No
 *      identifica un dispositivo por sí sola, así que el aparato se resuelve
 *      por el código declarado —pero el ÁREA sigue saliendo de la asignación
 *      registrada, nunca del cuerpo.
 *   3. Si ninguna sirve, 401.
 *
 * El orden importa: durante la transición la clave del nodo es al mismo tiempo
 * su credencial y la vieja clave global. Si se probara primero el fallback, el
 * nodo seguiría entrando como anónimo y la migración no habría servido de nada.
 */
async function autenticar(
  clave: string,
  codigoDeclarado: string,
): Promise<Autenticacion> {
  const propia = await autenticarDispositivo(clave, codigoDeclarado);

  if (propia.ok) {
    return {
      estado: "OK",
      dispositivo: propia.dispositivo,
      credencialId: propia.credencialId,
      compatibilidad: false,
    };
  }

  if (propia.motivo === "DISPOSITIVO_INACTIVO") {
    return { estado: "INACTIVO", codigo: codigoDeclarado };
  }

  const global = process.env.DEVICE_KEY;
  const permitido = process.env[FLAG_CLAVE_GLOBAL] === "1";

  if (permitido && global && clave === global) {
    const dispositivo = await buscarPorCodigo(codigoDeclarado);
    if (!dispositivo) return { estado: "NO_REGISTRADO", codigo: codigoDeclarado };
    if (!puedeOperar(dispositivo)) {
      return { estado: "INACTIVO", codigo: dispositivo.codigo };
    }

    return {
      estado: "OK",
      dispositivo,
      credencialId: null,
      compatibilidad: true,
    };
  }

  return { estado: "RECHAZADO", motivo: propia.motivo };
}

export async function POST(request: NextRequest): Promise<Response> {
  // El firmware corta a los 6 segundos (HTTP_TIMEOUT_MS). Medir cuánto tarda
  // el handler es la única forma de ver ese margen achicarse antes de que el
  // nodo empiece a perder respuestas.
  const inicio = Date.now();

  // 1. La cabecera tiene que estar. Sin clave no hay nada que resolver.
  const clave = request.headers.get("x-device-key");
  if (clave === null || clave.trim() === "") {
    registrarIngesta({
      resultado: "SIN_CLAVE",
      estado_http: 401,
      ms: Date.now() - inicio,
    });
    return json({ ok: false, error: "Clave de dispositivo inválida." }, 401);
  }

  // 2. Tope de tamaño antes de parsear nada.
  const largo = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(largo) && largo > MAXIMO_BYTES_CUERPO) {
    registrarIngesta({
      resultado: "CUERPO_INVALIDO",
      estado_http: 400,
      ms: Date.now() - inicio,
    });
    return json({ ok: false, error: "El cuerpo es demasiado grande." }, 400);
  }

  let crudo: unknown;
  try {
    crudo = await request.json();
  } catch {
    registrarIngesta({
      resultado: "CUERPO_INVALIDO",
      estado_http: 400,
      ms: Date.now() - inicio,
    });
    return json({ ok: false, error: "El cuerpo no es JSON válido." }, 400);
  }

  const cuerpo = leerCuerpo(crudo);
  if (typeof cuerpo === "string") {
    registrarIngesta({
      resultado: "CUERPO_INVALIDO",
      estado_http: 400,
      ms: Date.now() - inicio,
    });
    return json({ ok: false, error: cuerpo }, 400);
  }

  // 3. Autenticación en cascada.
  const acceso = await autenticar(clave, cuerpo.dispositivo);

  if (acceso.estado === "RECHAZADO") {
    registrarIngesta({
      declarado: cuerpo.dispositivo,
      resultado: "RECHAZADO",
      area_declarada: cuerpo.area,
      boton: cuerpo.boton,
      estado_http: 401,
      ms: Date.now() - inicio,
    });
    // Mismo cuerpo que la versión anterior: es el 401 que el firmware ya sabe
    // registrar en el monitor serie.
    return json({ ok: false, error: "Clave de dispositivo inválida." }, 401);
  }

  if (acceso.estado === "NO_REGISTRADO") {
    registrarIngesta({
      declarado: cuerpo.dispositivo,
      resultado: "DISPOSITIVO_NO_REGISTRADO",
      modo: "compatibilidad",
      area_declarada: cuerpo.area,
      boton: cuerpo.boton,
      estado_http: 404,
      ms: Date.now() - inicio,
    });
    return json(
      {
        ok: false,
        error: `No existe un dispositivo registrado con el código ${acceso.codigo}.`,
      },
      404,
    );
  }

  if (acceso.estado === "INACTIVO") {
    // Dado de baja: no autentica, no recibe órdenes y su lectura NO se guarda.
    // Se responde 200 con rele:false para que el relé se apague en el acto en
    // vez de dentro de 45 segundos, y para que el nodo no quede reintentando
    // un botón que nadie va a confirmar.
    registrarIngesta({
      declarado: cuerpo.dispositivo,
      dispositivo: acceso.codigo,
      resultado: "DISPOSITIVO_INACTIVO",
      area_declarada: cuerpo.area,
      discrepancia_dispositivo: cuerpo.dispositivo !== acceso.codigo,
      rele: false,
      alarma: false,
      temperatura: cuerpo.temperatura,
      humedad: cuerpo.humedad,
      boton: cuerpo.boton,
      estado_http: 200,
      ms: Date.now() - inicio,
    });
    return json(
      {
        ok: true,
        rele: false,
        alarma: false,
        area: null,
        llamados: [],
        dispositivo: acceso.codigo,
        compatibilidad: false,
        area_declarada: cuerpo.area,
        avisos: ["El dispositivo está dado de baja: la lectura no se guarda."],
      },
      200,
    );
  }

  const { dispositivo, credencialId, compatibilidad } = acceso;
  const avisos: string[] = [];

  if (compatibilidad) {
    avisos.push(
      `Modo compatibilidad: autenticado con la clave global. Emitile una credencial propia a ${dispositivo.codigo}.`,
    );
    console.warn(
      `[ingest] modo compatibilidad para ${dispositivo.codigo}: todavía usa la clave global`,
    );
  }

  // 4. El área sale SIEMPRE de la asignación registrada. body.area no participa.
  const resolucion = await resolverArea(dispositivo);
  let area: AreaConAutomatizacion | null = null;

  if (resolucion.estado === "CON_AREA") {
    area = resolucion.area;

    if (!area.activa) {
      // Sigue guardando la lectura, pero no genera llamados ni acciona nada.
      // Un área de baja no la mira nadie: dejar el riego corriendo solo ahí es
      // peor que no regar. Ver lib/automatizacion.ts, OpcionesActuador.
      avisos.push(
        `El área ${area.codigo} está dada de baja: no se generan llamados y el actuador queda apagado.`,
      );
    }
  } else if (resolucion.estado === "SIN_AREA") {
    avisos.push(
      "El dispositivo no tiene área asignada: no hay umbrales que evaluar.",
    );
  } else {
    // No debería pasar: hay clave foránea. Si pasa, se trata como sin área y
    // se deja constancia, en vez de voltear la lectura del nodo.
    avisos.push("El área asignada al dispositivo no existe.");
    console.error(
      `[ingest] ${dispositivo.codigo} apunta al área ${dispositivo.area_id}, que no existe`,
    );
  }

  // 5. Discrepancia entre lo que el nodo dice y lo que dice la base. Gana la
  //    base, y queda constancia en la respuesta y en el log.
  if (cuerpo.area !== null) {
    if (area !== null && cuerpo.area !== area.codigo) {
      avisos.push(
        `El nodo declaró el área ${cuerpo.area} pero tiene asignada ${area.codigo}. Se usó la asignada.`,
      );
      console.warn(
        `[ingest] ${dispositivo.codigo} declaró ${cuerpo.area} y tiene asignada ${area.codigo}`,
      );
    } else if (area === null) {
      avisos.push(
        `El nodo declaró el área ${cuerpo.area}, pero no tiene ninguna asignada. Se ignoró.`,
      );
    }
  }

  // 6. Rango físico. Lo imposible se descarta en vez de guardarse.
  let temperatura = cuerpo.temperatura;
  let humedad = cuerpo.humedad;

  if (
    temperatura !== null &&
    !enRango(temperatura, TEMPERATURA_MINIMA_FISICA, TEMPERATURA_MAXIMA_FISICA)
  ) {
    avisos.push(
      `Temperatura fuera de rango físico (${numero(temperatura)} °C): se descartó.`,
    );
    console.warn(
      `[ingest] ${dispositivo.codigo} reportó ${temperatura} °C, fuera de rango físico`,
    );
    temperatura = null;
  }

  if (
    humedad !== null &&
    !enRango(humedad, HUMEDAD_MINIMA_FISICA, HUMEDAD_MAXIMA_FISICA)
  ) {
    avisos.push(`Humedad fuera de rango físico (${numero(humedad)} %): se descartó.`);
    console.warn(
      `[ingest] ${dispositivo.codigo} reportó ${humedad} %, fuera de rango físico`,
    );
    humedad = null;
  }

  // 6.bis Discrepancia entre el código que el nodo declara y el dueño real de
  //       la credencial. Gana la credencial, igual que con el área.
  //
  //       Esto importa más de lo que parece. `lecturas.dispositivo` es la
  //       columna por la que agrupa la vigilancia de nodos caídos
  //       (lib/alertas.ts, estadoDeNodos()). Si se guardara el texto declarado
  //       tal cual, cualquiera con una credencial de un dispositivo simulado
  //       podría escribir filas rotuladas "NODO-INV-N-01" y mantener "vivo" al
  //       nodo físico aunque estuviera apagado — que es exactamente el efecto
  //       combinado descrito en R1 y R10 de 03-riesgos.md.
  //
  //       Se guarda entonces el código RESUELTO. El declarado no se pierde:
  //       queda en el aviso de la respuesta y en el log del servidor, que es
  //       donde corresponde auditar una discrepancia, no en la columna que el
  //       resto del sistema lee como si fuera identidad.
  if (cuerpo.dispositivo !== dispositivo.codigo) {
    avisos.push(
      `El nodo se declaró ${cuerpo.dispositivo} pero su credencial es de ` +
        `${dispositivo.codigo}. La lectura se atribuyó a ${dispositivo.codigo}.`,
    );
    console.warn(
      `[ingest] cuerpo declara ${cuerpo.dispositivo} y la credencial es de ${dispositivo.codigo}`,
    );
  }

  // 7. La lectura se guarda siempre, incluso si el área está dada de baja o si
  //    el dispositivo no tiene área (en ese caso, con area_id en null).
  //    Las dos columnas de identidad guardan lo mismo —el código resuelto— y
  //    eso sostiene el invariante que verifica 20-migraciones-aplicadas.md
  //    §1.3 (d): el texto de lecturas.dispositivo siempre coincide con el
  //    codigo del dispositivo vinculado.
  const momento = new Date();
  const { error: errorLectura } = await db().from("lecturas").insert({
    dispositivo: dispositivo.codigo,
    dispositivo_id: dispositivo.id,
    area_id: area?.id ?? null,
    temperatura,
    humedad,
    tomada_en: momento.toISOString(),
  });

  if (errorLectura) {
    registrarIngesta({
      declarado: cuerpo.dispositivo,
      dispositivo: dispositivo.codigo,
      resultado: compatibilidad ? "CLAVE_GLOBAL" : "CREDENCIAL_PROPIA",
      modo: compatibilidad ? "compatibilidad" : "credencial",
      credencial_id: credencialId,
      area: area?.codigo ?? null,
      area_declarada: cuerpo.area,
      temperatura,
      humedad,
      boton: cuerpo.boton,
      estado_http: 500,
      ms: Date.now() - inicio,
    });
    return json(
      {
        ok: false,
        error: `No se pudo guardar la lectura: ${errorLectura.message}`,
      },
      500,
    );
  }

  const llamados: { motivo: string; tipo: string; resultado: string }[] = [];

  // 8. Un llamado por magnitud fuera de rango, con antirrebote, y el botón.
  //    Un área dada de baja guarda lecturas pero no genera alertas.
  if (area !== null && area.activa) {
    for (const desvio of evaluarDesvios(area, temperatura, humedad)) {
      const resultado = await registrarLlamado({
        areaId: area.id,
        areaNombre: area.nombre,
        tipo: desvio.tipo,
        origen: "SENSOR",
        motivo: desvio.motivo,
        detalle: detalleDeDesvio(desvio, dispositivo.codigo, momento),
        creadoPor: dispositivo.codigo,
      });

      llamados.push({ motivo: desvio.motivo, tipo: desvio.tipo, resultado });
    }

    if (cuerpo.boton !== "NINGUNO") {
      const motivo =
        cuerpo.boton === "EMERGENCIA"
          ? MOTIVOS.BOTON_EMERGENCIA
          : MOTIVOS.ASISTENCIA;

      const resultado = await registrarLlamado({
        areaId: area.id,
        areaNombre: area.nombre,
        tipo: cuerpo.boton,
        origen: "EMPLEADO",
        motivo,
        detalle:
          `Accionado desde ${dispositivo.codigo} en ${area.nombre} ` +
          `el ${fechaHora(momento)}. ` +
          `Lectura del momento: ${numero(temperatura)} °C, ` +
          `${numero(humedad)} %.`,
        creadoPor: dispositivo.codigo,
      });

      llamados.push({ motivo, tipo: cuerpo.boton, resultado });
    }
  }

  // 9. Órdenes de vuelta al nodo.
  //
  //    El actuador lo decide EXCLUSIVAMENTE lib/automatizacion.ts, a partir de
  //    los cuatro interruptores del área. Acá no hay ninguna comparación contra
  //    un umbral: si alguien vuelve a escribir `temperatura > area.temp_max` en
  //    este archivo, se rompió la separación.
  //
  //    Sin área no hay umbrales ni configuración, así que no hay nada que
  //    accionar.
  const decision =
    area === null
      ? null
      : decidirActuadorDeArea(area, { temperatura, humedad });

  const rele = decision?.encendido ?? false;

  if (decision !== null) {
    if (decision.motivos.length > 0) {
      avisos.push(
        `Actuador encendido por: ${decision.motivos.map(etiquetaCondicion).join(", ")}.`,
      );
    } else if (decision.condiciones.length > 0) {
      // Hay desvío —y por lo tanto llamado— pero el área no lo tiene marcado
      // para accionar. Es la separación funcionando, no un error.
      avisos.push(
        `Fuera de rango sin automatización marcada: ${decision.condiciones
          .map(etiquetaCondicion)
          .join(", ")}.`,
      );
    }
  }

  const alarma = area === null ? false : await hayEmergenciaAbierta(area.id);

  // 10. Telemetría, después de responder: el firmware corta a los 6 segundos y
  //     no hay presupuesto para escrituras que no sean imprescindibles.
  const registrar = async () => {
    await registrarContacto(dispositivo.id, momento);
    if (credencialId !== null) await registrarUso(credencialId, momento);
  };

  try {
    after(registrar);
  } catch {
    void registrar();
  }

  registrarIngesta({
    declarado: cuerpo.dispositivo,
    dispositivo: dispositivo.codigo,
    resultado: compatibilidad ? "CLAVE_GLOBAL" : "CREDENCIAL_PROPIA",
    modo: compatibilidad ? "compatibilidad" : "credencial",
    credencial_id: credencialId,
    area: area?.codigo ?? null,
    area_declarada: cuerpo.area,
    discrepancia_area: cuerpo.area !== null && area !== null && cuerpo.area !== area.codigo,
    discrepancia_dispositivo: cuerpo.dispositivo !== dispositivo.codigo,
    rele,
    alarma,
    motivos_rele: decision?.motivos ?? [],
    temperatura,
    humedad,
    boton: cuerpo.boton,
    llamados: llamados.length,
    estado_http: 200,
    ms: Date.now() - inicio,
  });

  return json(
    {
      ok: true,
      rele,
      alarma,
      // Informativo para depurar desde la terminal; el nodo puede ignorarlo.
      // Es el código RESUELTO, no el declarado: si difieren, quien mire la
      // respuesta ve la diferencia.
      area: area?.codigo ?? null,
      llamados,
      dispositivo: dispositivo.codigo,
      compatibilidad,
      area_declarada: cuerpo.area,
      avisos,
    },
    200,
  );
}

/** Cualquier otro método no aplica en este endpoint. */
export async function GET(): Promise<Response> {
  return json(
    { ok: false, error: "Usá POST con la cabecera x-device-key." },
    405,
  );
}
