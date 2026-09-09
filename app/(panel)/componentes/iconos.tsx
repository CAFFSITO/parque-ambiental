// app/(panel)/componentes/iconos.tsx
// Íconos de los módulos. Son vectores de un solo trazo, sin relleno ni color
// propio: heredan el color del texto con currentColor, así sirven igual en la
// navegación, en un título o sobre el fondo dorado del ítem activo.
//
// Todos comparten viewBox, grosor de trazo y remates redondeados para que se
// lean como una familia y no como íconos juntados de distintos lados.

export type NombreIcono =
  | "tablero"
  | "llamados"
  | "movil"
  | "areas"
  | "empleados"
  | "usuarios"
  | "dispositivos"
  | "reportes"
  | "avisos";

const TRAZOS: Record<NombreIcono, React.ReactNode> = {
  tablero: (
    <>
      <rect x="3" y="3" width="7.5" height="9" rx="1.6" />
      <rect x="13.5" y="3" width="7.5" height="5.5" rx="1.6" />
      <rect x="13.5" y="12" width="7.5" height="9" rx="1.6" />
      <rect x="3" y="15.5" width="7.5" height="5.5" rx="1.6" />
    </>
  ),
  llamados: (
    <>
      <path d="M18 8.5a6 6 0 1 0-12 0c0 5.2-2 6.5-2 6.5h16s-2-1.3-2-6.5" />
      <path d="M13.8 18.5a2 2 0 0 1-3.6 0" />
    </>
  ),
  movil: (
    <>
      <rect x="6" y="2.5" width="12" height="19" rx="2.6" />
      <path d="M10.8 18.3h2.4" />
    </>
  ),
  areas: (
    <>
      <path d="m3 6.5 6-3 6 3 6-3v14l-6 3-6-3-6 3z" />
      <path d="M9 3.5v14M15 6.5v14" />
    </>
  ),
  empleados: (
    <>
      <circle cx="9.2" cy="7.8" r="3.6" />
      <path d="M2.8 20v-1.4a4.2 4.2 0 0 1 4.2-4.2h4.4a4.2 4.2 0 0 1 4.2 4.2V20" />
      <path d="M16.4 4.6a3.6 3.6 0 0 1 0 6.4" />
      <path d="M18.4 14.6a4.2 4.2 0 0 1 2.8 3.9V20" />
    </>
  ),
  usuarios: (
    <>
      <circle cx="7.4" cy="16.4" r="3.6" />
      <path d="m10 13.8 8.8-8.8" />
      <path d="m15.6 8.2 2.4 2.4" />
      <path d="m17.8 6 2.4 2.4" />
    </>
  ),
  dispositivos: (
    <>
      <rect x="7" y="7" width="10" height="10" rx="2.2" />
      <path d="M10 2.5V5M14 2.5V5M10 19v2.5M14 19v2.5M2.5 10H5M2.5 14H5M19 10h2.5M19 14h2.5" />
    </>
  ),
  reportes: (
    <>
      <path d="M3.5 20.5h17" />
      <path d="M7.5 20.5v-6M12 20.5v-11M16.5 20.5v-8" />
    </>
  ),
  /* Ondas saliendo de un punto: el aviso que se emite, no la campana que ya
     usa Llamados. */
  avisos: (
    <>
      <circle cx="12" cy="12" r="1.9" />
      <path d="M8.5 15.5a4.9 4.9 0 0 1 0-7M15.5 8.5a4.9 4.9 0 0 1 0 7" />
      <path d="M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8" />
    </>
  ),
};

export function Icono({
  nombre,
  tamano = 17,
  className,
}: {
  nombre: NombreIcono;
  tamano?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={tamano}
      height={tamano}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {TRAZOS[nombre]}
    </svg>
  );
}
