// app/(panel)/componentes/marca.tsx
// El isotipo del parque: la R con la hoja calada en la panza y el brote a la
// izquierda del asta. Va inline y no como <img>: es el mismo vector de
// public/logo.svg (el que alimenta los íconos de la PWA), pero dibujado en el
// DOM no pide una request más ni pasa por el optimizador de imágenes, que no
// toca SVG salvo que se habilite dangerouslyAllowSVG.
//
// Los calados son huecos de una máscara, no blanco pintado: la marca se apoya
// sobre la pastilla clara de la barra sin arrastrar un fondo propio.

export function Marca({
  tamano = 26,
  color = "#2e9b41",
  className,
}: {
  tamano?: number;
  color?: string;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={tamano}
      height={tamano}
      viewBox="0 0 256 256"
      role="img"
      aria-label="Parque Ambiental"
    >
      <mask id="marca-parque">
        <rect width="256" height="256" fill="#000" />
        <path
          fill="#fff"
          d="M78 40h80c38 0 60 22 60 49 0 24-14 41-36 48l46 85h-56L130 140h-12v82H78Z"
        />
        <path fill="#000" d="M118 72h36c14 0 22 7 22 17s-8 17-22 17h-36Z" />
        <path fill="#000" d="M100 156c4-44 38-78 98-88 4 44-30 80-98 88Z" />
        <path fill="#fff" d="M102 138c-38 2-70 26-74 62 42 4 74-22 74-62Z" />
        <path
          fill="#000"
          d="M100 142c-30 12-52 32-66 60l-4-2c14-30 38-50 68-62Z"
        />
      </mask>
      <rect width="256" height="256" fill={color} mask="url(#marca-parque)" />
    </svg>
  );
}
