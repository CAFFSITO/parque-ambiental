// tests/borrado.test.ts
// Decisiones puras de lib/borrado.ts: no tocan la base ni la red.
//
// Existe porque estas funciones deciden si una fila se BORRA para siempre. Un
// falso positivo acá no se arregla con un rollback: la historia ya no está.
// Por eso los casos de abajo insisten en el mismo punto desde varios ángulos:
// alcanza UNA dependencia, la que sea, para que el borrado no se ofrezca.

import { describe, expect, it } from "vitest";
import {
  bloqueosDeArea,
  bloqueosDeEmpleado,
  motivoDelRechazo,
  puedeBorrarseArea,
  puedeBorrarseEmpleado,
  type DependenciasArea,
  type DependenciasEmpleado,
} from "@/lib/borrado";

/** Área sin nada colgando. Los casos parten de acá y suman una dependencia. */
const AREA_LIBRE: DependenciasArea = {
  lecturas: 0,
  llamados: 0,
  empleados: 0,
  usuarios: 0,
  dispositivos: 0,
};

const EMPLEADO_LIBRE: DependenciasEmpleado = {
  usuarios: 0,
  llamados_legajo: 0,
};

const CAMPOS_AREA = [
  "lecturas",
  "llamados",
  "empleados",
  "usuarios",
  "dispositivos",
] as const;

describe("bloqueosDeArea", () => {
  it("un área sin nada colgando se puede borrar", () => {
    expect(bloqueosDeArea(AREA_LIBRE)).toEqual([]);
    expect(puedeBorrarseArea(AREA_LIBRE)).toBe(true);
  });

  it("CUALQUIERA de las cinco dependencias, sola, bloquea el borrado", () => {
    // Es la propiedad que importa: no hay una dependencia "menor" que se pueda
    // ignorar. Si mañana se agrega una sexta, este test no la cubre solo, pero
    // el de abajo obliga a que aparezca en el mensaje.
    for (const campo of CAMPOS_AREA) {
      const dep = { ...AREA_LIBRE, [campo]: 1 };
      expect(puedeBorrarseArea(dep), `${campo} debería bloquear`).toBe(false);
      expect(bloqueosDeArea(dep)).toHaveLength(1);
    }
  });

  it("informa TODAS las dependencias juntas, no solo la primera", () => {
    // Quien va a reasignar necesita la lista entera de una, no descubrir una
    // por intento.
    const bloqueos = bloqueosDeArea({
      lecturas: 673,
      llamados: 29,
      empleados: 2,
      usuarios: 1,
      dispositivos: 1,
    });
    expect(bloqueos).toHaveLength(5);
  });

  it("ordena primero la historia, que no se puede mover", () => {
    // Lecturas y llamados son hechos: no se reasignan. Dispositivos, empleados
    // y usuarios sí. El orden del mensaje refleja eso.
    const bloqueos = bloqueosDeArea({
      lecturas: 1,
      llamados: 1,
      empleados: 1,
      usuarios: 1,
      dispositivos: 1,
    });
    expect(bloqueos[0]).toContain("lectura");
    expect(bloqueos[1]).toContain("llamado");
  });

  it("usa singular y plural donde corresponde", () => {
    expect(bloqueosDeArea({ ...AREA_LIBRE, lecturas: 1 })).toEqual([
      "1 lectura registrada",
    ]);
    expect(bloqueosDeArea({ ...AREA_LIBRE, lecturas: 2 })).toEqual([
      "2 lecturas registradas",
    ]);
    expect(bloqueosDeArea({ ...AREA_LIBRE, dispositivos: 1 })).toEqual([
      "1 dispositivo asignado",
    ]);
    expect(bloqueosDeArea({ ...AREA_LIBRE, dispositivos: 3 })).toEqual([
      "3 dispositivos asignados",
    ]);
  });

  it("una sola lectura ya alcanza: no hay umbral de tolerancia", () => {
    expect(puedeBorrarseArea({ ...AREA_LIBRE, lecturas: 1 })).toBe(false);
  });
});

describe("bloqueosDeEmpleado", () => {
  it("un empleado sin usuario ligado se puede borrar", () => {
    expect(bloqueosDeEmpleado(EMPLEADO_LIBRE)).toEqual([]);
    expect(puedeBorrarseEmpleado(EMPLEADO_LIBRE)).toBe(true);
  });

  it("un usuario ligado lo bloquea", () => {
    const dep = { ...EMPLEADO_LIBRE, usuarios: 1 };
    expect(puedeBorrarseEmpleado(dep)).toBe(false);
    expect(bloqueosDeEmpleado(dep)).toEqual(["1 usuario ligado"]);
  });

  it("los llamados con su legajo NO lo bloquean", () => {
    // llamados.creado_por y atendido_por son texto libre, sin clave foránea:
    // borrar la ficha no rompe ninguna fila. Lo que se pierde es poder
    // resolver ese texto a un empleado, y eso se advierte, no se prohíbe.
    const dep = { usuarios: 0, llamados_legajo: 47 };
    expect(puedeBorrarseEmpleado(dep)).toBe(true);
    expect(bloqueosDeEmpleado(dep)).toEqual([]);
  });

  it("con usuario ligado bloquea aunque no tenga llamados", () => {
    expect(puedeBorrarseEmpleado({ usuarios: 2, llamados_legajo: 0 })).toBe(false);
    expect(bloqueosDeEmpleado({ usuarios: 2, llamados_legajo: 0 })).toEqual([
      "2 usuarios ligados",
    ]);
  });
});

describe("motivoDelRechazo", () => {
  it("dice qué bloquea y qué hacer en su lugar", () => {
    // Un "no se puede" sin salida es una pantalla que no ayuda.
    const texto = motivoDelRechazo(
      "El área",
      ["673 lecturas registradas", "2 empleados asignados"],
      "Dala de baja en vez de borrarla.",
    );

    expect(texto).toContain("673 lecturas registradas");
    expect(texto).toContain("2 empleados asignados");
    expect(texto).toContain("Dala de baja");
  });
});

describe("la diferencia entre dar de baja y borrar", () => {
  it("borrar exige CERO dependencias; dar de baja no exige ninguna", () => {
    // No hay test de "dar de baja" porque no tiene condición: cambiarActivaArea
    // y cambiarEstadoEmpleado siempre proceden. Esa asimetría es el diseño:
    // la baja es reversible y el borrado no.
    const conHistoria: DependenciasArea = { ...AREA_LIBRE, lecturas: 5802 };
    expect(puedeBorrarseArea(conHistoria)).toBe(false);
    expect(bloqueosDeArea(conHistoria)[0]).toContain("5802");
  });
});
