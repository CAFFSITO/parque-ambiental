// app/(panel)/dispositivos/page.tsx
// Exclusiva del rol ADMINISTRADOR: exigirAdmin() corre antes de leer nada.
//
// Administración de la flota de nodos. Todo lo que se ve acá sale de la tabla
// dispositivos y de lo que esos dispositivos efectivamente escribieron: no hay
// ningún dato de ejemplo ni ningún código cableado en la pantalla.

import { exigirAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { SEGUNDOS_SIN_SENAL } from "@/lib/alertas";
import { credencialVigente, listarCredenciales } from "@/lib/credenciales";
import {
  historialDeAreas,
  leerDispositivosConEstado,
  ultimasLecturas,
} from "@/lib/dispositivos";
import type { Area } from "@/lib/tipos";
import { GestorDispositivos, type FilaDispositivo } from "./gestor";

export const metadata = {
  title: "Dispositivos · Parque Ambiental Municipal",
};

export default async function PaginaDispositivos() {
  await exigirAdmin();

  const [dispositivos, areasResultado, historial] = await Promise.all([
    leerDispositivosConEstado(),

    // Todas las áreas, incluidas las dadas de baja: un nodo puede seguir
    // asignado a un área que se dio de baja, y la pantalla tiene que poder
    // mostrarlo en vez de dejar el campo vacío.
    db()
      .from("areas")
      .select(
        "id, codigo, nombre, tipo, temp_min, temp_max, hum_min, hum_max, activa, creada_en",
      )
      .order("codigo", { ascending: true })
      .overrideTypes<Area[], { merge: false }>(),

    historialDeAreas(),
  ]);

  const ids = dispositivos.map((dispositivo) => dispositivo.id);

  const [lecturas, credenciales] = await Promise.all([
    ultimasLecturas(ids),
    Promise.all(
      ids.map(async (id) => ({ id, filas: await listarCredenciales(id) })),
    ),
  ]);

  const credencialesPorDispositivo = new Map(
    credenciales.map(({ id, filas }) => [id, filas]),
  );

  // La vigencia se resuelve acá, en el servidor, con la misma función que usa
  // la autenticación. Si se calculara en el componente habría dos versiones de
  // la misma regla, y tarde o temprano dirían cosas distintas.
  const ahora = new Date();

  const filas: FilaDispositivo[] = dispositivos.map((dispositivo) => {
    const tramos = historial.porDispositivo.get(dispositivo.id) ?? [];
    const propias = credencialesPorDispositivo.get(dispositivo.id) ?? [];

    return {
      ...dispositivo,
      credenciales: propias,
      vigentes: propias
        .filter((credencial) => credencialVigente(credencial, ahora))
        .map((credencial) => credencial.id),
      ultima: lecturas.get(dispositivo.id) ?? null,
      historial: tramos,
      // Si el historial no está disponible no se puede afirmar que el
      // dispositivo no tenga lecturas, y sin esa certeza no se ofrece borrar.
      lecturas_totales: historial.disponible
        ? tramos.reduce((suma, tramo) => suma + tramo.lecturas, 0)
        : null,
    };
  });

  return (
    <GestorDispositivos
      dispositivos={filas}
      areas={areasResultado.data ?? []}
      umbralSegundos={SEGUNDOS_SIN_SENAL}
      historialDisponible={historial.disponible}
    />
  );
}
