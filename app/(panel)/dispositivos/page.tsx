// app/(panel)/dispositivos/page.tsx
// Exclusiva del rol ADMINISTRADOR.

import { exigirAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { estadoDeNodos, SEGUNDOS_SIN_SENAL } from "@/lib/alertas";
import type { Area } from "@/lib/tipos";
import { GestorDispositivos } from "./gestor";

export const metadata = {
  title: "Dispositivos · Parque Ambiental Municipal de Berisso",
};

export default async function PaginaDispositivos() {
  await exigirAdmin();

  const [dispositivos, areasResultado] = await Promise.all([
    estadoDeNodos(),
    db()
      .from("areas")
      .select(
        "id, codigo, nombre, tipo, temp_min, temp_max, hum_min, hum_max, activa, creada_en",
      )
      .eq("activa", true)
      .order("codigo", { ascending: true })
      .overrideTypes<Area[], { merge: false }>(),
  ]);

  return (
    <GestorDispositivos
      dispositivos={dispositivos}
      areas={areasResultado.data ?? []}
      umbralSegundos={SEGUNDOS_SIN_SENAL}
    />
  );
}
