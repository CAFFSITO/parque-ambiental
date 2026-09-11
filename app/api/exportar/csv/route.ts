// app/api/exportar/csv/route.ts
// CSV pensado para Excel en español:
//   - separador punto y coma,
//   - UTF-8 con BOM para que los acentos no salgan rotos,
//   - fechas dd/mm/aaaa HH:mm,
//   - archivo llamados_aaaammdd_HHmm.csv
//
// Toma los mismos filtros que la pantalla de Reportes, por query string.

import type { NextRequest } from "next/server";
import { exigirAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { fechaHora } from "@/lib/formato";
import { etiquetaEstado } from "@/lib/catalogos";
import { cargarLlamados, leerFiltro } from "@/lib/reportes";
import type { Area } from "@/lib/tipos";

/** Tope de seguridad: un CSV no debería tumbar la función. */
const TOPE_FILAS = 20000;

const CABECERA = [
  "ID",
  "Fecha y hora",
  "Area",
  "Nombre del area",
  "Tipo",
  "Origen",
  "Estado",
  "Motivo",
  "Detalle",
  "Creado por",
  "Atendido por",
  "Atendido en",
];

/**
 * Escapa según RFC 4180. Además antepone una comilla simple a lo que Excel
 * interpretaría como fórmula (=, +, -, @), para no abrir la puerta a una
 * inyección de fórmulas: el detalle lo escriben personas.
 */
function celda(valor: string | number | null): string {
  if (valor === null || valor === undefined) return "";

  let texto = String(valor);
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;

  if (/[";\n\r]/.test(texto)) {
    return `"${texto.replace(/"/g, '""')}"`;
  }
  return texto;
}

function nombreDeArchivo(momento: Date): string {
  const partes = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(momento);

  const buscar = (tipo: string) =>
    partes.find((parte) => parte.type === tipo)?.value ?? "";

  return `llamados_${buscar("year")}${buscar("month")}${buscar("day")}_${buscar("hour")}${buscar("minute")}.csv`;
}

export async function GET(request: NextRequest): Promise<Response> {
  await exigirAdmin();

  const parametros = Object.fromEntries(request.nextUrl.searchParams.entries());
  const filtro = leerFiltro(parametros);

  const [detalle, areasResultado] = await Promise.all([
    cargarLlamados(filtro, { tope: TOPE_FILAS }),
    db()
      .from("areas")
      .select("id, codigo, nombre")
      .overrideTypes<Pick<Area, "id" | "codigo" | "nombre">[], { merge: false }>(),
  ]);

  const areas = new Map<number, { codigo: string; nombre: string }>();
  for (const area of areasResultado.data ?? []) {
    areas.set(area.id, { codigo: area.codigo, nombre: area.nombre });
  }

  const lineas = [CABECERA.join(";")];

  for (const llamado of detalle.filas) {
    const area = llamado.area_id === null ? null : areas.get(llamado.area_id);

    lineas.push(
      [
        celda(llamado.id),
        celda(fechaHora(llamado.creado_en)),
        celda(area?.codigo ?? ""),
        celda(area?.nombre ?? ""),
        celda(llamado.tipo),
        celda(llamado.origen),
        celda(etiquetaEstado(llamado.estado)),
        celda(llamado.motivo),
        celda(llamado.detalle),
        celda(llamado.creado_por),
        celda(llamado.atendido_por),
        celda(llamado.atendido_en ? fechaHora(llamado.atendido_en) : ""),
      ].join(";"),
    );
  }

  // \r\n y BOM (U+FEFF): es lo que espera Excel en Windows.
  const BOM = String.fromCharCode(0xfeff);
  const cuerpo = `${BOM}${lineas.join("\r\n")}\r\n`;

  return new Response(cuerpo, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${nombreDeArchivo(new Date())}"`,
      "cache-control": "no-store",
    },
  });
}
