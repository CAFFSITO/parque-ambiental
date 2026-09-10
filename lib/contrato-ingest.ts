// lib/contrato-ingest.ts
// El contrato de la respuesta 200 de /api/ingest, en forma ejecutable.
//
// FUNCIÓN PURA. No toca la base, no hace red y no importa nada del servidor:
// recibe un cuerpo ya parseado y dice si cumple lo que el nodo necesita. Por
// eso la usan las dos suites — el test unitario para verificar el validador, y
// scripts/probar-ingest.mjs para aplicarlo a respuestas reales.
//
// POR QUÉ EXISTE
//
// El firmware lee exactamente dos campos (.ino:604-608):
//
//     releEncendido = datos["rele"]   | false;
//     alarmaActiva  = datos["alarma"] | false;
//
// El operador `|` de ArduinoJson devuelve el default **sin error** si el campo
// falta, es null, o no es del tipo pedido. Es decir: renombrar `rele`, cambiar
// su tipo o anidarlo bajo otra clave **no produce ningún síntoma**. El relé
// queda apagado para siempre y la sirena muda, con el nodo reportando 200 OK y
// aparentando salud total.
//
// Es el modo de falla más peligroso del sistema: silencioso y sin síntoma. Un
// comentario que pida no renombrarlos no alcanza. Esto sí falla ruidosamente.
//
// Ver documents/contexto/90-firmware.md, invariantes H-1 y H-2.

/** Cómo lee ArduinoJson un campo booleano: `datos[campo] | false`. */
export function comoArduinoJson(cuerpo: unknown, campo: string): boolean {
  if (typeof cuerpo !== "object" || cuerpo === null) return false;
  const valor = (cuerpo as Record<string, unknown>)[campo];
  return typeof valor === "boolean" ? valor : false;
}

/** Los dos campos que el firmware realmente lee. No se negocian. */
export const CAMPOS_QUE_LEE_EL_FIRMWARE = ["rele", "alarma"] as const;

export type ProblemaContrato = {
  campo: string;
  problema: string;
};

export type VeredictoContrato = {
  cumple: boolean;
  problemas: ProblemaContrato[];
  /** Lo que el firmware entendería, aplicando `| false`. */
  leido: { rele: boolean; alarma: boolean };
};

/**
 * Verifica el contrato de una respuesta 200 de /api/ingest.
 *
 * Exige, y en este orden:
 *
 *   1. que el cuerpo sea un objeto (deserializeJson() tiene que poder leerlo);
 *   2. que `ok` sea el literal `true`;
 *   3. que `rele` y `alarma` **existan**, sean **booleanos** y estén **en la
 *      raíz** del objeto, no anidados.
 *
 * El punto 3 cubre los tres modos de ruptura silenciosa del §5.2 de
 * 90-firmware.md: renombrado, cambio de tipo y anidamiento.
 *
 * `ok` se exige aunque el firmware NO lo lea: lo leen el simulador y este
 * script, y si un día dejara de venir sería señal de que la respuesta cambió
 * de forma.
 */
export function verificarContratoIngest(cuerpo: unknown): VeredictoContrato {
  const problemas: ProblemaContrato[] = [];

  const leido = {
    rele: comoArduinoJson(cuerpo, "rele"),
    alarma: comoArduinoJson(cuerpo, "alarma"),
  };

  if (typeof cuerpo !== "object" || cuerpo === null || Array.isArray(cuerpo)) {
    problemas.push({
      campo: "(cuerpo)",
      problema:
        "la respuesta no es un objeto JSON: deserializeJson() del firmware falla " +
        "y el nodo no rearma su failsafe",
    });
    return { cumple: false, problemas, leido };
  }

  const objeto = cuerpo as Record<string, unknown>;

  if (objeto.ok !== true) {
    problemas.push({
      campo: "ok",
      problema: `tiene que ser el literal true, y vino ${JSON.stringify(objeto.ok)}`,
    });
  }

  for (const campo of CAMPOS_QUE_LEE_EL_FIRMWARE) {
    if (!(campo in objeto)) {
      problemas.push({
        campo,
        problema:
          "falta en la raíz. ArduinoJson devolvería false sin error: el nodo " +
          "quedaría apagado y mudo, reportando 200 OK",
      });
      continue;
    }

    if (typeof objeto[campo] !== "boolean") {
      problemas.push({
        campo,
        problema:
          `tiene que ser un booleano JSON y vino ${JSON.stringify(objeto[campo])} ` +
          `(${typeof objeto[campo]}). El operador | de ArduinoJson lo descarta ` +
          `y devuelve false`,
      });
    }
  }

  return { cumple: problemas.length === 0, problemas, leido };
}

/** Una línea legible para el log del script de integración. */
export function resumirContrato(veredicto: VeredictoContrato): string {
  if (veredicto.cumple) {
    return `contrato OK (el firmware lee rele=${veredicto.leido.rele} alarma=${veredicto.leido.alarma})`;
  }
  return veredicto.problemas
    .map((p) => `${p.campo}: ${p.problema}`)
    .join(" · ");
}
