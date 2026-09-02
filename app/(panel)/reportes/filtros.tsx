"use client";

// app/(panel)/reportes/filtros.tsx
// Los filtros viven en la URL: así el mismo rango alimenta los gráficos, la
// tabla, el CSV y la vista de impresión sin duplicar estado.

import { useRouter } from "next/navigation";
import type { Area } from "@/lib/tipos";
import type { FiltroReporte } from "@/lib/reportes";
import { filtroAQueryString } from "@/lib/reportes";
import { Campo } from "../componentes/campos";

/** Date -> "aaaa-mm-ddTHH:mm" en hora local del navegador. */
function aDatetimeLocal(fecha: Date): string {
  const dos = (valor: number) => String(valor).padStart(2, "0");
  return (
    `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}` +
    `T${dos(fecha.getHours())}:${dos(fecha.getMinutes())}`
  );
}

export function FiltrosReporte({
  filtro,
  areas,
}: {
  filtro: FiltroReporte;
  areas: Area[];
}) {
  const router = useRouter();

  function aplicar(siguiente: FiltroReporte) {
    const consulta = filtroAQueryString(siguiente);
    router.replace(consulta === "" ? "/reportes" : `/reportes?${consulta}`);
  }

  function cambiar(campo: keyof FiltroReporte, valor: string) {
    aplicar({ ...filtro, [campo]: valor });
  }

  function rangoRelativo(dias: number | null) {
    if (dias === null) {
      aplicar({ ...filtro, desde: "", hasta: "" });
      return;
    }

    const hasta = new Date();
    const desde = new Date();

    if (dias === 0) {
      desde.setHours(0, 0, 0, 0);
    } else {
      desde.setDate(desde.getDate() - dias);
    }

    aplicar({
      ...filtro,
      desde: aDatetimeLocal(desde),
      hasta: aDatetimeLocal(hasta),
    });
  }

  const rangos = [
    { etiqueta: "Hoy", dias: 0 },
    { etiqueta: "Últimos 7 días", dias: 7 },
    { etiqueta: "Últimos 30 días", dias: 30 },
    { etiqueta: "Todo", dias: null },
  ];

  return (
    <section className="panel flex flex-wrap items-end gap-3 p-3">
      <div className="w-[220px]">
        <Campo etiqueta="Área" htmlFor="r-area">
          <select
            id="r-area"
            className="campo"
            value={filtro.area}
            onChange={(evento) => cambiar("area", evento.target.value)}
          >
            <option value="">Todas</option>
            {areas.map((area) => (
              <option key={area.id} value={String(area.id)}>
                {area.codigo} — {area.nombre}
              </option>
            ))}
          </select>
        </Campo>
      </div>

      <div className="w-[160px]">
        <Campo etiqueta="Origen" htmlFor="r-origen">
          <select
            id="r-origen"
            className="campo"
            value={filtro.origen}
            onChange={(evento) => cambiar("origen", evento.target.value)}
          >
            <option value="">Todos</option>
            <option value="SENSOR">Sensor</option>
            <option value="EMPLEADO">Empleado</option>
          </select>
        </Campo>
      </div>

      <div className="w-[200px]">
        <Campo etiqueta="Desde" htmlFor="r-desde">
          <input
            id="r-desde"
            type="datetime-local"
            className="campo"
            value={filtro.desde}
            onChange={(evento) => cambiar("desde", evento.target.value)}
          />
        </Campo>
      </div>

      <div className="w-[200px]">
        <Campo etiqueta="Hasta" htmlFor="r-hasta">
          <input
            id="r-hasta"
            type="datetime-local"
            className="campo"
            value={filtro.hasta}
            onChange={(evento) => cambiar("hasta", evento.target.value)}
          />
        </Campo>
      </div>

      <div className="flex items-center gap-2">
        {rangos.map((rango) => (
          <button
            key={rango.etiqueta}
            type="button"
            className="boton-plano"
            onClick={() => rangoRelativo(rango.dias)}
          >
            {rango.etiqueta}
          </button>
        ))}
      </div>
    </section>
  );
}
