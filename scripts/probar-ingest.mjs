#!/usr/bin/env node
// scripts/probar-ingest.mjs
//
// Suite de integración de /api/ingest. Ejecutable, no prosa: corre los casos
// contra un servidor real y **devuelve exit code distinto de cero si algo
// falla**.
//
//   yarn probar:ingest                  # levanta next start solo y prueba ahí
//   PAB_URL=http://localhost:3000 \
//     yarn probar:ingest                # prueba contra un servidor ya andando
//
// Requiere `yarn build` hecho (usa .next) y un .env.local válido. Habla con la
// base REAL, porque es la única que hay: por eso todos los casos usan valores
// dentro de rango salvo los que deliberadamente prueban un desvío, y al final
// se informa el delta exacto de lecturas y llamados.
//
// QUÉ CUBRE
//
//   * Los 10 casos de documents/contexto/40-pruebas-ingest.md.
//   * Las verificaciones de contrato de hardware de 90-firmware.md: el POST
//     byte por byte del firmware, los caminos de éxito, el DHT en null, el
//     botón, la polaridad, el failsafe y la vigilancia.
//   * El aislamiento del simulador de 80-simulador.md.
//
// LO QUE NO HACE, Y NO PUEDE HACER
//
// No prueba el hardware. Reproduce el POST del nodo; no es el nodo. Cronometrar
// los 45 segundos del failsafe y ver el relé abrir necesita el aparato. Ver
// 90-firmware.md §3.3.
//
// SECRETOS
//
// La clave del dispositivo se lee del firmware a memoria y **nunca se imprime**,
// ni entera ni en fragmentos. Lo mismo con el service key de Supabase.

import { spawn } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  resumirContrato,
  verificarContratoIngest,
} from "../lib/contrato-ingest.ts";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------
// ENTORNO
// ---------------------------------------------------------------------

function leerEnv() {
  const archivo = path.join(RAIZ, ".env.local");
  if (!existsSync(archivo)) {
    throw new Error("Falta .env.local en la raíz del proyecto.");
  }

  const pares = {};
  for (const linea of readFileSync(archivo, "utf8").split(/\r?\n/)) {
    if (!linea.includes("=") || linea.trimStart().startsWith("#")) continue;
    const corte = linea.indexOf("=");
    pares[linea.slice(0, corte).trim()] = linea
      .slice(corte + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }

  for (const requerida of ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "JWT_SECRET"]) {
    if (!pares[requerida]) {
      throw new Error(`Falta ${requerida} en .env.local.`);
    }
  }
  return pares;
}

const ENV = leerEnv();

/** La clave grabada en el firmware. Se lee a memoria y no se imprime nunca. */
function claveDelFirmware() {
  const ino = path.join(
    RAIZ,
    "firmware",
    "produccion_parque",
    "produccion_parque.ino",
  );
  const encontrado = readFileSync(ino, "utf8").match(
    /^const char\* DEVICE_KEY = "(.*)";/m,
  );
  if (!encontrado) {
    throw new Error("No se pudo leer DEVICE_KEY del firmware.");
  }
  return encontrado[1];
}

const CLAVE_NODO = claveDelFirmware();

// ---------------------------------------------------------------------
// SUPABASE (PostgREST directo, sin el cliente de la app)
// ---------------------------------------------------------------------

const BASE_REST = `${ENV.SUPABASE_URL.replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "")}/rest/v1`;

async function rest(ruta, opciones = {}) {
  const respuesta = await fetch(`${BASE_REST}/${ruta}`, {
    ...opciones,
    headers: {
      apikey: ENV.SUPABASE_SERVICE_KEY,
      authorization: `Bearer ${ENV.SUPABASE_SERVICE_KEY}`,
      "content-type": "application/json",
      ...(opciones.headers ?? {}),
    },
  });

  const texto = await respuesta.text();
  let cuerpo = texto;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    // Un DELETE sin representación devuelve vacío.
  }

  if (!respuesta.ok) {
    throw new Error(`PostgREST ${respuesta.status} en ${ruta}: ${texto}`);
  }
  return { cuerpo, rango: respuesta.headers.get("content-range") };
}

async function contar(tabla, filtro = "") {
  const { rango } = await rest(`${tabla}?select=id${filtro}`, {
    headers: { Prefer: "count=exact", Range: "0-0" },
  });
  return Number(String(rango).split("/")[1] ?? 0);
}

// ---------------------------------------------------------------------
// SESIÓN (mismo HS256 que lib/sesion.ts)
// ---------------------------------------------------------------------

const b64 = (objeto) =>
  Buffer.from(JSON.stringify(objeto)).toString("base64url");

function cookieDeSesion(sesion) {
  const ahora = Math.floor(Date.now() / 1000);
  const cabecera = b64({ alg: "HS256" });
  const cuerpo = b64({ ...sesion, iat: ahora, exp: ahora + 8 * 3600 });
  const firma = createHmac("sha256", ENV.JWT_SECRET)
    .update(`${cabecera}.${cuerpo}`)
    .digest("base64url");
  return `pab_sesion=${cabecera}.${cuerpo}.${firma}`;
}

const ADMIN = { id: 1, usuario: "admin", rol: "ADMINISTRADOR", area_id: null };

// ---------------------------------------------------------------------
// SERVIDOR
// ---------------------------------------------------------------------

function puertoLibre() {
  return new Promise((resolver, rechazar) => {
    const servidor = createServer();
    servidor.on("error", rechazar);
    servidor.listen(0, "127.0.0.1", () => {
      const { port } = servidor.address();
      servidor.close(() => resolver(port));
    });
  });
}

async function esperarServidor(url, intentos = 40) {
  for (let i = 0; i < intentos; i += 1) {
    try {
      const respuesta = await fetch(`${url}/api/ingest`, { method: "GET" });
      // 405 es la respuesta correcta de la ruta a un GET: el servidor está vivo.
      if (respuesta.status === 405) return true;
    } catch {
      // Todavía no levantó.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function levantarServidor() {
  if (process.env.PAB_URL) {
    const url = process.env.PAB_URL.replace(/\/+$/, "");
    if (!(await esperarServidor(url, 4))) {
      throw new Error(`No responde el servidor indicado en PAB_URL: ${url}`);
    }
    console.log(`Usando el servidor ya andando en ${url}\n`);
    return { url, detener: async () => {} };
  }

  if (!existsSync(path.join(RAIZ, ".next"))) {
    throw new Error("Falta .next: corré `yarn build` antes de esta suite.");
  }

  const puerto = await puertoLibre();
  const url = `http://127.0.0.1:${puerto}`;

  const proceso = spawn(
    process.execPath,
    [path.join(RAIZ, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(puerto)],
    { cwd: RAIZ, stdio: ["ignore", "pipe", "pipe"] },
  );

  let salida = "";
  proceso.stdout.on("data", (d) => {
    salida += d.toString();
  });
  proceso.stderr.on("data", (d) => {
    salida += d.toString();
  });

  const detener = async () => {
    if (proceso.exitCode === null) proceso.kill();
  };

  if (!(await esperarServidor(url))) {
    await detener();
    throw new Error(`El servidor no levantó en ${url}.\n${salida}`);
  }

  console.log(`Servidor de prueba en ${url}\n`);
  return { url, detener };
}

// ---------------------------------------------------------------------
// CASOS
// ---------------------------------------------------------------------

const resultados = [];
let actual = null;

/** Falla el caso en curso con un mensaje, sin cortar la suite. */
function exigir(condicion, mensaje) {
  if (!condicion) actual.fallas.push(mensaje);
}

function exigirIgual(obtenido, esperado, que) {
  const a = JSON.stringify(obtenido);
  const b = JSON.stringify(esperado);
  if (a !== b) actual.fallas.push(`${que}: esperaba ${b} y vino ${a}`);
}

async function caso(nombre, cuerpoDelCaso) {
  actual = { nombre, fallas: [], notas: [] };
  try {
    await cuerpoDelCaso();
  } catch (error) {
    actual.fallas.push(`excepción: ${error.message}`);
  }

  const paso = actual.fallas.length === 0;
  resultados.push({ ...actual, paso });

  console.log(`${paso ? "  OK  " : "  FALLA"} ${nombre}`);
  for (const nota of actual.notas) console.log(`         ${nota}`);
  for (const falla of actual.fallas) console.log(`         -> ${falla}`);
  actual = null;
}

function nota(texto) {
  actual.notas.push(texto);
}

// ---------------------------------------------------------------------
// LA SUITE
// ---------------------------------------------------------------------

async function main() {
  const { url, detener } = await levantarServidor();
  const INGEST = `${url}/api/ingest`;

  /** POST a /api/ingest. `cuerpo` puede ser string (byte por byte) u objeto. */
  async function ingest(cuerpo, opciones = {}) {
    const cabeceras = { "Content-Type": "application/json" };
    if (opciones.clave !== null) {
      cabeceras["x-device-key"] = opciones.clave ?? CLAVE_NODO;
    }

    const respuesta = await fetch(INGEST, {
      method: "POST",
      headers: cabeceras,
      body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
    });

    const texto = await respuesta.text();
    let json = null;
    try {
      json = JSON.parse(texto);
    } catch {
      // Se informa como falla de contrato donde corresponda.
    }
    return { status: respuesta.status, json, texto };
  }

  /** Aplica el validador compartido con tests/contrato-ingest.test.ts. */
  function exigirContrato(respuesta, etiqueta) {
    exigir(respuesta.status === 200, `${etiqueta}: esperaba HTTP 200 y vino ${respuesta.status}`);
    const veredicto = verificarContratoIngest(respuesta.json);
    exigir(veredicto.cumple, `${etiqueta}: ${resumirContrato(veredicto)}`);
    return veredicto;
  }

  const prefijo = `PRB${randomBytes(3).toString("hex").toUpperCase()}`;
  let fixture = null;
  const lecturasAntes = await contar("lecturas");
  const llamadosAntes = await contar("llamados");

  try {
    console.log("=== 40-pruebas-ingest.md: los diez casos ===\n");

    // -----------------------------------------------------------------
    await caso("1) credencial propia + área correcta -> 200", async () => {
      const r = await ingest({
        dispositivo: "NODO-INV-N-01",
        area: "INV-N",
        temperatura: 22.5,
        humedad: 70,
        boton: "NINGUNO",
      });

      exigirContrato(r, "contrato");
      exigirIgual(r.json?.area, "INV-N", "área resuelta");
      exigirIgual(r.json?.dispositivo, "NODO-INV-N-01", "dispositivo atribuido");
      exigir(
        r.json?.compatibilidad === false,
        "compatibilidad tiene que ser false: la credencial propia gana al fallback global",
      );
      nota(`rele=${r.json?.rele} alarma=${r.json?.alarma} compatibilidad=false`);
    });

    // -----------------------------------------------------------------
    await caso("2) área equivocada en el cuerpo -> gana la base", async () => {
      const r = await ingest({
        dispositivo: "NODO-INV-N-01",
        area: "COM-1",
        temperatura: 22.5,
        humedad: 70,
        boton: "NINGUNO",
      });

      exigirContrato(r, "contrato");
      exigirIgual(r.json?.area, "INV-N", "área resuelta (de la base)");
      exigirIgual(r.json?.area_declarada, "COM-1", "área declarada (del cuerpo)");
      exigir(
        (r.json?.avisos ?? []).some((a) => a.includes("COM-1") && a.includes("INV-N")),
        "falta el aviso que informa la discrepancia de área",
      );

      const { cuerpo } = await rest(
        "lecturas?select=id,area_id,dispositivo_id&order=id.desc&limit=1",
      );
      exigirIgual(cuerpo[0].area_id, 1, "area_id de la fila insertada");
      exigirIgual(cuerpo[0].dispositivo_id, 11, "dispositivo_id de la fila");
      nota(`fila ${cuerpo[0].id} guardada con area_id=1, no 5`);
    });

    // -----------------------------------------------------------------
    await caso("3) sin campo area -> 200, ya no es obligatorio", async () => {
      const r = await ingest({
        dispositivo: "NODO-INV-N-01",
        temperatura: 22.5,
        humedad: 70,
        boton: "NINGUNO",
      });

      exigirContrato(r, "contrato");
      exigirIgual(r.json?.area, "INV-N", "área resuelta");
      exigirIgual(r.json?.area_declarada, null, "área declarada");
    });

    // -----------------------------------------------------------------
    await caso("4) clave global con el flag ENCENDIDO -> compatibilidad", async () => {
      // Encender el fallback exige reiniciar el servidor con otra variable de
      // entorno. No se hace por omisión: cambiar la configuración del proceso a
      // mitad de una suite es peor que informar el salteo.
      if (process.env.PAB_PROBAR_FALLBACK !== "1") {
        nota(
          "SALTEADO. Exige INGEST_PERMITE_CLAVE_GLOBAL=1 y reiniciar el servidor.",
        );
        nota("Para correrlo: PAB_PROBAR_FALLBACK=1 con un servidor que lo tenga.");
        return;
      }

      const r = await ingest({
        dispositivo: "ESP32-INV-N",
        area: "COM-1",
        temperatura: 22.5,
        humedad: 70,
        boton: "NINGUNO",
      });

      exigir(
        r.json?.compatibilidad === true,
        "esperaba compatibilidad:true con el fallback encendido",
      );
      exigirIgual(r.json?.area, "INV-N", "el área sigue saliendo de la base");
    });

    // -----------------------------------------------------------------
    await caso("5) clave global con el flag APAGADO -> 401", async () => {
      // ESP32-INV-N no tiene credencial propia. Sin fallback no hay camino.
      const r = await ingest({
        dispositivo: "ESP32-INV-N",
        area: "INV-N",
        temperatura: 22.5,
        humedad: 70,
        boton: "NINGUNO",
      });

      exigirIgual(r.status, 401, "código");
      exigirIgual(r.json?.ok, false, "ok");
      exigirIgual(r.json?.error, "Clave de dispositivo inválida.", "mensaje");
      nota("es la prueba de que la migración de seguridad terminó");
    });

    // -----------------------------------------------------------------
    await caso("6) clave incorrecta y sin cabecera -> 401", async () => {
      const conClaveMala = await ingest(
        { dispositivo: "NODO-INV-N-01", area: "INV-N", temperatura: 22.5, humedad: 70 },
        { clave: "clave-que-no-es" },
      );
      exigirIgual(conClaveMala.status, 401, "código con clave incorrecta");
      exigirIgual(
        conClaveMala.json?.error,
        "Clave de dispositivo inválida.",
        "mensaje con clave incorrecta",
      );

      const sinCabecera = await ingest(
        { dispositivo: "NODO-INV-N-01", temperatura: 22.5, humedad: 70 },
        { clave: null },
      );
      exigirIgual(sinCabecera.status, 401, "código sin cabecera");
      nota("el firmware lo registra como 'HTTP 401: DEVICE_KEY incorrecta' y no cambia estado");
    });

    // -----------------------------------------------------------------
    await caso("7) dispositivo desactivado -> 200 y NO guarda lectura", async () => {
      // Se crea un dispositivo descartable, INACTIVO desde el alta, con
      // credencial propia. Al no guardar lectura queda sin historia y se puede
      // borrar al final sin perder nada.
      const secreto = `pab_${randomBytes(32).toString("base64url")}`;

      const alta = await rest("dispositivos", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          codigo: `${prefijo}-BAJA`,
          nombre: `Fixture de prueba ${prefijo}`,
          area_id: 1,
          activo: false,
          naturaleza: "SIMULADO",
          observaciones: "Fixture de scripts/probar-ingest.mjs. Se borra al terminar.",
        }),
      });
      fixture = alta.cuerpo[0];

      const credencial = await rest("dispositivo_credenciales", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          dispositivo_id: fixture.id,
          algoritmo: "sha256-v1",
          secreto_hash: createHash("sha256").update(secreto, "utf8").digest("hex"),
          prefijo: secreto.slice(0, 12),
          estado: "ACTIVA",
          origen: "GENERADA",
          creada_por: "probar-ingest",
          motivo: "Fixture de prueba.",
        }),
      });
      fixture.credencialId = credencial.cuerpo[0].id;

      const antes = await contar("lecturas", `&dispositivo_id=eq.${fixture.id}`);

      const r = await ingest(
        { dispositivo: fixture.codigo, temperatura: 22.5, humedad: 70, boton: "NINGUNO" },
        { clave: secreto },
      );

      exigirContrato(r, "contrato");
      exigirIgual(r.json?.rele, false, "rele de un dispositivo de baja");
      exigirIgual(r.json?.alarma, false, "alarma de un dispositivo de baja");
      exigir(
        (r.json?.avisos ?? []).some((a) => a.includes("dado de baja")),
        "falta el aviso de dispositivo dado de baja",
      );

      const despues = await contar("lecturas", `&dispositivo_id=eq.${fixture.id}`);
      exigirIgual(despues, antes, "lecturas del dispositivo de baja");
      nota("200 con rele:false apaga el relé en el acto; un 4xx tardaría 45 s");

      // Con la credencial revocada, el mismo POST tiene que dar 401.
      await rest(`dispositivo_credenciales?id=eq.${fixture.credencialId}`, {
        method: "PATCH",
        body: JSON.stringify({
          estado: "REVOCADA",
          revocada_en: new Date().toISOString(),
          revocada_por: "probar-ingest",
          motivo: "Fin del caso 7.",
        }),
      });

      const revocada = await ingest(
        { dispositivo: fixture.codigo, temperatura: 22.5, humedad: 70 },
        { clave: secreto },
      );
      exigirIgual(revocada.status, 401, "código con la credencial revocada");
      nota("credencial revocada -> 401, sin importar el estado del dispositivo");
    });

    // -----------------------------------------------------------------
    await caso("8) payload inválido -> 400 con los mensajes de siempre", async () => {
      const noJson = await ingest("esto no es json");
      exigirIgual(noJson.status, 400, "código con cuerpo no-JSON");
      exigirIgual(noJson.json?.error, "El cuerpo no es JSON válido.", "mensaje no-JSON");

      const sinDispositivo = await ingest({ area: "INV-N", temperatura: 22.5, humedad: 70 });
      exigirIgual(sinDispositivo.status, 400, "código sin dispositivo");
      exigirIgual(
        sinDispositivo.json?.error,
        "Falta el campo dispositivo.",
        "mensaje sin dispositivo",
      );

      const botonMalo = await ingest({ dispositivo: "NODO-INV-N-01", boton: "normal" });
      exigirIgual(botonMalo.status, 400, "código con botón inválido");
      exigirIgual(
        botonMalo.json?.error,
        "El campo boton tiene que ser NINGUNO, NORMAL o EMERGENCIA.",
        "mensaje con botón inválido",
      );
    });

    // -----------------------------------------------------------------
    await caso("9) el POST exacto del firmware -> 200 y telemetría", async () => {
      const antes = await rest(
        "dispositivo_credenciales?select=id,usada_en&dispositivo_id=eq.11&order=id&limit=1",
      );
      const usadaAntes = antes.cuerpo[0]?.usada_en ?? null;

      const r = await ingest(
        '{"dispositivo":"NODO-INV-N-01","area":"INV-N","temperatura":22.5,"humedad":70,"boton":"NINGUNO"}',
      );
      exigirContrato(r, "contrato");

      // La telemetría va en after(), fuera del camino crítico: puede tardar.
      let avanzo = false;
      let contacto = null;
      for (let i = 0; i < 12 && !avanzo; i += 1) {
        await new Promise((res) => setTimeout(res, 400));
        const ahora = await rest(
          "dispositivo_credenciales?select=id,usada_en&dispositivo_id=eq.11&order=id&limit=1",
        );
        avanzo = (ahora.cuerpo[0]?.usada_en ?? null) !== usadaAntes;
        const disp = await rest(
          "dispositivos?select=ultimo_contacto_en&id=eq.11",
        );
        contacto = disp.cuerpo[0]?.ultimo_contacto_en ?? null;
      }

      exigir(avanzo, "credencial.usada_en no avanzó: no entró por su credencial propia");
      exigir(contacto !== null, "dispositivos.ultimo_contacto_en quedó nulo");
      nota(`ultimo_contacto_en = ${contacto}`);
    });

    // -----------------------------------------------------------------
    await caso("10) regresión de contrato: ok, rele y alarma tipados", async () => {
      const r = await ingest({
        dispositivo: "NODO-INV-N-01",
        area: "INV-N",
        temperatura: 22.5,
        humedad: 70,
        boton: "NINGUNO",
      });

      const veredicto = exigirContrato(r, "contrato");
      exigir(typeof r.json?.rele === "boolean", "rele no es boolean");
      exigir(typeof r.json?.alarma === "boolean", "alarma no es boolean");
      exigir(r.json?.ok === true, "ok no es el literal true");
      exigir("rele" in (r.json ?? {}), "rele no está en la raíz");
      nota(resumirContrato(veredicto));
    });

    // -----------------------------------------------------------------
    console.log("\n=== 90-firmware.md: contrato con el hardware ===\n");

    await caso("V1) el JSON del firmware, byte por byte, aceptado tal cual", async () => {
      const cuerpos = [
        '{"dispositivo":"NODO-INV-N-01","area":"INV-N","temperatura":22.5,"humedad":70,"boton":"NINGUNO"}',
        '{"dispositivo":"NODO-INV-N-01","area":"INV-N","temperatura":null,"humedad":null,"boton":"NINGUNO"}',
        '{"dispositivo":"NODO-INV-N-01","area":"INV-N","temperatura":22.5,"humedad":70,"boton":"NORMAL"}',
        '{"dispositivo":"NODO-INV-N-01","area":"INV-N","temperatura":22.5,"humedad":70,"boton":"EMERGENCIA"}',
        '{"dispositivo":"NODO-INV-N-01","area":"INV-N","temperatura":null,"humedad":null,"boton":"EMERGENCIA"}',
      ];

      for (const cuerpo of cuerpos) {
        const r = await ingest(cuerpo);
        exigirContrato(r, `cuerpo ${cuerpo.slice(0, 60)}…`);
      }
      nota(`${cuerpos.length} cuerpos, los cinco con rele y alarma booleanos`);
    });

    await caso("V2) ningún camino de éxito omite rele ni alarma", async () => {
      const casos = [
        ["en rango", { temperatura: 22.5, humedad: 70 }],
        ["temperatura alta", { temperatura: 33, humedad: 70 }],
        ["humedad baja", { temperatura: 22.5, humedad: 40 }],
        ["fuera de rango físico", { temperatura: 999, humedad: 70 }],
        ["sin magnitudes", { temperatura: null, humedad: null }],
      ];

      for (const [etiqueta, lectura] of casos) {
        const r = await ingest({
          dispositivo: "NODO-INV-N-01",
          area: "INV-N",
          boton: "NINGUNO",
          ...lectura,
        });
        exigirContrato(r, etiqueta);
      }
      nota(`${casos.length} caminos de éxito, todos con los dos campos`);
    });

    await caso("V5) ningún error del servidor se disfraza de 200", async () => {
      // Cada uno de estos es un caso donde el failsafe del nodo DEBE actuar.
      // Si alguno respondiera 200 con JSON válido, el nodo lo tomaría como
      // servidor sano y el relé se quedaría encendido.
      const errores = [
        ["clave inválida", { clave: "no-sirve" }, { dispositivo: "NODO-INV-N-01" }],
        ["sin cabecera", { clave: null }, { dispositivo: "NODO-INV-N-01" }],
        ["cuerpo no-JSON", {}, "{{{"],
        ["sin dispositivo", {}, { area: "INV-N" }],
        ["botón fuera de catálogo", {}, { dispositivo: "NODO-INV-N-01", boton: "x" }],
      ];

      for (const [etiqueta, opciones, cuerpo] of errores) {
        const r = await ingest(cuerpo, opciones);
        exigir(
          r.status !== 200,
          `${etiqueta}: respondió 200; el nodo rearmaría el failsafe sobre un error`,
        );
        exigir(
          r.json?.ok === false,
          `${etiqueta}: el cuerpo de error tiene que traer ok:false`,
        );
      }

      // Y el GET, que el firmware nunca hace pero delata un cambio de ruta.
      const get = await fetch(INGEST, { method: "GET" });
      exigirIgual(get.status, 405, "código del GET");
      nota("401/400/405 y ningún 2xx: el failsafe del nodo puede actuar");
    });

    await caso("V8) el backend nunca invierte la polaridad", async () => {
      // INV-N tiene auto_temp_alta = true. 33 °C supera el máximo de 25.
      const encendido = await ingest({
        dispositivo: "NODO-INV-N-01",
        area: "INV-N",
        temperatura: 33,
        humedad: 70,
        boton: "NINGUNO",
      });
      exigirContrato(encendido, "lectura que debe encender");
      exigirIgual(encendido.json?.rele, true, "rele con temperatura alta");

      const apagado = await ingest({
        dispositivo: "NODO-INV-N-01",
        area: "INV-N",
        temperatura: 22.5,
        humedad: 70,
        boton: "NINGUNO",
      });
      exigirIgual(apagado.json?.rele, false, "rele dentro de rango");
      nota("true = encender. El firmware traduce a voltaje, el servidor no");
    });

    await caso("V9) DHT en NaN: null se guarda y no alerta por esa magnitud", async () => {
      const ambas = await ingest({
        dispositivo: "NODO-INV-N-01",
        area: "INV-N",
        temperatura: null,
        humedad: null,
        boton: "NINGUNO",
      });
      exigirContrato(ambas, "ambas magnitudes en null");
      exigirIgual(ambas.json?.llamados, [], "llamados con las dos en null");

      const { cuerpo } = await rest(
        "lecturas?select=id,temperatura,humedad&dispositivo_id=eq.11&order=id.desc&limit=1",
      );
      exigirIgual(cuerpo[0].temperatura, null, "temperatura guardada");
      exigirIgual(cuerpo[0].humedad, null, "humedad guardada");

      // La otra magnitud se sigue evaluando.
      const soloHumedad = await ingest({
        dispositivo: "NODO-INV-N-01",
        area: "INV-N",
        temperatura: null,
        humedad: 40,
        boton: "NINGUNO",
      });
      exigir(
        (soloHumedad.json?.llamados ?? []).some((l) =>
          l.motivo.toLowerCase().includes("humedad"),
        ),
        "con humedad fuera de rango tiene que haber llamado de humedad",
      );
      exigir(
        !(soloHumedad.json?.llamados ?? []).some((l) =>
          l.motivo.toLowerCase().includes("temperatura"),
        ),
        "no puede haber llamado de temperatura si la temperatura vino en null",
      );
      nota(`fila ${cuerpo[0].id} guardada con las dos magnitudes en null`);
    });

    await caso("V10) botón: NORMAL y EMERGENCIA generan el llamado correcto", async () => {
      const normal = await ingest({
        dispositivo: "NODO-INV-N-01",
        area: "INV-N",
        temperatura: 22.5,
        humedad: 70,
        boton: "NORMAL",
      });
      exigirContrato(normal, "botón NORMAL");
      exigir(
        (normal.json?.llamados ?? []).some(
          (l) => l.motivo === "Solicitud de asistencia",
        ),
        "el botón corto tiene que generar 'Solicitud de asistencia'",
      );

      const emergencia = await ingest({
        dispositivo: "NODO-INV-N-01",
        area: "INV-N",
        temperatura: 22.5,
        humedad: 70,
        boton: "EMERGENCIA",
      });
      exigirContrato(emergencia, "botón EMERGENCIA");
      const llamado = (emergencia.json?.llamados ?? []).find(
        (l) => l.motivo === "Botón de emergencia accionado",
      );
      exigir(llamado !== undefined, "el botón largo tiene que generar su motivo");
      exigirIgual(llamado?.tipo, "EMERGENCIA", "tipo del llamado del botón largo");

      nota(
        `resultado del antirrebote: ${(emergencia.json?.llamados ?? []).map((l) => l.resultado).join(", ")}`,
      );
    });

    await caso("V11) vigilancia: solo dispositivos FÍSICOS y activos", async () => {
      const { cuerpo: fisicos } = await rest(
        "dispositivos?select=codigo&naturaleza=eq.FISICO&activo=is.true",
      );
      const { cuerpo: otros } = await rest(
        "dispositivos?select=codigo&or=(naturaleza.eq.SIMULADO,activo.is.false)",
      );

      const antes = await contar("llamados");
      const respuesta = await fetch(`${url}/api/vigilancia`, {
        headers: { cookie: cookieDeSesion(ADMIN) },
      });
      const resumen = await respuesta.json();
      const despues = await contar("llamados");

      exigirIgual(respuesta.status, 200, "código de /api/vigilancia");
      exigirIgual(resumen.umbral_segundos, 90, "umbral");
      exigirIgual(
        resumen.revisados,
        fisicos.length,
        "revisados tiene que ser la cantidad de dispositivos FÍSICOS y activos",
      );
      exigir(
        despues - antes === resumen.creados,
        `los llamados crecieron ${despues - antes} y el resumen dice creados=${resumen.creados}`,
      );
      nota(
        `revisados=${resumen.revisados} caidos=${resumen.caidos} creados=${resumen.creados} · ${otros.length} simulados/inactivos fuera de la vigilancia`,
      );
    });

    await caso("80-simulador.md) el cuerpo no puede elegir la identidad", async () => {
      // El aislamiento del simulador se apoya en esto: aunque el cuerpo declare
      // el código del nodo físico, la lectura se atribuye al dueño de la
      // credencial. Se prueba con la credencial del fixture, que es SIMULADO.
      const secreto = `pab_${randomBytes(32).toString("base64url")}`;
      const credencial = await rest("dispositivo_credenciales", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          dispositivo_id: fixture.id,
          algoritmo: "sha256-v1",
          secreto_hash: createHash("sha256").update(secreto, "utf8").digest("hex"),
          prefijo: secreto.slice(0, 12),
          estado: "ACTIVA",
          origen: "GENERADA",
          creada_por: "probar-ingest",
          motivo: "Fixture de atribución.",
        }),
      });

      // Se reactiva un instante para que la lectura llegue a guardarse.
      await rest(`dispositivos?id=eq.${fixture.id}`, {
        method: "PATCH",
        body: JSON.stringify({ activo: true }),
      });

      const r = await ingest(
        {
          dispositivo: "NODO-INV-N-01",
          area: "INV-N",
          temperatura: 22.5,
          humedad: 70,
          boton: "NINGUNO",
        },
        { clave: secreto },
      );

      exigirContrato(r, "contrato");
      exigirIgual(
        r.json?.dispositivo,
        fixture.codigo,
        "el servidor tiene que atribuir la lectura al dueño de la credencial",
      );

      const { cuerpo } = await rest(
        `lecturas?select=id,dispositivo,dispositivo_id&dispositivo_id=eq.${fixture.id}&order=id.desc&limit=1`,
      );
      exigirIgual(
        cuerpo[0]?.dispositivo,
        fixture.codigo,
        "lecturas.dispositivo tiene que guardar el código RESUELTO",
      );
      exigir(
        (r.json?.avisos ?? []).some((a) => a.includes("credencial")),
        "falta el aviso que informa la discrepancia de identidad",
      );

      fixture.lecturaId = cuerpo[0]?.id ?? null;
      fixture.credencialExtra = credencial.cuerpo[0].id;
      nota("el cuerpo mintió y la lectura quedó atribuida al simulado");
    });
  } finally {
    // -----------------------------------------------------------------
    // LIMPIEZA
    // -----------------------------------------------------------------
    if (fixture) {
      try {
        if (fixture.lecturaId !== null && fixture.lecturaId !== undefined) {
          await rest(`lecturas?id=eq.${fixture.lecturaId}`, { method: "DELETE" });
        }
        await rest(`dispositivo_credenciales?dispositivo_id=eq.${fixture.id}`, {
          method: "DELETE",
        });
        await rest(`dispositivos?id=eq.${fixture.id}`, { method: "DELETE" });

        const quedan = await contar("dispositivos", `&codigo=like.${prefijo}*`);
        console.log(
          `\nLimpieza del fixture ${prefijo}: ${quedan === 0 ? "sin residuo" : `QUEDAN ${quedan} FILAS`}`,
        );
      } catch (error) {
        console.log(`\nLimpieza del fixture ${prefijo} FALLÓ: ${error.message}`);
        console.log(`Revisá a mano las filas con el prefijo ${prefijo}.`);
      }
    }

    await detener();
  }

  // -------------------------------------------------------------------
  // RESUMEN
  // -------------------------------------------------------------------
  const lecturasDespues = await contar("lecturas");
  const llamadosDespues = await contar("llamados");

  const fallados = resultados.filter((r) => !r.paso);

  console.log("\n=== Efectos sobre la base ===");
  console.log(`  lecturas: ${lecturasAntes} -> ${lecturasDespues} (${lecturasDespues - lecturasAntes >= 0 ? "+" : ""}${lecturasDespues - lecturasAntes})`);
  console.log(`  llamados: ${llamadosAntes} -> ${llamadosDespues} (${llamadosDespues - llamadosAntes >= 0 ? "+" : ""}${llamadosDespues - llamadosAntes})`);

  console.log("\n=== Resumen ===");
  console.log(`  ${resultados.length - fallados.length}/${resultados.length} casos en verde`);

  if (fallados.length > 0) {
    console.log("\n  Casos fallados:");
    for (const r of fallados) {
      console.log(`    - ${r.nombre}`);
      for (const falla of r.fallas) console.log(`        ${falla}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("\n  TODO EN VERDE");
  process.exitCode = 0;
}

main().catch((error) => {
  console.error(`\nLa suite no pudo completarse: ${error.message}`);
  process.exitCode = 1;
});
