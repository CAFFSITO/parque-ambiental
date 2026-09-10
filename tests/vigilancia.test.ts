// tests/vigilancia.test.ts
// Decisión pura de la vigilancia de nodos caídos: estaCaido() de
// lib/alertas.ts. No toca la base ni la red.
//
// Existe porque revisarNodosCaidos() CREA llamados de EMERGENCIA. Un error de
// borde acá es o una emergencia falsa en la bandeja del operador, o un nodo
// muerto que nadie mira. Las dos cosas son caras.

import { describe, expect, it } from "vitest";
import { estaCaido, SEGUNDOS_SIN_SENAL, type NodoVigilado } from "@/lib/alertas";
import { estadoDeConexion } from "@/lib/dispositivos";

const AHORA = new Date("2026-09-10T20:00:00.000Z");

function haceSegundos(n: number): string {
  return new Date(AHORA.getTime() - n * 1000).toISOString();
}

function nodo(cambios: Partial<NodoVigilado> = {}): NodoVigilado {
  return {
    dispositivo: "NODO-INV-N-01",
    area_id: 1,
    ultima: haceSegundos(10),
    segundos: 10,
    ...cambios,
  };
}

describe("estaCaido: los bordes del umbral", () => {
  it("el umbral sigue siendo 90 segundos", () => {
    // Si esto falla, cambió lib/alertas.ts y los bordes de abajo ya no son los
    // bordes. Hay que revisar juntas la vigilancia, el tablero y Dispositivos.
    expect(SEGUNDOS_SIN_SENAL).toBe(90);
  });

  it("un segundo antes del umbral no está caído", () => {
    expect(estaCaido(nodo({ segundos: SEGUNDOS_SIN_SENAL - 1 }))).toBe(false);
  });

  it("justo en el umbral todavía NO está caído: el corte es estrictamente mayor", () => {
    expect(estaCaido(nodo({ segundos: SEGUNDOS_SIN_SENAL }))).toBe(false);
  });

  it("un segundo después del umbral está caído", () => {
    expect(estaCaido(nodo({ segundos: SEGUNDOS_SIN_SENAL + 1 }))).toBe(true);
  });

  it("mucho después del umbral sigue caído", () => {
    // Es el punto que la versión anterior perdía: a las 24 horas el nodo
    // desaparecía de la barrida y su llamado dejaba de refrescarse (R10).
    expect(estaCaido(nodo({ segundos: 86_400 * 3 }))).toBe(true);
  });
});

describe("estaCaido: los casos que NO son una emergencia", () => {
  it("un nodo que nunca reportó no está caído", () => {
    // Recién dado de alta todavía no prometió nada. La pantalla de
    // Dispositivos sí lo muestra como 'Nunca reportó'.
    expect(estaCaido(nodo({ segundos: null, ultima: null }))).toBe(false);
  });

  it("un nodo sin área asignada no está caído para esta barrida", () => {
    // No hay a quién avisarle: llamados.area_id es justamente eso.
    expect(estaCaido(nodo({ segundos: 100_000, area_id: null }))).toBe(false);
  });

  it("un nodo sin área y sin contacto tampoco", () => {
    expect(
      estaCaido(nodo({ segundos: null, ultima: null, area_id: null })),
    ).toBe(false);
  });
});

describe("estaCaido coincide con estadoDeConexion de las pantallas", () => {
  // Las dos responden la misma pregunta y tienen que decir lo mismo. Antes el
  // tablero usaba 30 minutos y la vigilancia 90 segundos: esa contradicción es
  // la que no hay que volver a introducir.
  for (const segundos of [0, 1, 89, 90, 91, 3600, 86_400]) {
    it(`a los ${segundos} s ambas coinciden`, () => {
      const sinSenal =
        estadoDeConexion(haceSegundos(segundos), AHORA) === "SIN_SENAL";

      expect(estaCaido(nodo({ segundos, ultima: haceSegundos(segundos) }))).toBe(
        sinSenal,
      );
    });
  }
});
