// app/(panel)/componentes/marca.tsx
// El logotipo de Rootbox: solo la palabra, sin la mancha verde.
//
// El isologo completo entra en un cuadrado, y en la barra del panel un
// cuadrado no puede pasar de unos 40 px: a ese tamaño la palabra queda
// ilegible. Suelta, la misma altura alcanza para leerla, porque el ancho lo
// pone la palabra y no el recuadro. La mancha sigue viva en el favicon y en
// los íconos de la PWA, que sí son cuadrados.
//
// El vector es public/logotipo.svg, el mismo trazado de public/logo.svg
// recortado al rectángulo de las letras. Va como archivo y con `unoptimized`
// por lo mismo de siempre: el optimizador de Next no toca SVG, y un vector ya
// es lo más liviano que se puede mandar.

import Image from "next/image";

/** Ancho contra alto del logotipo, medido sobre el vector. */
const PROPORCION = 6.13;

export function Marca({
  alto = 22,
  className,
}: {
  alto?: number;
  className?: string;
}) {
  return (
    <Image
      className={className}
      src="/logotipo.svg"
      alt="Rootbox"
      width={Math.round(alto * PROPORCION)}
      height={alto}
      priority
      unoptimized
    />
  );
}
