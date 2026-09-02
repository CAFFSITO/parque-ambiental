// app/(panel)/llamados/page.tsx
// Los filtros viven en la URL, así el sondeo de 10 s los respeta.
// Para el rol EMPLEADO el filtro de área se fuerza a la suya en el servidor:
// no hay forma de ver otra área cambiando el querystring.

import { exigirSesion } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Area, Llamado } from "@/lib/tipos";
import { GestorLlamados, type Filtros } from "./gestor";

export const metadata = {
  title: "Llamados · Parque Ambiental Municipal de Berisso",
};

const TOPE_FILAS = 400;

function texto(valor: string | string[] | undefined): string {
  return typeof valor === "string" ? valor : "";
}

/** Acepta solo aaaa-mm-dd; cualquier otra cosa se descarta. */
function fechaValida(valor: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor : "";
}

function unoDe(valor: string, permitidos: readonly string[]): string {
  return permitidos.includes(valor) ? valor : "";
}

export default async function PaginaLlamados(props: PageProps<"/llamados">) {
  const sesion = await exigirSesion();
  const parametros = await props.searchParams;

  const filtros: Filtros = {
    area: texto(parametros.area),
    tipo: unoDe(texto(parametros.tipo), ["NORMAL", "EMERGENCIA"]),
    origen: unoDe(texto(parametros.origen), ["SENSOR", "EMPLEADO"]),
    estado: unoDe(texto(parametros.estado), ["NO_ATENDIDO", "ATENDIDO"]),
    desde: fechaValida(texto(parametros.desde)),
    hasta: fechaValida(texto(parametros.hasta)),
  };

  // El área de un EMPLEADO no es negociable desde la URL.
  const areaForzada = sesion.rol === "EMPLEADO" ? sesion.area_id : null;
  if (areaForzada !== null) {
    filtros.area = String(areaForzada);
  }

  let consulta = db()
    .from("llamados")
    .select(
      "id, area_id, tipo, origen, estado, motivo, detalle, creado_por, creado_en, atendido_por, atendido_en",
    )
    .order("creado_en", { ascending: false })
    .limit(TOPE_FILAS);

  if (areaForzada !== null) {
    consulta = consulta.eq("area_id", areaForzada);
  } else if (filtros.area !== "" && Number.isFinite(Number(filtros.area))) {
    consulta = consulta.eq("area_id", Number(filtros.area));
  }

  if (filtros.tipo !== "") consulta = consulta.eq("tipo", filtros.tipo);
  if (filtros.origen !== "") consulta = consulta.eq("origen", filtros.origen);
  if (filtros.estado !== "") consulta = consulta.eq("estado", filtros.estado);

  if (filtros.desde !== "") {
    consulta = consulta.gte("creado_en", `${filtros.desde}T00:00:00`);
  }
  if (filtros.hasta !== "") {
    consulta = consulta.lte("creado_en", `${filtros.hasta}T23:59:59`);
  }

  const [llamadosResultado, areasResultado] = await Promise.all([
    consulta.overrideTypes<Llamado[], { merge: false }>(),
    db()
      .from("areas")
      .select(
        "id, codigo, nombre, tipo, temp_min, temp_max, hum_min, hum_max, activa, creada_en",
      )
      .order("codigo", { ascending: true })
      .overrideTypes<Area[], { merge: false }>(),
  ]);

  const llamados = llamadosResultado.data ?? [];

  return (
    <GestorLlamados
      llamados={llamados}
      areas={areasResultado.data ?? []}
      sesion={sesion}
      filtros={filtros}
      truncado={llamados.length === TOPE_FILAS}
    />
  );
}
