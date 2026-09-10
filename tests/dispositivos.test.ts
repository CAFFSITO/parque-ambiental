// tests/dispositivos.test.ts
// Decisiones puras de lib/dispositivos.ts: no tocan la base ni la red.

import { describe, expect, it } from "vitest";
import { SEGUNDOS_SIN_SENAL } from "@/lib/alertas";
import {
  codigoValido,
  conEstado,
  decidirArea,
  esFisico,
  estaEnLinea,
  estadoDeConexion,
  LARGO_MAXIMO_CODIGO,
  normalizarCodigo,
  puedeOperar,
  segundosSinReportar,
} from "@/lib/dispositivos";
import type { AreaConAutomatizacion, Dispositivo } from "@/lib/tipos";

const AHORA = new Date("2026-09-09T20:00:00.000Z");

/** Instante que quedó a N segundos de AHORA. */
function haceSegundos(n: number): string {
  return new Date(AHORA.getTime() - n * 1000).toISOString();
}

function dispositivo(cambios: Partial<Dispositivo> = {}): Dispositivo {
  return {
    id: 11,
    codigo: "NODO-INV-N-01",
    nombre: "Nodo Invernadero Norte",
    modelo: "ESP32-S3-Zero",
    area_id: 1,
    activo: true,
    naturaleza: "FISICO",
    reporta_temperatura: true,
    reporta_humedad: true,
    reporta_boton: true,
    acciona_rele: true,
    acciona_alarma: true,
    ultimo_contacto_en: haceSegundos(10),
    observaciones: null,
    creado_en: "2026-09-09T00:00:00.000Z",
    ...cambios,
  };
}

function area(cambios: Partial<AreaConAutomatizacion> = {}): AreaConAutomatizacion {
  return {
    id: 1,
    codigo: "INV-N",
    nombre: "Invernadero Norte",
    tipo: "invernadero",
    temp_min: 20,
    temp_max: 25,
    hum_min: 60,
    hum_max: 80,
    activa: true,
    creada_en: "2026-09-01T00:00:00.000Z",
    auto_temp_alta: true,
    auto_temp_baja: false,
    auto_hum_alta: false,
    auto_hum_baja: true,
    ...cambios,
  };
}

describe("segundosSinReportar", () => {
  it("devuelve null si el dispositivo nunca reportó", () => {
    expect(segundosSinReportar(null, AHORA)).toBeNull();
    expect(segundosSinReportar(undefined, AHORA)).toBeNull();
  });

  it("devuelve null si la fecha es ilegible", () => {
    expect(segundosSinReportar("no es una fecha", AHORA)).toBeNull();
  });

  it("cuenta los segundos transcurridos", () => {
    expect(segundosSinReportar(haceSegundos(45), AHORA)).toBe(45);
  });

  it("acepta un Date además de un string", () => {
    const momento = new Date(AHORA.getTime() - 30_000);
    expect(segundosSinReportar(momento, AHORA)).toBe(30);
  });

  it("recorta en cero un reporte con fecha futura, en vez de devolver negativo", () => {
    const futuro = new Date(AHORA.getTime() + 60_000).toISOString();
    expect(segundosSinReportar(futuro, AHORA)).toBe(0);
  });
});

describe("estadoDeConexion en los bordes de SEGUNDOS_SIN_SENAL", () => {
  it("el umbral compartido con la vigilancia es 90 segundos", () => {
    // Si esto falla, cambió lib/alertas.ts y los bordes de abajo ya no son
    // los bordes: hay que revisar las dos pantallas juntas.
    expect(SEGUNDOS_SIN_SENAL).toBe(90);
  });

  it("un segundo antes del umbral sigue en línea", () => {
    expect(estadoDeConexion(haceSegundos(SEGUNDOS_SIN_SENAL - 1), AHORA)).toBe(
      "EN_LINEA",
    );
  });

  it("justo en el umbral todavía está en línea: el corte es estrictamente mayor", () => {
    // Es el mismo criterio que revisarNodosCaidos(), que compara
    // `nodo.segundos > SEGUNDOS_SIN_SENAL`. A los 90 exactos no está caído.
    expect(estadoDeConexion(haceSegundos(SEGUNDOS_SIN_SENAL), AHORA)).toBe(
      "EN_LINEA",
    );
  });

  it("un segundo después del umbral se lo considera sin señal", () => {
    expect(estadoDeConexion(haceSegundos(SEGUNDOS_SIN_SENAL + 1), AHORA)).toBe(
      "SIN_SENAL",
    );
  });

  it("mucho después del umbral sigue sin señal", () => {
    expect(estadoDeConexion(haceSegundos(86_400), AHORA)).toBe("SIN_SENAL");
  });

  it("nunca haber reportado es un estado distinto de estar sin señal", () => {
    expect(estadoDeConexion(null, AHORA)).toBe("NUNCA_REPORTO");
  });

  it("estaEnLinea coincide con estadoDeConexion", () => {
    expect(estaEnLinea(haceSegundos(SEGUNDOS_SIN_SENAL), AHORA)).toBe(true);
    expect(estaEnLinea(haceSegundos(SEGUNDOS_SIN_SENAL + 1), AHORA)).toBe(false);
    expect(estaEnLinea(null, AHORA)).toBe(false);
  });
});

describe("puedeOperar", () => {
  it("un dispositivo activo puede operar", () => {
    expect(puedeOperar(dispositivo({ activo: true }))).toBe(true);
  });

  it("un dispositivo dado de baja no puede operar", () => {
    expect(puedeOperar(dispositivo({ activo: false }))).toBe(false);
  });
});

describe("esFisico", () => {
  it("distingue el hardware real del simulador", () => {
    expect(esFisico(dispositivo({ naturaleza: "FISICO" }))).toBe(true);
    expect(esFisico(dispositivo({ naturaleza: "SIMULADO" }))).toBe(false);
  });
});

describe("decidirArea", () => {
  it("resuelve el área asignada con sus umbrales y su automatización", () => {
    const resolucion = decidirArea(dispositivo({ area_id: 1 }), area());

    expect(resolucion.estado).toBe("CON_AREA");
    expect(resolucion.area?.codigo).toBe("INV-N");
    expect(resolucion.area?.temp_max).toBe(25);
    expect(resolucion.area?.auto_temp_alta).toBe(true);
    expect(resolucion.area?.auto_hum_baja).toBe(true);
  });

  it("un dispositivo sin área no tiene umbrales ni automatización", () => {
    const resolucion = decidirArea(dispositivo({ area_id: null }), null);

    expect(resolucion.estado).toBe("SIN_AREA");
    expect(resolucion.area).toBeNull();
  });

  it("no consulta el área si el dispositivo no tiene ninguna asignada", () => {
    // Aunque le pasen un área, sin area_id la respuesta es SIN_AREA.
    const resolucion = decidirArea(dispositivo({ area_id: null }), area());
    expect(resolucion.estado).toBe("SIN_AREA");
  });

  it("avisa si el área asignada no existe", () => {
    const resolucion = decidirArea(dispositivo({ area_id: 99 }), null);

    expect(resolucion.estado).toBe("AREA_INEXISTENTE");
    expect(resolucion.area).toBeNull();
  });
});

describe("conEstado", () => {
  it("agrega el estado de conexión y los segundos sin reportar", () => {
    const fila = conEstado(
      dispositivo({ ultimo_contacto_en: haceSegundos(120) }),
      AHORA,
    );

    expect(fila.conexion).toBe("SIN_SENAL");
    expect(fila.segundos_sin_reportar).toBe(120);
    expect(fila.codigo).toBe("NODO-INV-N-01");
  });

  it("deja en null los segundos de un dispositivo que nunca reportó", () => {
    const fila = conEstado(dispositivo({ ultimo_contacto_en: null }), AHORA);

    expect(fila.conexion).toBe("NUNCA_REPORTO");
    expect(fila.segundos_sin_reportar).toBeNull();
  });
});

describe("códigos de dispositivo", () => {
  it("acepta el código que está grabado en el firmware", () => {
    expect(codigoValido("NODO-INV-N-01")).toBe(true);
  });

  it("acepta el formato de los identificadores sembrados", () => {
    expect(codigoValido("ESP32-INV-N")).toBe(true);
  });

  it("rechaza el vacío y los espacios al borde", () => {
    expect(codigoValido("")).toBe(false);
    expect(codigoValido(" NODO-INV-N-01")).toBe(false);
    expect(codigoValido("NODO-INV-N-01 ")).toBe(false);
  });

  it("acepta el largo máximo y rechaza uno más", () => {
    expect(codigoValido("A".repeat(LARGO_MAXIMO_CODIGO))).toBe(true);
    expect(codigoValido("A".repeat(LARGO_MAXIMO_CODIGO + 1))).toBe(false);
  });

  it("normalizar recorta los bordes pero no cambia mayúsculas", () => {
    // El firmware distingue: "nodo-inv-n-01" no es "NODO-INV-N-01".
    expect(normalizarCodigo("  NODO-INV-N-01  ")).toBe("NODO-INV-N-01");
    expect(normalizarCodigo("nodo-inv-n-01")).toBe("nodo-inv-n-01");
  });

  it("normalizar deja un código válido incluso si venía demasiado largo", () => {
    expect(codigoValido(normalizarCodigo("A".repeat(200)))).toBe(true);
  });
});
