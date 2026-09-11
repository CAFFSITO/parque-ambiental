// lib/motivos.ts
// Motivos de llamado manual, por tipo. SOLO servidor.
//
// La base de cada tipo vive en el código (MOTIVOS_MANUALES_POR_TIPO, en
// lib/catalogos.ts). Lo que la gente agrega desde la ficha de nuevo llamado se
// guarda en la tabla `ajustes`, bajo una sola clave, como JSON con los extras
// de cada tipo. No hace falta ninguna migración: `ajustes` ya existe
// (sql/05_avisos.sql).
//
// DOS REGLAS
//
//   1. Un motivo pertenece a UN tipo. Si ya existe como EMERGENCIA no se puede
//      crear como NORMAL: el mismo texto con dos tipos haría ambiguo el
//      antirrebote, que agrupa por (área, motivo).
//   2. Los motivos que genera el sistema (temperatura, humedad, sensor sin
//      señal) no se pueden crear a mano. Un llamado manual con ese texto se
//      mezclaría con los del sensor en el antirrebote.
//
// Límite conocido: dos personas creando un motivo en el mismo instante pueden
// pisarse (se lee, se agrega y se guarda la fila entera). Con la frecuencia
// con que se crean motivos, se acepta.

import "server-only";
import { guardarAjuste, leerAjuste } from "./avisos";
import {
  LARGO_MAXIMO_MOTIVO,
  LISTA_MOTIVOS,
  MOTIVOS_MANUALES_POR_TIPO,
} from "./catalogos";
import type { TipoLlamado } from "./tipos";

const CLAVE = "motivos_manuales";

export type MotivosPorTipo = Record<TipoLlamado, string[]>;

const TIPOS: readonly TipoLlamado[] = ["NORMAL", "EMERGENCIA"];

/** Espacios colapsados, sin bordes, primera letra en mayúscula, largo acotado. */
export function normalizarMotivo(texto: string): string {
  const limpio = texto.replace(/\s+/g, " ").trim().slice(0, LARGO_MAXIMO_MOTIVO);
  return limpio.charAt(0).toLocaleUpperCase("es-AR") + limpio.slice(1);
}

const clave = (texto: string) => texto.toLocaleLowerCase("es-AR");

/** Base + extras, sin repetidos (sin distinguir mayúsculas), la base primero. */
export function combinarMotivos(extras: Partial<MotivosPorTipo>): MotivosPorTipo {
  const resultado = {} as MotivosPorTipo;

  for (const tipo of TIPOS) {
    const vistos = new Set<string>();
    const lista: string[] = [];
    for (const motivo of [...MOTIVOS_MANUALES_POR_TIPO[tipo], ...(extras[tipo] ?? [])]) {
      if (typeof motivo !== "string" || motivo === "") continue;
      if (vistos.has(clave(motivo))) continue;
      vistos.add(clave(motivo));
      lista.push(motivo);
    }
    resultado[tipo] = lista;
  }

  return resultado;
}

/** Los extras guardados. Si el JSON está roto o no existe, no hay extras. */
async function leerExtras(): Promise<MotivosPorTipo> {
  const vacio: MotivosPorTipo = { NORMAL: [], EMERGENCIA: [] };
  try {
    const crudo = JSON.parse(await leerAjuste(CLAVE, "{}")) as Record<string, unknown>;
    for (const tipo of TIPOS) {
      const lista = crudo?.[tipo];
      if (Array.isArray(lista)) {
        vacio[tipo] = lista.filter((m): m is string => typeof m === "string");
      }
    }
  } catch {
    // Un ajuste ilegible no puede dejar a nadie sin poder crear un llamado.
  }
  return vacio;
}

/** Los motivos que se ofrecen hoy, por tipo. */
export async function leerMotivos(): Promise<MotivosPorTipo> {
  return combinarMotivos(await leerExtras());
}

/**
 * Decide si un texto nuevo se puede agregar a un tipo. Pura, para poder
 * probarla. Devuelve el motivo normalizado o el motivo del rechazo.
 */
export function validarMotivoNuevo(
  tipo: TipoLlamado,
  texto: string,
  actuales: MotivosPorTipo,
): { ok: true; motivo: string } | { ok: false; error: string } {
  const motivo = normalizarMotivo(texto);

  if (motivo.length < 3) {
    return { ok: false, error: "Escribí un motivo de al menos 3 caracteres." };
  }

  if (actuales[tipo].some((m) => clave(m) === clave(motivo))) {
    return { ok: false, error: "Ese motivo ya existe para este tipo." };
  }

  const otro: TipoLlamado = tipo === "NORMAL" ? "EMERGENCIA" : "NORMAL";
  if (actuales[otro].some((m) => clave(m) === clave(motivo))) {
    return {
      ok: false,
      error: `Ese motivo ya existe como ${otro === "NORMAL" ? "normal" : "emergencia"}. Elegilo cambiando el tipo.`,
    };
  }

  const delSistema = LISTA_MOTIVOS.filter(
    (m) => !MOTIVOS_MANUALES_POR_TIPO.NORMAL.includes(m) &&
      !MOTIVOS_MANUALES_POR_TIPO.EMERGENCIA.includes(m),
  );
  if (delSistema.some((m) => clave(m) === clave(motivo))) {
    return {
      ok: false,
      error: "Ese motivo lo genera el sistema a partir de los sensores y no se puede cargar a mano.",
    };
  }

  return { ok: true, motivo };
}

/** Agrega un motivo a un tipo y devuelve la lista actualizada. */
export async function agregarMotivo(
  tipo: TipoLlamado,
  texto: string,
  usuario: string,
): Promise<
  | { ok: true; motivo: string; motivos: MotivosPorTipo }
  | { ok: false; error: string }
> {
  const extras = await leerExtras();
  const validacion = validarMotivoNuevo(tipo, texto, combinarMotivos(extras));
  if (!validacion.ok) return validacion;

  extras[tipo] = [...extras[tipo], validacion.motivo];

  const error = await guardarAjuste(CLAVE, JSON.stringify(extras), usuario);
  if (error) return { ok: false, error: "No se pudo guardar el motivo. Probá de nuevo." };

  return { ok: true, motivo: validacion.motivo, motivos: combinarMotivos(extras) };
}
