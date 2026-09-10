// tests/contrato-ingest.test.ts
// El validador del contrato de la respuesta 200 de /api/ingest.
//
// Este archivo no prueba la ruta: prueba el VALIDADOR que después se aplica a
// las respuestas reales en scripts/probar-ingest.mjs. Si el validador estuviera
// mal, la suite de integración diría "verde" sobre una respuesta rota.
//
// Cada caso de abajo es uno de los modos de ruptura silenciosa del §5.2 de
// documents/contexto/90-firmware.md. Todos comparten la misma característica:
// el nodo NO se entera. ArduinoJson devuelve el default `false` sin error, así
// que el relé queda apagado y la sirena muda, con el nodo reportando 200 OK.

import { describe, expect, it } from "vitest";
import {
  CAMPOS_QUE_LEE_EL_FIRMWARE,
  comoArduinoJson,
  resumirContrato,
  verificarContratoIngest,
} from "@/lib/contrato-ingest";

/** La respuesta real de /api/ingest, tal como se verificó en 90-firmware.md. */
const RESPUESTA_REAL = {
  ok: true,
  rele: false,
  alarma: true,
  area: "INV-N",
  llamados: [],
  dispositivo: "NODO-INV-N-01",
  compatibilidad: false,
  area_declarada: "INV-N",
  avisos: [],
};

describe("comoArduinoJson: reproduce `datos[campo] | false`", () => {
  it("un booleano pasa tal cual", () => {
    expect(comoArduinoJson({ rele: true }, "rele")).toBe(true);
    expect(comoArduinoJson({ rele: false }, "rele")).toBe(false);
  });

  it("un campo ausente da false, sin error", () => {
    expect(comoArduinoJson({}, "rele")).toBe(false);
  });

  it("null da false", () => {
    expect(comoArduinoJson({ rele: null }, "rele")).toBe(false);
  });

  it("un string 'true' da false: no es un booleano JSON", () => {
    expect(comoArduinoJson({ rele: "true" }, "rele")).toBe(false);
    expect(comoArduinoJson({ rele: "ON" }, "rele")).toBe(false);
  });

  it("el número 1 da false", () => {
    expect(comoArduinoJson({ rele: 1 }, "rele")).toBe(false);
  });

  it("un objeto anidado da false", () => {
    expect(comoArduinoJson({ ordenes: { rele: true } }, "rele")).toBe(false);
  });
});

describe("la respuesta real cumple el contrato", () => {
  it("acepta la respuesta que devuelve /api/ingest hoy", () => {
    const veredicto = verificarContratoIngest(RESPUESTA_REAL);
    expect(veredicto.cumple).toBe(true);
    expect(veredicto.problemas).toEqual([]);
    expect(veredicto.leido).toEqual({ rele: false, alarma: true });
  });

  it("acepta la respuesta del dispositivo dado de baja", () => {
    // El otro camino 200 de la ruta: rele:false y alarma:false literales.
    const veredicto = verificarContratoIngest({
      ok: true,
      rele: false,
      alarma: false,
      area: null,
      llamados: [],
      dispositivo: "ESP32-INV-N",
      compatibilidad: false,
      area_declarada: null,
      avisos: ["El dispositivo está dado de baja: la lectura no se guarda."],
    });
    expect(veredicto.cumple).toBe(true);
  });

  it("agregar campos nuevos no rompe nada: el firmware lee dos y nada más", () => {
    const veredicto = verificarContratoIngest({
      ...RESPUESTA_REAL,
      firmware_sugerido: "2.0",
      telemetria: { rssi: -61 },
    });
    expect(veredicto.cumple).toBe(true);
  });

  it("el orden de las claves no importa", () => {
    const veredicto = verificarContratoIngest({
      avisos: [],
      alarma: true,
      llamados: [],
      rele: false,
      ok: true,
    });
    expect(veredicto.cumple).toBe(true);
  });
});

describe("los modos de ruptura silenciosa", () => {
  it("renombrar rele lo detecta", () => {
    const { rele: _rele, ...sinRele } = RESPUESTA_REAL;
    void _rele;
    const veredicto = verificarContratoIngest({ ...sinRele, releEncendido: true });

    expect(veredicto.cumple).toBe(false);
    expect(veredicto.problemas.map((p) => p.campo)).toContain("rele");
    // Y esto es lo que le pasaría al nodo: relé apagado, sin síntoma.
    expect(veredicto.leido.rele).toBe(false);
  });

  it("renombrar alarma lo detecta", () => {
    const { alarma: _alarma, ...sinAlarma } = RESPUESTA_REAL;
    void _alarma;
    const veredicto = verificarContratoIngest({ ...sinAlarma, sirena: true });

    expect(veredicto.cumple).toBe(false);
    expect(veredicto.problemas.map((p) => p.campo)).toContain("alarma");
    expect(veredicto.leido.alarma).toBe(false);
  });

  it("cambiar el tipo a string lo detecta", () => {
    const veredicto = verificarContratoIngest({ ...RESPUESTA_REAL, rele: "ON" });
    expect(veredicto.cumple).toBe(false);
    expect(veredicto.leido.rele).toBe(false);
  });

  it("cambiar el tipo a número lo detecta", () => {
    const veredicto = verificarContratoIngest({ ...RESPUESTA_REAL, alarma: 1 });
    expect(veredicto.cumple).toBe(false);
    expect(veredicto.leido.alarma).toBe(false);
  });

  it("un null en rele lo detecta", () => {
    const veredicto = verificarContratoIngest({ ...RESPUESTA_REAL, rele: null });
    expect(veredicto.cumple).toBe(false);
  });

  it("anidarlos bajo otra clave lo detecta", () => {
    const veredicto = verificarContratoIngest({
      ok: true,
      ordenes: { rele: true, alarma: true },
      area: "INV-N",
    });

    expect(veredicto.cumple).toBe(false);
    expect(veredicto.problemas.map((p) => p.campo).sort()).toEqual([
      "alarma",
      "rele",
    ]);
    // Los dos quedarían en false aunque el servidor quisiera encenderlos.
    expect(veredicto.leido).toEqual({ rele: false, alarma: false });
  });

  it("perder ok lo detecta", () => {
    const { ok: _ok, ...sinOk } = RESPUESTA_REAL;
    void _ok;
    const veredicto = verificarContratoIngest(sinOk);
    expect(veredicto.cumple).toBe(false);
    expect(veredicto.problemas.map((p) => p.campo)).toContain("ok");
  });

  it("un ok que no sea el literal true lo detecta", () => {
    expect(verificarContratoIngest({ ...RESPUESTA_REAL, ok: "true" }).cumple).toBe(
      false,
    );
    expect(verificarContratoIngest({ ...RESPUESTA_REAL, ok: 1 }).cumple).toBe(
      false,
    );
  });

  it("una respuesta que no es un objeto lo detecta", () => {
    // Es el caso del HTML de error de la plataforma con status 200.
    for (const basura of ["<html>502</html>", null, 42, [1, 2, 3], undefined]) {
      const veredicto = verificarContratoIngest(basura);
      expect(veredicto.cumple).toBe(false);
      expect(veredicto.problemas[0].campo).toBe("(cuerpo)");
    }
  });

  it("informa TODOS los problemas juntos, no solo el primero", () => {
    const veredicto = verificarContratoIngest({ ok: false, rele: "si" });
    expect(veredicto.problemas.map((p) => p.campo).sort()).toEqual([
      "alarma",
      "ok",
      "rele",
    ]);
  });
});

describe("metadatos del contrato", () => {
  it("los campos que lee el firmware son exactamente dos", () => {
    expect([...CAMPOS_QUE_LEE_EL_FIRMWARE]).toEqual(["rele", "alarma"]);
  });

  it("el resumen dice qué entendería el firmware cuando cumple", () => {
    const texto = resumirContrato(verificarContratoIngest(RESPUESTA_REAL));
    expect(texto).toContain("rele=false");
    expect(texto).toContain("alarma=true");
  });

  it("el resumen dice qué falló cuando no cumple", () => {
    const texto = resumirContrato(
      verificarContratoIngest({ ...RESPUESTA_REAL, rele: 1 }),
    );
    expect(texto).toContain("rele");
    expect(texto).toContain("booleano");
  });
});
