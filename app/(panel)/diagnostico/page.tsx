// app/(panel)/diagnostico/page.tsx
// Exclusiva del rol ADMINISTRADOR: exigirAdmin() corre antes de leer nada.
//
// El simulador vive acá y no en /dispositivos. Son dos tareas distintas:
// /dispositivos administra la flota —altas, áreas, credenciales, bajas— y esta
// pantalla ejercita el sistema con un nodo que no existe.
//
// Que estén separadas es una decisión de INTERFAZ, no un control de seguridad.
// El aislamiento real lo dan la naturaleza del dispositivo y la credencial,
// y se aplica en el servidor: ver acciones.ts y lib/simulador.ts. Mover una
// página no protege nada, y este comentario está para que nadie lo confunda.
//
// Solo se cargan dispositivos con naturaleza SIMULADO. La pantalla no puede
// ofrecer un nodo físico porque no lo conoce, y aunque alguien inventara el id
// de uno, la Server Action lo rechaza.

import { exigirAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { SEGUNDOS_SIN_SENAL } from "@/lib/alertas";
import { leerDispositivosConEstado, ultimasLecturas } from "@/lib/dispositivos";
import { MINUTOS_CREDENCIAL_SIMULADOR } from "@/lib/simulador";
import type { Area } from "@/lib/tipos";
import { GestorDiagnostico, type FilaSimulado } from "./gestor";

export const metadata = {
  title: "Diagnóstico · Parque Ambiental Municipal",
};

export default async function PaginaDiagnostico() {
  await exigirAdmin();

  const [flota, areasResultado] = await Promise.all([
    leerDispositivosConEstado(),

    // Todas las áreas, incluidas las dadas de baja: un simulado puede seguir
    // asignado a un área que se dio de baja, y la pantalla tiene que poder
    // decirlo en vez de dejar el campo vacío.
    db()
      .from("areas")
      .select(
        "id, codigo, nombre, tipo, temp_min, temp_max, hum_min, hum_max, activa, creada_en",
      )
      .order("codigo", { ascending: true })
      .overrideTypes<Area[], { merge: false }>(),
  ]);

  // El filtro por naturaleza es lo único que decide qué se puede simular. Los
  // físicos no llegan al navegador.
  const simulados = flota.filter(
    (dispositivo) => dispositivo.naturaleza === "SIMULADO",
  );

  const lecturas = await ultimasLecturas(simulados.map((d) => d.id));

  const filas: FilaSimulado[] = simulados.map((dispositivo) => ({
    ...dispositivo,
    ultima: lecturas.get(dispositivo.id) ?? null,
  }));

  return (
    <GestorDiagnostico
      simulados={filas}
      areas={areasResultado.data ?? []}
      umbralSegundos={SEGUNDOS_SIN_SENAL}
      minutosCredencial={MINUTOS_CREDENCIAL_SIMULADOR}
      fisicos={flota.filter((d) => d.naturaleza === "FISICO").length}
    />
  );
}
