// tests/motivos.test.ts
// Decisiones puras de lib/motivos.ts y de la etiqueta de estado. No tocan la
// base ni la red.

import { describe, expect, it } from "vitest";
import {
  etiquetaEstado,
  LARGO_MAXIMO_MOTIVO,
  MOTIVOS,
  MOTIVOS_MANUALES_POR_TIPO,
} from "@/lib/catalogos";
import {
  combinarMotivos,
  normalizarMotivo,
  validarMotivoNuevo,
} from "@/lib/motivos";

const BASE = combinarMotivos({});

describe("motivos por tipo", () => {
  it("NORMAL y EMERGENCIA no comparten ningún motivo", () => {
    const normales = new Set(BASE.NORMAL);
    expect(BASE.EMERGENCIA.some((m) => normales.has(m))).toBe(false);
  });

  it("el botón de emergencia solo se ofrece como EMERGENCIA", () => {
    expect(BASE.EMERGENCIA).toContain(MOTIVOS.BOTON_EMERGENCIA);
    expect(BASE.NORMAL).not.toContain(MOTIVOS.BOTON_EMERGENCIA);
  });

  it("la solicitud de asistencia solo se ofrece como NORMAL", () => {
    expect(BASE.NORMAL).toContain(MOTIVOS.ASISTENCIA);
    expect(BASE.EMERGENCIA).not.toContain(MOTIVOS.ASISTENCIA);
  });

  it("los motivos del sensor no se ofrecen a mano en ningún tipo", () => {
    for (const delSensor of [
      MOTIVOS.TEMP_ALTA,
      MOTIVOS.TEMP_BAJA,
      MOTIVOS.HUM_ALTA,
      MOTIVOS.HUM_BAJA,
      MOTIVOS.SIN_SENAL,
    ]) {
      expect(BASE.NORMAL).not.toContain(delSensor);
      expect(BASE.EMERGENCIA).not.toContain(delSensor);
    }
  });

  it("los extras se suman después de la base y sin repetidos", () => {
    const motivos = combinarMotivos({
      NORMAL: ["Limpieza de bandejas", "limpieza de bandejas", MOTIVOS.ASISTENCIA],
    });
    expect(motivos.NORMAL.slice(0, MOTIVOS_MANUALES_POR_TIPO.NORMAL.length)).toEqual(
      [...MOTIVOS_MANUALES_POR_TIPO.NORMAL],
    );
    expect(motivos.NORMAL.filter((m) => m.toLowerCase() === "limpieza de bandejas")).toHaveLength(1);
    expect(motivos.NORMAL.filter((m) => m === MOTIVOS.ASISTENCIA)).toHaveLength(1);
  });

  it("un extra guardado con basura no rompe la lista", () => {
    const motivos = combinarMotivos({
      NORMAL: ["", 42 as unknown as string, "Válido"],
    });
    expect(motivos.NORMAL).toContain("Válido");
    expect(motivos.NORMAL).not.toContain("");
  });
});

describe("normalizarMotivo", () => {
  it("recorta, colapsa espacios y pone la primera en mayúscula", () => {
    expect(normalizarMotivo("   rotura   de  caño  ")).toBe("Rotura de caño");
  });

  it("acota el largo", () => {
    expect(normalizarMotivo("a".repeat(500))).toHaveLength(LARGO_MAXIMO_MOTIVO);
  });
});

describe("validarMotivoNuevo", () => {
  it("acepta un motivo nuevo en su tipo", () => {
    expect(validarMotivoNuevo("NORMAL", "rotura de caño", BASE)).toEqual({
      ok: true,
      motivo: "Rotura de caño",
    });
  });

  it("rechaza uno demasiado corto", () => {
    expect(validarMotivoNuevo("NORMAL", " a ", BASE).ok).toBe(false);
  });

  it("rechaza un repetido en el mismo tipo, sin distinguir mayúsculas", () => {
    const r = validarMotivoNuevo("NORMAL", MOTIVOS.ASISTENCIA.toUpperCase(), BASE);
    expect(r.ok).toBe(false);
  });

  it("rechaza uno que ya existe en el OTRO tipo, y dice cuál", () => {
    const r = validarMotivoNuevo("NORMAL", MOTIVOS.BOTON_EMERGENCIA, BASE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("emergencia");
  });

  it("rechaza los motivos que genera el sistema", () => {
    // Un llamado manual con este texto se mezclaría con los del sensor en el
    // antirrebote, que agrupa por (área, motivo).
    const r = validarMotivoNuevo("EMERGENCIA", MOTIVOS.TEMP_ALTA, BASE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("sistema");
  });
});

describe("etiquetaEstado", () => {
  it("muestra los dos estados en lenguaje de persona", () => {
    expect(etiquetaEstado("NO_ATENDIDO")).toBe("No Atendido");
    expect(etiquetaEstado("ATENDIDO")).toBe("Atendido");
  });

  it("deja pasar cualquier otra etiqueta tal cual", () => {
    // La torta de reportes mezcla estados, tipos y orígenes en la misma lista.
    expect(etiquetaEstado("EMERGENCIA")).toBe("EMERGENCIA");
    expect(etiquetaEstado("SENSOR")).toBe("SENSOR");
  });
});
