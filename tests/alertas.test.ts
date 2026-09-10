// tests/alertas.test.ts
// Decisiones puras de lib/alertas.ts: no tocan la base ni la red.
//
// Cubre las tres piezas que deciden si un desvío se convierte en un llamado y
// de qué tipo:
//
//   1. evaluarDesvios()    -> las cuatro condiciones contra los cuatro umbrales
//   2. los márgenes        -> cuándo un desvío es NORMAL y cuándo EMERGENCIA
//   3. decidirAntirrebote() -> crear, escalar o refrescar
//
// El antirrebote completo —la consulta, el update y el insert— se prueba contra
// la base real en scripts/probar-ingest.mjs. Acá va la regla, que es lo que se
// puede probar sin simular un cliente de Supabase que solo confirmaría que el
// simulacro coincide consigo mismo.

import { describe, expect, it } from "vitest";
import {
  decidirAntirrebote,
  detalleDeDesvio,
  evaluarDesvios,
  MARGEN_HUM_NORMAL,
  MARGEN_TEMP_NORMAL,
  type Desvio,
} from "@/lib/alertas";
import { MOTIVOS } from "@/lib/catalogos";

/** INV-N tal como está en la base: 20–25 °C y 60–80 %. */
const AREA = {
  id: 1,
  codigo: "INV-N",
  nombre: "Invernadero Norte",
  temp_min: 20,
  temp_max: 25,
  hum_min: 60,
  hum_max: 80,
};

/** Atajo: los motivos que devuelve una lectura, en orden. */
function motivos(temperatura: number | null, humedad: number | null): string[] {
  return evaluarDesvios(AREA, temperatura, humedad).map((d) => d.motivo);
}

/** Atajo: el desvío de una sola magnitud fuera de rango. */
function unico(temperatura: number | null, humedad: number | null): Desvio {
  const desvios = evaluarDesvios(AREA, temperatura, humedad);
  expect(desvios).toHaveLength(1);
  return desvios[0];
}

describe("evaluarDesvios: los cuatro desvíos", () => {
  it("temperatura por encima del máximo", () => {
    const desvio = unico(27, 70);
    expect(desvio.motivo).toBe(MOTIVOS.TEMP_ALTA);
    expect(desvio.unidad).toBe("°C");
    expect(desvio.medido).toBe(27);
    expect(desvio.limite).toBe(25);
    expect(desvio.magnitud).toBe(2);
  });

  it("temperatura por debajo del mínimo", () => {
    const desvio = unico(18, 70);
    expect(desvio.motivo).toBe(MOTIVOS.TEMP_BAJA);
    expect(desvio.limite).toBe(20);
    expect(desvio.magnitud).toBe(2);
  });

  it("humedad por encima del máximo", () => {
    const desvio = unico(22, 85);
    expect(desvio.motivo).toBe(MOTIVOS.HUM_ALTA);
    expect(desvio.unidad).toBe("%");
    expect(desvio.limite).toBe(80);
    expect(desvio.magnitud).toBe(5);
  });

  it("humedad por debajo del mínimo", () => {
    const desvio = unico(22, 48);
    expect(desvio.motivo).toBe(MOTIVOS.HUM_BAJA);
    expect(desvio.limite).toBe(60);
    expect(desvio.magnitud).toBe(12);
  });

  it("dentro de rango no genera ningún desvío", () => {
    expect(evaluarDesvios(AREA, 22, 70)).toEqual([]);
  });

  it("las cuatro son excluyentes por magnitud: nunca alta y baja a la vez", () => {
    for (const temperatura of [10, 18, 20, 22, 25, 27, 40]) {
      const encontrados = motivos(temperatura, 70);
      expect(
        encontrados.includes(MOTIVOS.TEMP_ALTA) &&
          encontrados.includes(MOTIVOS.TEMP_BAJA),
      ).toBe(false);
    }
  });

  it("temperatura y humedad son dos problemas distintos y se informan los dos", () => {
    // Es la razón por la que devuelve un arreglo y no un solo desvío.
    expect(motivos(27, 48)).toEqual([MOTIVOS.TEMP_ALTA, MOTIVOS.HUM_BAJA]);
    expect(motivos(18, 85)).toEqual([MOTIVOS.TEMP_BAJA, MOTIVOS.HUM_ALTA]);
  });

  it("la temperatura se informa antes que la humedad, siempre", () => {
    // El orden es estable porque alimenta el detalle de dos llamados distintos.
    const desvios = evaluarDesvios(AREA, 27, 48);
    expect(desvios[0].unidad).toBe("°C");
    expect(desvios[1].unidad).toBe("%");
  });
});

describe("evaluarDesvios: los límites exactos", () => {
  it("estar justo en el máximo NO es estar fuera de rango", () => {
    expect(evaluarDesvios(AREA, 25, 80)).toEqual([]);
  });

  it("estar justo en el mínimo tampoco", () => {
    expect(evaluarDesvios(AREA, 20, 60)).toEqual([]);
  });

  it("un pelo por encima del máximo sí", () => {
    expect(motivos(25.1, 70)).toEqual([MOTIVOS.TEMP_ALTA]);
    expect(motivos(22, 80.1)).toEqual([MOTIVOS.HUM_ALTA]);
  });

  it("un pelo por debajo del mínimo sí", () => {
    expect(motivos(19.9, 70)).toEqual([MOTIVOS.TEMP_BAJA]);
    expect(motivos(22, 59.9)).toEqual([MOTIVOS.HUM_BAJA]);
  });
});

describe("evaluarDesvios: sin dato", () => {
  it("una magnitud en null no genera desvío por esa magnitud", () => {
    expect(motivos(null, 70)).toEqual([]);
    expect(motivos(22, null)).toEqual([]);
  });

  it("pero la otra magnitud se sigue evaluando", () => {
    expect(motivos(null, 48)).toEqual([MOTIVOS.HUM_BAJA]);
    expect(motivos(27, null)).toEqual([MOTIVOS.TEMP_ALTA]);
  });

  it("las dos en null no generan nada", () => {
    // Es el caso del DHT roto: no se afirma nada sobre lo que no se midió.
    expect(evaluarDesvios(AREA, null, null)).toEqual([]);
  });

  it("NaN e Infinity se tratan como sin dato", () => {
    expect(evaluarDesvios(AREA, Number.NaN, Number.NaN)).toEqual([]);
    expect(evaluarDesvios(AREA, Number.POSITIVE_INFINITY, 70)).toEqual([]);
    expect(evaluarDesvios(AREA, 22, Number.NEGATIVE_INFINITY)).toEqual([]);
  });
});

describe("escalada NORMAL -> EMERGENCIA por MARGEN_TEMP_NORMAL", () => {
  it("el margen de temperatura sigue siendo 3 °C", () => {
    // Si esto falla, cambiaron los bordes de abajo y hay que revisarlos juntos.
    expect(MARGEN_TEMP_NORMAL).toBe(3);
  });

  it("un desvío menor al margen es NORMAL", () => {
    expect(unico(25 + MARGEN_TEMP_NORMAL - 1, 70).tipo).toBe("NORMAL");
  });

  it("un desvío EXACTAMENTE igual al margen todavía es NORMAL", () => {
    // El corte es estrictamente mayor: `magnitud > MARGEN`.
    const desvio = unico(25 + MARGEN_TEMP_NORMAL, 70);
    expect(desvio.magnitud).toBe(MARGEN_TEMP_NORMAL);
    expect(desvio.tipo).toBe("NORMAL");
  });

  it("un desvío apenas mayor al margen ya es EMERGENCIA", () => {
    expect(unico(25 + MARGEN_TEMP_NORMAL + 0.1, 70).tipo).toBe("EMERGENCIA");
  });

  it("el margen rige igual por debajo del mínimo", () => {
    expect(unico(20 - MARGEN_TEMP_NORMAL, 70).tipo).toBe("NORMAL");
    expect(unico(20 - MARGEN_TEMP_NORMAL - 0.1, 70).tipo).toBe("EMERGENCIA");
  });
});

describe("escalada NORMAL -> EMERGENCIA por MARGEN_HUM_NORMAL", () => {
  it("el margen de humedad sigue siendo 10 puntos", () => {
    expect(MARGEN_HUM_NORMAL).toBe(10);
  });

  it("un desvío menor al margen es NORMAL", () => {
    expect(unico(22, 80 + MARGEN_HUM_NORMAL - 1).tipo).toBe("NORMAL");
  });

  it("un desvío EXACTAMENTE igual al margen todavía es NORMAL", () => {
    const desvio = unico(22, 80 + MARGEN_HUM_NORMAL);
    expect(desvio.magnitud).toBe(MARGEN_HUM_NORMAL);
    expect(desvio.tipo).toBe("NORMAL");
  });

  it("un desvío apenas mayor al margen ya es EMERGENCIA", () => {
    expect(unico(22, 80 + MARGEN_HUM_NORMAL + 0.1).tipo).toBe("EMERGENCIA");
  });

  it("el margen rige igual por debajo del mínimo", () => {
    expect(unico(22, 60 - MARGEN_HUM_NORMAL).tipo).toBe("NORMAL");
    expect(unico(22, 60 - MARGEN_HUM_NORMAL - 0.1).tipo).toBe("EMERGENCIA");
  });

  it("los dos márgenes son independientes: 48 % es EMERGENCIA y 27 °C NORMAL", () => {
    // El caso real de INV-N: 12 puntos de humedad pasan el margen de 10, y
    // 2 °C no pasan el de 3.
    const desvios = evaluarDesvios(AREA, 27, 48);
    expect(desvios.map((d) => [d.motivo, d.tipo])).toEqual([
      [MOTIVOS.TEMP_ALTA, "NORMAL"],
      [MOTIVOS.HUM_BAJA, "EMERGENCIA"],
    ]);
  });
});

describe("decidirAntirrebote", () => {
  it("sin llamado abierto, crea uno nuevo", () => {
    expect(decidirAntirrebote(null, "NORMAL")).toBe("crear");
    expect(decidirAntirrebote(undefined, "EMERGENCIA")).toBe("crear");
  });

  it("con uno abierto del mismo tipo, solo refresca el detalle", () => {
    // Esto es el antirrebote: un nodo cada 10 s no puede generar un llamado
    // por reporte.
    expect(decidirAntirrebote({ tipo: "NORMAL" }, "NORMAL")).toBe("refrescar");
    expect(decidirAntirrebote({ tipo: "EMERGENCIA" }, "EMERGENCIA")).toBe(
      "refrescar",
    );
  });

  it("con uno NORMAL abierto y la condición empeorada, escala", () => {
    expect(decidirAntirrebote({ tipo: "NORMAL" }, "EMERGENCIA")).toBe("escalar");
  });

  it("con uno EMERGENCIA abierto y la condición mejorada, NO lo degrada", () => {
    // Una emergencia abierta no se disimula sola porque la lectura siguiente
    // haya mejorado: se atiende o se cierra.
    expect(decidirAntirrebote({ tipo: "EMERGENCIA" }, "NORMAL")).toBe(
      "refrescar",
    );
  });

  it("escalar es la ÚNICA acción que sube de tipo", () => {
    const combinaciones = [
      [null, "NORMAL"],
      [null, "EMERGENCIA"],
      [{ tipo: "NORMAL" as const }, "NORMAL"],
      [{ tipo: "NORMAL" as const }, "EMERGENCIA"],
      [{ tipo: "EMERGENCIA" as const }, "NORMAL"],
      [{ tipo: "EMERGENCIA" as const }, "EMERGENCIA"],
    ] as const;

    const escalan = combinaciones.filter(
      ([abierto, entrante]) => decidirAntirrebote(abierto, entrante) === "escalar",
    );

    expect(escalan).toHaveLength(1);
    expect(escalan[0][0]).toEqual({ tipo: "NORMAL" });
    expect(escalan[0][1]).toBe("EMERGENCIA");
  });
});

describe("detalleDeDesvio", () => {
  const MOMENTO = new Date("2026-09-10T14:30:00.000Z");

  it("dice la lectura, el límite, el desvío, el nodo y la hora", () => {
    const texto = detalleDeDesvio(unico(27, 70), "NODO-INV-N-01", MOMENTO);

    expect(texto).toContain("27,0 °C");
    expect(texto).toContain("25,0 °C");
    expect(texto).toContain("2,0 °C");
    expect(texto).toContain("NODO-INV-N-01");
    // Formateado en hora de Argentina, como todo el panel.
    expect(texto).toContain("10/09/2026 11:30");
  });

  it("usa la unidad correcta para la humedad", () => {
    const texto = detalleDeDesvio(unico(22, 48), "SIM-INV-N", MOMENTO);
    expect(texto).toContain("48,0 %");
    expect(texto).toContain("60,0 %");
    expect(texto).not.toContain("°C");
  });
});
