// app/(panel)/avisos/page.tsx
// Abierta a los dos roles: cada persona decide qué recibe en cada uno de sus
// dispositivos. El interruptor de Telegram solo lo ve el administrador.

import { exigirSesion } from "@/lib/auth";
import { db } from "@/lib/db";
import { telegramActivo } from "@/lib/avisos";
import { pushDisponible, type FilaSuscripcion } from "@/lib/push";
import { GestorAvisos } from "./gestor";

export const metadata = {
  title: "Avisos · Parque Ambiental Municipal",
};

export default async function PaginaAvisos() {
  const sesion = await exigirSesion();

  const [suscripciones, telegram] = await Promise.all([
    db()
      .from("suscripciones_push")
      .select(
        "id, usuario_id, endpoint, dispositivo, activa, creada_en, usada_en",
      )
      .eq("usuario_id", sesion.id)
      .order("creada_en", { ascending: false })
      .overrideTypes<Omit<FilaSuscripcion, "p256dh" | "auth">[], { merge: false }>(),
    telegramActivo(),
  ]);

  // La tabla puede no existir todavía si falta correr sql/05_avisos.sql: la
  // pantalla lo dice en vez de romperse.
  const faltaMigracion = suscripciones.error !== null;

  return (
    <GestorAvisos
      sesion={sesion}
      dispositivos={suscripciones.data ?? []}
      telegramActivo={telegram}
      clavePublica={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""}
      hayClaves={pushDisponible()}
      faltaMigracion={faltaMigracion}
    />
  );
}
