// tests/automatizacion.test.ts
// Decisión del actuador: función pura, sin base y sin red.
//
// El último bloque es un test de CONTRATO entre lib/automatizacion.ts y
// lib/alertas.ts: verifica que las dos coincidan en qué condiciones detectan,
// sin que ninguna importe a la otra. Es lo que impide que se separen en
// silencio si alguien toca una sola de las dos.

import { describe, expect, it } from "vitest";
import { evaluarDesvios } from "@/lib/alertas";
import {
  actuadorEncendido,
  claveDeCondicion,
  condicionesDeLectura,
  CONDICIONES,
  decidirActuador,
  decidirActuadorDeArea,
  etiquetaCondicion,
  type CondicionActuador,
  type ConfiguracionActuador,
} from "@/lib/automatizacion";
import { MOTIVOS } from "@/lib/catalogos";

/** El área del enunciado: 20 a 25 °C y 60 a 80 %. */
const UMBRALES = { temp_min: 20, temp_max: 25, hum_min: 60, hum_max: 80 };

const NINGUNA: ConfiguracionActuador = {
  auto_temp_baja: false,
  auto_temp_alta: false,
  auto_hum_baja: false,
  auto_hum_alta: false,
};

const TODAS: ConfiguracionActuador = {
  auto_temp_baja: true,
  auto_temp_alta: true,
  auto_hum_baja: true,
  auto_hum_alta: true,
};

/** Solo "temperatura por encima del máximo", que es el caso de la tabla. */
const SOLO_TEMP_ALTA: ConfiguracionActuador = {
  ...NINGUNA,
  auto_temp_alta: true,
};

/** El backfill de sql/07: ventilar por calor, regar por sequedad. */
const BACKFILL_07: ConfiguracionActuador = {
  auto_temp_baja: false,
  auto_temp_alta: true,
  auto_hum_baja: true,
  auto_hum_alta: false,
};

/** Área con umbrales para evaluarDesvios(). */
const AREA = { id: 1, codigo: "INV-N", nombre: "Invernadero Norte", ...UMBRALES };

const MOTIVO_DE: Record<CondicionActuador, string> = {
  TEMP_BAJA: MOTIVOS.TEMP_BAJA,
  TEMP_ALTA: MOTIVOS.TEMP_ALTA,
  HUM_BAJA: MOTIVOS.HUM_BAJA,
  HUM_ALTA: MOTIVOS.HUM_ALTA,
};

function rele(
  configuracion: ConfiguracionActuador,
  temperatura: number | null,
  humedad: number | null,
): boolean {
  return actuadorEncendido(configuracion, UMBRALES, { temperatura, humedad });
}

function motivosDeAlerta(
  temperatura: number | null,
  humedad: number | null,
): string[] {
  return evaluarDesvios(AREA, temperatura, humedad).map((d) => d.motivo);
}

// ---------------------------------------------------------------------
describe("la tabla del enunciado: área 20–25 °C / 60–80 %, solo TEMP_ALTA marcada", () => {
  it("27 °C / 70 % -> alerta de temperatura alta, rele = true", () => {
    expect(motivosDeAlerta(27, 70)).toEqual([MOTIVOS.TEMP_ALTA]);
    expect(rele(SOLO_TEMP_ALTA, 27, 70)).toBe(true);
  });

  it("22 °C / 48 % -> alerta de humedad baja, rele = false", () => {
    expect(motivosDeAlerta(22, 48)).toEqual([MOTIVOS.HUM_BAJA]);
    expect(rele(SOLO_TEMP_ALTA, 22, 48)).toBe(false);
  });

  it("18 °C / 70 % -> alerta de temperatura baja, rele = false", () => {
    expect(motivosDeAlerta(18, 70)).toEqual([MOTIVOS.TEMP_BAJA]);
    expect(rele(SOLO_TEMP_ALTA, 18, 70)).toBe(false);
  });

  it("22 °C / 70 % -> sin desvío, rele = false", () => {
    expect(motivosDeAlerta(22, 70)).toEqual([]);
    expect(rele(SOLO_TEMP_ALTA, 22, 70)).toBe(false);
  });

  it("hay alerta en tres de los cuatro casos y el actuador se enciende en uno", () => {
    // Resume lo anterior: las alertas no dependen de las casillas.
    const casos: [number, number][] = [
      [27, 70],
      [22, 48],
      [18, 70],
      [22, 70],
    ];
    expect(casos.map(([t, h]) => motivosDeAlerta(t, h).length > 0)).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(casos.map(([t, h]) => rele(SOLO_TEMP_ALTA, t, h))).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });
});

// ---------------------------------------------------------------------
describe("ninguna casilla marcada", () => {
  it("el actuador nunca se enciende, aunque haya desvío", () => {
    expect(rele(NINGUNA, 27, 70)).toBe(false);
    expect(rele(NINGUNA, 18, 70)).toBe(false);
    expect(rele(NINGUNA, 22, 48)).toBe(false);
    expect(rele(NINGUNA, 22, 95)).toBe(false);
  });

  it("las alertas siguen existiendo igual", () => {
    expect(motivosDeAlerta(27, 70)).toEqual([MOTIVOS.TEMP_ALTA]);
    expect(motivosDeAlerta(22, 95)).toEqual([MOTIVOS.HUM_ALTA]);
  });

  it("informa la condición detectada aunque no la accione", () => {
    const decision = decidirActuador(NINGUNA, UMBRALES, {
      temperatura: 27,
      humedad: 70,
    });
    expect(decision.condiciones).toEqual(["TEMP_ALTA"]);
    expect(decision.motivos).toEqual([]);
    expect(decision.encendido).toBe(false);
  });
});

// ---------------------------------------------------------------------
describe("todas las casillas marcadas", () => {
  it("cualquiera de las cuatro condiciones enciende el actuador", () => {
    expect(rele(TODAS, 27, 70)).toBe(true);
    expect(rele(TODAS, 18, 70)).toBe(true);
    expect(rele(TODAS, 22, 48)).toBe(true);
    expect(rele(TODAS, 22, 95)).toBe(true);
  });

  it("dentro de rango sigue apagado", () => {
    expect(rele(TODAS, 22, 70)).toBe(false);
  });

  it("dos desvíos simultáneos dan dos motivos", () => {
    const decision = decidirActuador(TODAS, UMBRALES, {
      temperatura: 27,
      humedad: 48,
    });
    expect(decision.motivos).toEqual(["TEMP_ALTA", "HUM_BAJA"]);
    expect(decision.encendido).toBe(true);
  });
});

// ---------------------------------------------------------------------
describe("valores en el límite exacto", () => {
  it("25,0 °C con máximo 25 NO es 'por encima del máximo'", () => {
    expect(condicionesDeLectura(UMBRALES, { temperatura: 25, humedad: 70 })).toEqual([]);
    expect(rele(TODAS, 25, 70)).toBe(false);
  });

  it("20,0 °C con mínimo 20 NO es 'por debajo del mínimo'", () => {
    expect(rele(TODAS, 20, 70)).toBe(false);
  });

  it("60,0 % y 80,0 % tampoco están fuera de rango", () => {
    expect(rele(TODAS, 22, 60)).toBe(false);
    expect(rele(TODAS, 22, 80)).toBe(false);
  });

  it("un pelo por encima del máximo sí acciona", () => {
    expect(rele(TODAS, 25.1, 70)).toBe(true);
  });

  it("un pelo por debajo del mínimo sí acciona", () => {
    expect(rele(TODAS, 19.9, 70)).toBe(true);
    expect(rele(TODAS, 22, 59.9)).toBe(true);
  });

  it("el límite se comporta igual en las alertas: 25 no genera llamado", () => {
    expect(motivosDeAlerta(25, 70)).toEqual([]);
    expect(motivosDeAlerta(25.1, 70)).toEqual([MOTIVOS.TEMP_ALTA]);
  });
});

// ---------------------------------------------------------------------
describe("lecturas sin dato", () => {
  it("una magnitud en null no puede encender el actuador", () => {
    expect(rele(TODAS, null, 70)).toBe(false);
    expect(rele(TODAS, 22, null)).toBe(false);
    expect(rele(TODAS, null, null)).toBe(false);
  });

  it("la otra magnitud sí puede, si está fuera de rango", () => {
    expect(rele(TODAS, null, 48)).toBe(true);
    expect(rele(TODAS, 27, null)).toBe(true);
  });

  it("null no genera condición ni alerta", () => {
    expect(condicionesDeLectura(UMBRALES, { temperatura: null, humedad: null })).toEqual([]);
    expect(motivosDeAlerta(null, null)).toEqual([]);
  });

  it("NaN se trata como sin dato", () => {
    expect(rele(TODAS, Number.NaN, 70)).toBe(false);
  });
});

// ---------------------------------------------------------------------
describe("área dada de baja", () => {
  it("el actuador queda apagado aunque la condición esté marcada y se cumpla", () => {
    const decision = decidirActuadorDeArea(
      { ...TODAS, ...UMBRALES, activa: false },
      { temperatura: 27, humedad: 48 },
    );
    expect(decision.encendido).toBe(false);
  });

  it("pero sigue informando qué condiciones se cumplen", () => {
    const decision = decidirActuadorDeArea(
      { ...TODAS, ...UMBRALES, activa: false },
      { temperatura: 27, humedad: 48 },
    );
    expect(decision.condiciones).toEqual(["TEMP_ALTA", "HUM_BAJA"]);
    expect(decision.motivos).toEqual(["TEMP_ALTA", "HUM_BAJA"]);
  });

  it("con el área activa, la misma lectura sí enciende", () => {
    const decision = decidirActuadorDeArea(
      { ...TODAS, ...UMBRALES, activa: true },
      { temperatura: 27, humedad: 48 },
    );
    expect(decision.encendido).toBe(true);
  });
});

// ---------------------------------------------------------------------
describe("regresión: el backfill de sql/07 reproduce la conducta anterior", () => {
  // Antes del refactor la expresión era, literalmente:
  //   rele = (temp != null && temp > temp_max) || (hum != null && hum < hum_min)
  const anterior = (t: number | null, h: number | null): boolean =>
    (t !== null && Number.isFinite(t) && t > UMBRALES.temp_max) ||
    (h !== null && Number.isFinite(h) && h < UMBRALES.hum_min);

  const temperaturas = [null, 15, 19.9, 20, 22, 25, 25.1, 30, 45];
  const humedades = [null, 30, 59.9, 60, 70, 80, 80.1, 95];

  it("da el MISMO resultado que la expresión vieja en toda la grilla", () => {
    for (const t of temperaturas) {
      for (const h of humedades) {
        expect(
          rele(BACKFILL_07, t, h),
          `temperatura=${t} humedad=${h}`,
        ).toBe(anterior(t, h));
      }
    }
  });

  it("un área que nadie tocó tiene exactamente la configuración del backfill", () => {
    // Es lo que hay hoy en las ocho áreas de la base.
    expect(BACKFILL_07).toEqual({
      auto_temp_baja: false,
      auto_temp_alta: true,
      auto_hum_baja: true,
      auto_hum_alta: false,
    });
  });
});

// ---------------------------------------------------------------------
describe("contrato con lib/alertas.ts", () => {
  // Las dos lógicas están desacopladas a propósito: automatizacion.ts no
  // importa alertas.ts ni al revés. Este test verifica que igual coincidan en
  // qué condiciones detectan, para que no se separen en silencio.
  const temperaturas = [null, -5, 15, 19.9, 20, 22, 25, 25.1, 30, 60];
  const humedades = [null, 0, 30, 59.9, 60, 70, 80, 80.1, 95, 100];

  it("detectan exactamente las mismas condiciones en toda la grilla", () => {
    for (const t of temperaturas) {
      for (const h of humedades) {
        const porAutomatizacion = condicionesDeLectura(UMBRALES, {
          temperatura: t,
          humedad: h,
        })
          .map((c) => MOTIVO_DE[c])
          .sort();

        const porAlertas = motivosDeAlerta(t, h).sort();

        expect(porAutomatizacion, `temperatura=${t} humedad=${h}`).toEqual(
          porAlertas,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------
describe("mapeo de condiciones", () => {
  it("cada condición apunta a su interruptor", () => {
    expect(claveDeCondicion("TEMP_BAJA")).toBe("auto_temp_baja");
    expect(claveDeCondicion("TEMP_ALTA")).toBe("auto_temp_alta");
    expect(claveDeCondicion("HUM_BAJA")).toBe("auto_hum_baja");
    expect(claveDeCondicion("HUM_ALTA")).toBe("auto_hum_alta");
  });

  it("son cuatro y están en el orden del formulario", () => {
    expect(CONDICIONES).toEqual([
      "TEMP_BAJA",
      "TEMP_ALTA",
      "HUM_BAJA",
      "HUM_ALTA",
    ]);
  });

  it("cada una tiene una etiqueta legible", () => {
    expect(CONDICIONES.map(etiquetaCondicion)).toEqual([
      "Temperatura por debajo del mínimo",
      "Temperatura por encima del máximo",
      "Humedad por debajo del mínimo",
      "Humedad por encima del máximo",
    ]);
  });
});
