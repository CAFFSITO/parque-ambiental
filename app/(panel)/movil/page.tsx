// app/(panel)/movil/page.tsx
// Vista de campo: los llamados abiertos de todas las áreas. Los de las áreas
// a cargo de quien mira quedan arriba, que es lo que importa cuando se está
// parado en el parque con el teléfono en la mano.

import { exigirSesion } from "@/lib/auth";
import { areasDelUsuario, propiasPrimero } from "@/lib/areas-propias";
import { db } from "@/lib/db";
import type { Area, Llamado } from "@/lib/tipos";
import { GestorMovil } from "./gestor";

export const metadata = {
  title: "Móvil · Parque Ambiental Municipal",
};

const TOPE = 60;

export default async function PaginaMovil() {
  const sesion = await exigirSesion();

  const consulta = db()
    .from("llamados")
    .select(
      "id, area_id, tipo, origen, estado, motivo, detalle, creado_por, creado_en, atendido_por, atendido_en",
    )
    .eq("estado", "NO_ATENDIDO")
    // Las emergencias primero, y dentro de cada grupo lo más nuevo arriba.
    .order("tipo", { ascending: true })
    .order("creado_en", { ascending: false })
    .limit(TOPE);

  const [llamadosResultado, areasResultado, areasPropias] = await Promise.all([
    consulta.overrideTypes<Llamado[], { merge: false }>(),
    db()
      .from("areas")
      .select(
        "id, codigo, nombre, tipo, temp_min, temp_max, hum_min, hum_max, activa, creada_en",
      )
      .order("codigo", { ascending: true })
      .overrideTypes<Area[], { merge: false }>(),
    areasDelUsuario(sesion),
  ]);

  return (
    <GestorMovil
      llamados={propiasPrimero(llamadosResultado.data ?? [], areasPropias)}
      areas={areasResultado.data ?? []}
      areasPropias={areasPropias}
    />
  );
}
