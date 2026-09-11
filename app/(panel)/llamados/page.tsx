// app/(panel)/llamados/page.tsx
// Los filtros viven en la URL, así el sondeo de 10 s los respeta.
//
// Todos ven todas las áreas. Las que la persona tiene a cargo no filtran:
// ordenan. Sus llamados van arriba de todo y, dentro de cada grupo, se
// mantiene el orden por fecha.

import { exigirSesion } from "@/lib/auth";
import { areasDelUsuario, propiasPrimero } from "@/lib/areas-propias";
import { db } from "@/lib/db";
import { leerMotivos } from "@/lib/motivos";
import type { Area, Llamado } from "@/lib/tipos";
import { GestorLlamados, type Filtros } from "./gestor";

export const metadata = {
  title: "Llamados · Parque Ambiental Municipal",
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

  let consulta = db()
    .from("llamados")
    .select(
      "id, area_id, tipo, origen, estado, motivo, detalle, creado_por, creado_en, atendido_por, atendido_en",
    )
    .order("creado_en", { ascending: false })
    .limit(TOPE_FILAS);

  if (filtros.area !== "" && Number.isFinite(Number(filtros.area))) {
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

  const [llamadosResultado, areasResultado, areasPropias, motivos] = await Promise.all([
    consulta.overrideTypes<Llamado[], { merge: false }>(),
    db()
      .from("areas")
      .select(
        "id, codigo, nombre, tipo, temp_min, temp_max, hum_min, hum_max, activa, creada_en",
      )
      .order("codigo", { ascending: true })
      .overrideTypes<Area[], { merge: false }>(),
    areasDelUsuario(sesion),
    leerMotivos(),
  ]);

  const crudos = llamadosResultado.data ?? [];

  return (
    <GestorLlamados
      llamados={propiasPrimero(crudos, areasPropias)}
      areas={areasResultado.data ?? []}
      areasPropias={areasPropias}
      sesion={sesion}
      filtros={filtros}
      truncado={crudos.length === TOPE_FILAS}
      motivos={motivos}
    />
  );
}
