// tests/credenciales.test.ts
// Decisiones puras de lib/credenciales.ts: no tocan la base ni la red.

import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import {
  aPublica,
  credencialVigente,
  generarSecreto,
  hashBcrypt,
  hashSha256,
  motivoNoVigente,
  PREFIJO_SECRETO,
  resolverAcceso,
  RONDAS_BCRYPT,
} from "@/lib/credenciales";
import type { CredencialPublica, Dispositivo } from "@/lib/tipos";

const AHORA = new Date("2026-09-09T20:00:00.000Z");

function enMinutos(n: number): string {
  return new Date(AHORA.getTime() + n * 60_000).toISOString();
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
    ultimo_contacto_en: null,
    observaciones: null,
    creado_en: "2026-09-09T00:00:00.000Z",
    ...cambios,
  };
}

function credencial(cambios: Partial<CredencialPublica> = {}): CredencialPublica {
  return {
    id: 7,
    dispositivo_id: 11,
    algoritmo: "sha256-v1",
    prefijo: "pab_A7xK2m9Q",
    estado: "ACTIVA",
    origen: "GENERADA",
    expira_en: null,
    usada_en: null,
    creada_en: "2026-09-09T00:00:00.000Z",
    creada_por: "admin",
    revocada_en: null,
    revocada_por: null,
    motivo: null,
    ...cambios,
  };
}

describe("generarSecreto", () => {
  it("lleva el prefijo que lo hace reconocible si se filtra", () => {
    expect(generarSecreto().secreto.startsWith(PREFIJO_SECRETO)).toBe(true);
  });

  it("tiene entropía suficiente como para no poder adivinarse", () => {
    // 32 bytes en base64url son 43 caracteres, más el prefijo.
    const { secreto } = generarSecreto();
    expect(secreto.length).toBeGreaterThanOrEqual(PREFIJO_SECRETO.length + 43);
  });

  it("usa el alfabeto base64url, que sobrevive en una cabecera HTTP", () => {
    const { secreto } = generarSecreto();
    expect(secreto).toMatch(/^pab_[A-Za-z0-9_-]+$/);
  });

  it("nunca genera dos veces el mismo secreto", () => {
    const secretos = new Set(
      Array.from({ length: 200 }, () => generarSecreto().secreto),
    );
    expect(secretos.size).toBe(200);
  });

  it("el prefijo guardado es un pedazo del secreto, no el secreto entero", () => {
    const { secreto, prefijo } = generarSecreto();
    expect(secreto.startsWith(prefijo)).toBe(true);
    expect(prefijo.length).toBeLessThan(secreto.length);
  });

  it("el hash que se guarda es el del secreto, y es lo único que se guarda", () => {
    const { secreto, hash } = generarSecreto();
    expect(hash).toBe(hashSha256(secreto));
    expect(hash).not.toContain(secreto);
  });
});

describe("hashSha256", () => {
  it("devuelve 64 caracteres hexadecimales", () => {
    expect(hashSha256("pab_loquesea")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("es determinista: es lo que permite buscar la credencial por su hash", () => {
    expect(hashSha256("pab_abc")).toBe(hashSha256("pab_abc"));
  });

  it("dos secretos distintos dan hashes distintos", () => {
    expect(hashSha256("pab_abc")).not.toBe(hashSha256("pab_abd"));
  });
});

describe("verificación de una credencial generada", () => {
  it("el secreto correcto reproduce el hash guardado", () => {
    const { secreto, hash } = generarSecreto();
    expect(hashSha256(secreto)).toBe(hash);
  });

  it("un secreto equivocado no reproduce el hash guardado", () => {
    const { hash } = generarSecreto();
    expect(hashSha256(generarSecreto().secreto)).not.toBe(hash);
  });

  it("cambiar un solo carácter del secreto ya no verifica", () => {
    const { secreto, hash } = generarSecreto();
    const alterado = `${secreto.slice(0, -1)}${secreto.endsWith("A") ? "B" : "A"}`;
    expect(hashSha256(alterado)).not.toBe(hash);
  });
});

describe("credencial heredada con bcrypt", () => {
  it("verifica la clave correcta y rechaza la incorrecta", () => {
    // Clave de prueba: no es la del firmware, que no se escribe en ningún lado.
    const hash = hashBcrypt("clave-de-prueba");

    expect(bcrypt.compareSync("clave-de-prueba", hash)).toBe(true);
    expect(bcrypt.compareSync("clave-equivocada", hash)).toBe(false);
  });

  it("usa las mismas rondas que el resto del sistema", () => {
    expect(RONDAS_BCRYPT).toBe(10);
    expect(hashBcrypt("x")).toContain(`$${RONDAS_BCRYPT}$`);
  });

  it("lleva sal: dos hashes de la misma clave son distintos", () => {
    // Por eso el camino heredado no se puede resolver buscando por hash.
    expect(hashBcrypt("misma")).not.toBe(hashBcrypt("misma"));
  });
});

describe("vigencia de una credencial", () => {
  it("una credencial activa sin vencimiento sirve", () => {
    expect(motivoNoVigente(credencial(), AHORA)).toBeNull();
    expect(credencialVigente(credencial(), AHORA)).toBe(true);
  });

  it("una credencial activa con vencimiento futuro sirve", () => {
    const fila = credencial({ expira_en: enMinutos(10) });
    expect(credencialVigente(fila, AHORA)).toBe(true);
  });

  it("una credencial activa ya vencida no sirve", () => {
    const fila = credencial({ expira_en: enMinutos(-1) });
    expect(motivoNoVigente(fila, AHORA)).toBe("CREDENCIAL_VENCIDA");
  });

  it("una credencial rotada sirve mientras dure su ventana de gracia", () => {
    const fila = credencial({ estado: "ROTADA", expira_en: enMinutos(60) });
    expect(credencialVigente(fila, AHORA)).toBe(true);
  });

  it("una credencial rotada deja de servir cuando la ventana expira", () => {
    const fila = credencial({ estado: "ROTADA", expira_en: enMinutos(-1) });
    expect(motivoNoVigente(fila, AHORA)).toBe("CREDENCIAL_VENCIDA");
  });

  it("una credencial rotada sin ventana no sirve: no es una gracia, es un descuido", () => {
    const fila = credencial({ estado: "ROTADA", expira_en: null });
    expect(motivoNoVigente(fila, AHORA)).toBe("CREDENCIAL_VENCIDA");
  });

  it("una credencial revocada NUNCA sirve, ni con vencimiento futuro", () => {
    const fila = credencial({ estado: "REVOCADA", expira_en: enMinutos(600) });
    expect(motivoNoVigente(fila, AHORA)).toBe("CREDENCIAL_REVOCADA");
    expect(credencialVigente(fila, AHORA)).toBe(false);
  });
});

describe("resolverAcceso", () => {
  it("deja pasar a un dispositivo activo con una credencial vigente", () => {
    const resultado = resolverAcceso(dispositivo(), credencial(), AHORA);

    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.dispositivo.codigo).toBe("NODO-INV-N-01");
      expect(resultado.credencialId).toBe(7);
    }
  });

  it("rechaza una credencial revocada", () => {
    const resultado = resolverAcceso(
      dispositivo(),
      credencial({ estado: "REVOCADA" }),
      AHORA,
    );

    expect(resultado).toEqual({ ok: false, motivo: "CREDENCIAL_REVOCADA" });
  });

  it("rechaza una credencial vencida", () => {
    const resultado = resolverAcceso(
      dispositivo(),
      credencial({ expira_en: enMinutos(-5) }),
      AHORA,
    );

    expect(resultado).toEqual({ ok: false, motivo: "CREDENCIAL_VENCIDA" });
  });

  it("rechaza un dispositivo dado de baja aunque su credencial esté perfecta", () => {
    const resultado = resolverAcceso(
      dispositivo({ activo: false }),
      credencial(),
      AHORA,
    );

    expect(resultado).toEqual({ ok: false, motivo: "DISPOSITIVO_INACTIVO" });
  });

  it("si fallan las dos cosas, informa el problema de la credencial", () => {
    // La autenticación va antes que la autorización: el motivo que hay que
    // auditar es que alguien usó una credencial revocada.
    const resultado = resolverAcceso(
      dispositivo({ activo: false }),
      credencial({ estado: "REVOCADA" }),
      AHORA,
    );

    expect(resultado).toEqual({ ok: false, motivo: "CREDENCIAL_REVOCADA" });
  });

  it("un dispositivo sin área asignada igual autentica", () => {
    // No tener área no es un problema de identidad: es no tener umbrales.
    const resultado = resolverAcceso(
      dispositivo({ area_id: null }),
      credencial(),
      AHORA,
    );

    expect(resultado.ok).toBe(true);
  });

  it("un dispositivo simulado autentica como cualquier otro", () => {
    const resultado = resolverAcceso(
      dispositivo({ naturaleza: "SIMULADO", codigo: "SIM-INV-N" }),
      credencial(),
      AHORA,
    );

    expect(resultado.ok).toBe(true);
  });
});

describe("aPublica", () => {
  it("no deja pasar el hash hacia afuera", () => {
    const interna = { ...credencial(), secreto_hash: "no-debe-salir" };
    const publica = aPublica(interna);

    expect(publica).not.toHaveProperty("secreto_hash");
    expect(JSON.stringify(publica)).not.toContain("no-debe-salir");
  });

  it("conserva todo lo que sí se puede mostrar", () => {
    const publica = aPublica(credencial({ prefijo: "pab_ZZZZZZZZ" }));

    expect(publica.id).toBe(7);
    expect(publica.dispositivo_id).toBe(11);
    expect(publica.algoritmo).toBe("sha256-v1");
    expect(publica.prefijo).toBe("pab_ZZZZZZZZ");
    expect(publica.estado).toBe("ACTIVA");
  });
});
