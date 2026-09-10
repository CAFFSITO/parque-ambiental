// lib/borrado.ts
// Borrado definitivo de áreas y de empleados. SOLO servidor: nunca importar
// este módulo desde un componente marcado con "use client".
//
// Este módulo NO verifica roles. La puerta está en la página y en la Server
// Action, que llaman exigirAdmin() antes de invocar cualquier cosa de acá. Es
// el patrón del resto del proyecto.
//
// LA REGLA, Y POR QUÉ NO ES LA MISMA QUE DAR DE BAJA
//
// Dar de baja y borrar responden preguntas distintas:
//
//   * **Dar de baja** dice "esto ya no opera". El área o el empleado dejan de
//     figurar como activos, y toda su historia queda. Es reversible.
//   * **Borrar** dice "esto nunca tuvo que existir". Es para el área que se
//     creó con el código mal escrito, o el empleado cargado dos veces. **No
//     es reversible.**
//
// Por eso solo se puede borrar lo que **no dejó rastro**. Un área con lecturas
// o llamados tiene historia, y la historia no se tira: esa área se da de baja.
// Es el mismo criterio que ya rige para los dispositivos
// (lib/dispositivos.ts, eliminarDispositivo) y el invariante I-12 de
// 30-modelo-dispositivos.md.
//
// "NO SÉ" ES "NO". Si no se puede contar lo que cuelga, no se borra. Un
// borrado a ciegas no tiene vuelta atrás.

import "server-only";
import { COLUMNA_INEXISTENTE, COLUMNA_SIN_CACHE, db } from "./db";

/** PostgREST avisa así cuando la función no existe todavía. */
function esFuncionAusente(codigo: string | undefined): boolean {
  return (
    codigo === "PGRST202" ||
    codigo === "42883" ||
    codigo === COLUMNA_INEXISTENTE ||
    codigo === COLUMNA_SIN_CACHE
  );
}

// ---------------------------------------------------------------------
// TIPOS
// ---------------------------------------------------------------------

/** Lo que cuelga de un área. Todo lo que sea mayor que cero la bloquea. */
export type DependenciasArea = {
  lecturas: number;
  llamados: number;
  empleados: number;
  usuarios: number;
  dispositivos: number;
};

/**
 * Lo que cuelga de un empleado.
 *
 * `llamados_legajo` **no bloquea**: `llamados.creado_por` y `atendido_por` son
 * texto libre sin clave foránea, así que una coincidencia con el legajo puede
 * ser real o casual. Se informa para que quien borre lo sepa, y nada más.
 */
export type DependenciasEmpleado = {
  usuarios: number;
  llamados_legajo: number;
};

export type MapaDependencias<T> = {
  /** id -> dependencias. */
  por: Map<number, T>;
  /** false si falta sql/12: sin conteo no se ofrece borrar. */
  disponible: boolean;
};

// ---------------------------------------------------------------------
// DECISIONES PURAS
//
// Sin base de datos y sin efectos. Reciben conteos ya leídos y devuelven la
// decisión, para poder probarlas de verdad.
// ---------------------------------------------------------------------

/**
 * Por qué NO se puede borrar un área, en lenguaje de operador.
 *
 * Devuelve un motivo por cada dependencia que la bloquea, en el orden en que
 * conviene resolverlos: primero lo que es historia y no se puede mover
 * (lecturas, llamados), después lo que sí se puede reasignar.
 *
 * Arreglo vacío significa que se puede borrar.
 */
export function bloqueosDeArea(dep: DependenciasArea): string[] {
  const motivos: string[] = [];
  const plural = (n: number, uno: string, varios: string) =>
    `${n} ${n === 1 ? uno : varios}`;

  if (dep.lecturas > 0) {
    motivos.push(`${plural(dep.lecturas, "lectura registrada", "lecturas registradas")}`);
  }
  if (dep.llamados > 0) {
    motivos.push(`${plural(dep.llamados, "llamado", "llamados")}`);
  }
  if (dep.dispositivos > 0) {
    motivos.push(
      `${plural(dep.dispositivos, "dispositivo asignado", "dispositivos asignados")}`,
    );
  }
  if (dep.empleados > 0) {
    motivos.push(`${plural(dep.empleados, "empleado asignado", "empleados asignados")}`);
  }
  if (dep.usuarios > 0) {
    motivos.push(`${plural(dep.usuarios, "usuario asignado", "usuarios asignados")}`);
  }

  return motivos;
}

/** Atajo booleano de bloqueosDeArea(). */
export function puedeBorrarseArea(dep: DependenciasArea): boolean {
  return bloqueosDeArea(dep).length === 0;
}

/**
 * Por qué NO se puede borrar un empleado.
 *
 * Solo bloquea el usuario ligado, que es la única referencia con clave
 * foránea. Los llamados con su legajo se informan aparte, sin bloquear.
 */
export function bloqueosDeEmpleado(dep: DependenciasEmpleado): string[] {
  if (dep.usuarios > 0) {
    return [
      `${dep.usuarios} ${dep.usuarios === 1 ? "usuario ligado" : "usuarios ligados"}`,
    ];
  }
  return [];
}

/** Atajo booleano de bloqueosDeEmpleado(). */
export function puedeBorrarseEmpleado(dep: DependenciasEmpleado): boolean {
  return bloqueosDeEmpleado(dep).length === 0;
}

/**
 * El texto que ve el operador cuando el borrado se rechaza.
 *
 * Dice qué lo bloquea y qué hacer en su lugar, porque un "no se puede" sin
 * salida es una pantalla que no ayuda.
 */
export function motivoDelRechazo(
  que: string,
  bloqueos: string[],
  alternativa: string,
): string {
  return `${que} tiene ${bloqueos.join(", ")}. ${alternativa}`;
}

// ---------------------------------------------------------------------
// LECTURA
// ---------------------------------------------------------------------

type FilaArea = {
  area_id: number;
  lecturas: number | string;
  llamados: number | string;
  empleados: number | string;
  usuarios: number | string;
  dispositivos: number | string;
};

type FilaEmpleado = {
  empleado_id: number;
  usuarios: number | string;
  llamados_legajo: number | string;
};

/**
 * Dependencias de todas las áreas, en una sola consulta.
 *
 * Usa areas_dependencias() de sql/12. Si esa migración todavía no se corrió,
 * devuelve `disponible: false` y ningún conteo: la pantalla deja de ofrecer
 * borrar y lo dice. No hay camino de respaldo con consultas sueltas a
 * propósito — serían cuarenta viajes a la base en cada carga.
 */
export async function dependenciasDeAreas(): Promise<
  MapaDependencias<DependenciasArea>
> {
  const por = new Map<number, DependenciasArea>();

  const { data, error } = await db().rpc("areas_dependencias");

  if (error) {
    if (!esFuncionAusente(error.code)) {
      console.error(
        `[borrado] no se pudieron leer las dependencias de las áreas: ${error.message}`,
      );
    }
    return { por, disponible: false };
  }

  for (const fila of (Array.isArray(data) ? data : []) as FilaArea[]) {
    por.set(fila.area_id, {
      lecturas: Number(fila.lecturas),
      llamados: Number(fila.llamados),
      empleados: Number(fila.empleados),
      usuarios: Number(fila.usuarios),
      dispositivos: Number(fila.dispositivos),
    });
  }

  return { por, disponible: true };
}

/** Dependencias de todos los empleados, en una sola consulta. */
export async function dependenciasDeEmpleados(): Promise<
  MapaDependencias<DependenciasEmpleado>
> {
  const por = new Map<number, DependenciasEmpleado>();

  const { data, error } = await db().rpc("empleados_dependencias");

  if (error) {
    if (!esFuncionAusente(error.code)) {
      console.error(
        `[borrado] no se pudieron leer las dependencias de los empleados: ${error.message}`,
      );
    }
    return { por, disponible: false };
  }

  for (const fila of (Array.isArray(data) ? data : []) as FilaEmpleado[]) {
    por.set(fila.empleado_id, {
      usuarios: Number(fila.usuarios),
      llamados_legajo: Number(fila.llamados_legajo),
    });
  }

  return { por, disponible: true };
}

// ---------------------------------------------------------------------
// BORRADO
//
// Las dos funciones vuelven a contar antes de borrar. El conteo que usó la
// pantalla puede tener minutos: entre que se dibujó el botón y que alguien lo
// apretó, otro administrador pudo asignarle un dispositivo al área.
// ---------------------------------------------------------------------

/** Vuelve a contar lo que cuelga de UN área, sin depender de sql/12. */
async function contarArea(id: number): Promise<DependenciasArea | null> {
  const contar = async (
    tabla: string,
    columna: string,
  ): Promise<number | null> => {
    const { count, error } = await db()
      .from(tabla)
      .select("id", { count: "exact", head: true })
      .eq(columna, id);

    if (error) {
      console.error(`[borrado] no se pudo contar ${tabla}: ${error.message}`);
      return null;
    }
    return count ?? 0;
  };

  // El arreglo areas_ids no tiene clave foránea: hay que mirarlo aparte.
  const contarEmpleados = async (): Promise<number | null> => {
    const { data, error } = await db()
      .from("empleados")
      .select("id")
      .or(`area_id.eq.${id},areas_ids.cs.{${id}}`)
      .overrideTypes<{ id: number }[], { merge: false }>();

    if (error) {
      console.error(`[borrado] no se pudieron contar los empleados: ${error.message}`);
      return null;
    }
    return (data ?? []).length;
  };

  const [lecturas, llamados, empleados, usuarios, dispositivos] = await Promise.all([
    contar("lecturas", "area_id"),
    contar("llamados", "area_id"),
    contarEmpleados(),
    contar("usuarios", "area_id"),
    contar("dispositivos", "area_id"),
  ]);

  if (
    lecturas === null ||
    llamados === null ||
    empleados === null ||
    usuarios === null ||
    dispositivos === null
  ) {
    return null;
  }

  return { lecturas, llamados, empleados, usuarios, dispositivos };
}

/**
 * Borra un área, y solo si no le cuelga nada.
 *
 * Es la ÚNICA función de este módulo que borra un área. Un área con historia
 * no se borra nunca: se da de baja.
 */
export async function eliminarArea(
  id: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(id)) return { ok: false, error: "Identificador inválido." };

  const dependencias = await contarArea(id);
  if (dependencias === null) {
    return {
      ok: false,
      error:
        "No se pudo verificar qué depende del área. No se borró nada: sin certeza no se borra.",
    };
  }

  const bloqueos = bloqueosDeArea(dependencias);
  if (bloqueos.length > 0) {
    return {
      ok: false,
      error: motivoDelRechazo(
        "El área",
        bloqueos,
        "Dala de baja en vez de borrarla, o reasigná lo que cuelga primero. La historia no se tira.",
      ),
    };
  }

  // Se pide de vuelta la fila borrada. Sin esto, un id inexistente afecta cero
  // filas y PostgREST no lo trata como error: la acción respondería "Área
  // eliminada" sin haber borrado nada. Un mensaje de éxito falso en una
  // operación irreversible es peor que un error.
  const { data, error } = await db()
    .from("areas")
    .delete()
    .eq("id", id)
    .select("id")
    .overrideTypes<{ id: number }[], { merge: false }>();

  if (error) {
    // 23503 es violación de clave foránea: algo se creó entre el conteo y el
    // borrado. La base es la última palabra, y está bien que lo sea.
    if (error.code === "23503") {
      return {
        ok: false,
        error:
          "Algo quedó apuntando al área entre la verificación y el borrado. No se borró nada. Volvé a intentar.",
      };
    }
    return { ok: false, error: `No se pudo borrar el área: ${error.message}` };
  }

  if ((data ?? []).length === 0) {
    return { ok: false, error: "Esa área ya no existe. No se borró nada." };
  }

  return { ok: true };
}

/** Vuelve a contar lo que cuelga de UN empleado. */
async function contarEmpleado(id: number): Promise<DependenciasEmpleado | null> {
  const { count, error } = await db()
    .from("usuarios")
    .select("id", { count: "exact", head: true })
    .eq("empleado_id", id);

  if (error) {
    console.error(`[borrado] no se pudieron contar los usuarios: ${error.message}`);
    return null;
  }

  return { usuarios: count ?? 0, llamados_legajo: 0 };
}

/**
 * Borra un empleado, y solo si no tiene un usuario ligado.
 *
 * A diferencia del área, un empleado con llamados en su historial SÍ se puede
 * borrar: `llamados.creado_por` y `atendido_por` son texto y no se rompen. Lo
 * que se pierde es poder resolver ese texto a una ficha, y la pantalla lo
 * advierte antes de confirmar.
 */
export async function eliminarEmpleado(
  id: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(id)) return { ok: false, error: "Identificador inválido." };

  const dependencias = await contarEmpleado(id);
  if (dependencias === null) {
    return {
      ok: false,
      error:
        "No se pudo verificar si el empleado tiene un usuario ligado. No se borró nada: sin certeza no se borra.",
    };
  }

  const bloqueos = bloqueosDeEmpleado(dependencias);
  if (bloqueos.length > 0) {
    return {
      ok: false,
      error: motivoDelRechazo(
        "El empleado",
        bloqueos,
        "Borrá o desvinculá primero el usuario desde la pantalla de Usuarios, o dalo de baja en vez de borrarlo.",
      ),
    };
  }

  // Misma razón que en eliminarArea(): sin pedir la fila de vuelta, borrar un
  // id inexistente respondería éxito.
  const { data, error } = await db()
    .from("empleados")
    .delete()
    .eq("id", id)
    .select("id")
    .overrideTypes<{ id: number }[], { merge: false }>();

  if (error) {
    if (error.code === "23503") {
      return {
        ok: false,
        error:
          "Algo quedó apuntando al empleado entre la verificación y el borrado. No se borró nada. Volvé a intentar.",
      };
    }
    return { ok: false, error: `No se pudo borrar el empleado: ${error.message}` };
  }

  if ((data ?? []).length === 0) {
    return { ok: false, error: "Esa ficha ya no existe. No se borró nada." };
  }

  return { ok: true };
}
