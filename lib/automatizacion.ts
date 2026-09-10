// lib/automatizacion.ts
// Decide si el actuador del nodo (el relé) va encendido.
//
// FUNCIÓN PURA. No toca la base, no lee variables de entorno y no tiene reloj:
// recibe la configuración del área, los umbrales y la lectura, y devuelve la
// decisión. Se puede probar sola.
//
// POR QUÉ EXISTE ESTE ARCHIVO
// Hasta ahora la decisión del relé era una expresión suelta dentro de
// /api/ingest que mezclaba dos preguntas distintas:
//
//     rele = (temperatura > temp_max) || (humedad < hum_min)
//
// Eso conflaba "¿vale la pena accionar algo?" con un subconjunto arbitrario de
// "¿está fuera de rango?". Las dos condiciones que accionaban estaban elegidas
// a mano y no se podían cambiar por área.
//
// LA SEPARACIÓN, QUE NO SE VUELVE A MEZCLAR
//
//   * ALERTAS  -> evaluarDesvios() en lib/alertas.ts. Evalúa SIEMPRE las cuatro
//                 condiciones contra los cuatro umbrales y crea los llamados.
//                 No sabe que este archivo existe.
//   * ACTUADOR -> este archivo. Evalúa las mismas cuatro condiciones pero solo
//                 acciona las que el área tiene marcadas. No crea llamados ni
//                 sabe qué es un llamado.
//
// Los umbrales son los mismos para las dos, y siguen significando lo mismo:
// definen la normalidad. Lo que cambia es qué hace el sistema cuando se salen.
//
// Consecuencia que conviene tener a la vista: desmarcar una casilla apaga una
// bomba, NUNCA apaga una alarma. Un área con la humedad baja desmarcada que se
// seca sigue generando el llamado "Humedad por debajo del umbral"; lo que no
// hace es abrir el riego sola.
//
// lib/alertas.ts NO se modificó para escribir esto. Las dos lógicas quedan
// desacopladas a propósito, y un test de contrato en tests/automatizacion.test.ts
// verifica que sigan coincidiendo en qué condiciones detectan, sin que ninguna
// dependa de la otra.

import type { AutomatizacionArea } from "./tipos";

/** Las cuatro condiciones posibles. Son las mismas que evalúan las alertas. */
export type CondicionActuador =
  | "TEMP_BAJA"
  | "TEMP_ALTA"
  | "HUM_BAJA"
  | "HUM_ALTA";

/** Orden estable, el mismo que usa el formulario del área. */
export const CONDICIONES: readonly CondicionActuador[] = [
  "TEMP_BAJA",
  "TEMP_ALTA",
  "HUM_BAJA",
  "HUM_ALTA",
];

/** Los cuatro interruptores del área. Ver sql/07_automatizacion_areas.sql. */
export type ConfiguracionActuador = AutomatizacionArea;

/** Los cuatro umbrales del área. No cambian de significado. */
export type UmbralesActuador = {
  temp_min: number;
  temp_max: number;
  hum_min: number;
  hum_max: number;
};

/** Lo que midió el nodo. null significa "no hay dato". */
export type LecturaActuador = {
  temperatura: number | null;
  humedad: number | null;
};

export type OpcionesActuador = {
  /**
   * Un área dada de baja NO acciona.
   *
   * Es una decisión tomada, no un descuido: un área de baja tampoco genera
   * llamados, así que nadie va a estar mirando lo que pase ahí. Dejar el riego
   * o la ventilación corriendo solos en un sector que nadie atiende es
   * exactamente el tipo de cosa que se descubre cuando ya hizo daño.
   *
   * Las condiciones se siguen calculando e informando: lo que se corta es la
   * actuación, no el diagnóstico.
   */
  areaActiva?: boolean;
};

export type DecisionActuador = {
  /** Lo que va en el campo `rele` de la respuesta a /api/ingest. */
  encendido: boolean;
  /** Condiciones que la lectura cumple, estén marcadas o no. Diagnóstico. */
  condiciones: CondicionActuador[];
  /** Las que además están marcadas: son las que encendieron el actuador. */
  motivos: CondicionActuador[];
};

/** Cómo se lee cada condición en pantalla. */
export function etiquetaCondicion(condicion: CondicionActuador): string {
  switch (condicion) {
    case "TEMP_BAJA":
      return "Temperatura por debajo del mínimo";
    case "TEMP_ALTA":
      return "Temperatura por encima del máximo";
    case "HUM_BAJA":
      return "Humedad por debajo del mínimo";
    case "HUM_ALTA":
      return "Humedad por encima del máximo";
  }
}

/** Qué interruptor gobierna cada condición. */
export function claveDeCondicion(
  condicion: CondicionActuador,
): keyof ConfiguracionActuador {
  switch (condicion) {
    case "TEMP_BAJA":
      return "auto_temp_baja";
    case "TEMP_ALTA":
      return "auto_temp_alta";
    case "HUM_BAJA":
      return "auto_hum_baja";
    case "HUM_ALTA":
      return "auto_hum_alta";
  }
}

/** ¿El área tiene marcada esta condición? */
export function condicionHabilitada(
  configuracion: ConfiguracionActuador,
  condicion: CondicionActuador,
): boolean {
  return configuracion[claveDeCondicion(condicion)] === true;
}

/**
 * Qué condiciones cumple esta lectura, sin mirar la configuración.
 *
 * Las comparaciones son ESTRICTAS, igual que en las alertas: estar exactamente
 * en el límite no es estar afuera. 25,0 °C con un máximo de 25 no es "por
 * encima del máximo".
 *
 * Una magnitud en null no puede cumplir ninguna condición: sin dato no hay
 * nada que decidir, y accionar por un sensor roto es peor que no accionar.
 *
 * Los umbrales se pasan por Number() porque PostgREST puede devolver las
 * columnas numeric como texto, y "25" > 30 compararía como cadenas.
 */
export function condicionesDeLectura(
  umbrales: UmbralesActuador,
  lectura: LecturaActuador,
): CondicionActuador[] {
  const condiciones: CondicionActuador[] = [];

  const tempMin = Number(umbrales.temp_min);
  const tempMax = Number(umbrales.temp_max);
  const humMin = Number(umbrales.hum_min);
  const humMax = Number(umbrales.hum_max);

  const temperatura = lectura.temperatura;
  const humedad = lectura.humedad;

  if (temperatura !== null && Number.isFinite(temperatura)) {
    if (temperatura < tempMin) condiciones.push("TEMP_BAJA");
    if (temperatura > tempMax) condiciones.push("TEMP_ALTA");
  }

  if (humedad !== null && Number.isFinite(humedad)) {
    if (humedad < humMin) condiciones.push("HUM_BAJA");
    if (humedad > humMax) condiciones.push("HUM_ALTA");
  }

  // Orden estable, independiente del orden de los ifs.
  return CONDICIONES.filter((condicion) => condiciones.includes(condicion));
}

/**
 * La decisión completa.
 *
 * El actuador se enciende si y solo si la lectura cumple al menos una
 * condición QUE EL ÁREA TENGA MARCADA. Sin ninguna casilla marcada, el
 * actuador nunca se enciende, por más alertas que haya.
 */
export function decidirActuador(
  configuracion: ConfiguracionActuador,
  umbrales: UmbralesActuador,
  lectura: LecturaActuador,
  opciones: OpcionesActuador = {},
): DecisionActuador {
  const condiciones = condicionesDeLectura(umbrales, lectura);
  const motivos = condiciones.filter((condicion) =>
    condicionHabilitada(configuracion, condicion),
  );

  const areaActiva = opciones.areaActiva !== false;

  return {
    encendido: areaActiva && motivos.length > 0,
    condiciones,
    motivos,
  };
}

/** Atajo para quien solo quiere el booleano. */
export function actuadorEncendido(
  configuracion: ConfiguracionActuador,
  umbrales: UmbralesActuador,
  lectura: LecturaActuador,
  opciones: OpcionesActuador = {},
): boolean {
  return decidirActuador(configuracion, umbrales, lectura, opciones).encendido;
}

/**
 * Envoltorio para el caso habitual: un área ya leída de la base, que trae
 * juntos los interruptores, los umbrales y su estado de alta o baja.
 */
export function decidirActuadorDeArea(
  area: ConfiguracionActuador & UmbralesActuador & { activa: boolean },
  lectura: LecturaActuador,
): DecisionActuador {
  return decidirActuador(area, area, lectura, { areaActiva: area.activa });
}
