// app/layout.tsx
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import RegistrarSW from "./registrar-sw";

// Se carga acá, no en el layout del panel: --font-alera tiene que estar
// declarada en :root para que la sustitución de --font-sans la encuentre, y
// para que login y el resto de las pantallas sueltas también la usen.
//
// Están las dieciocho caras (nueve pesos, redonda e itálica): el navegador
// descarga solo las que la página realmente pinta.
const alera = localFont({
  src: [
    { path: "./fuentes/alera-labs-scientific-humanistic/aleralabs-thin.ttf", weight: "100", style: "normal" },
    { path: "./fuentes/alera-labs-scientific-humanistic/aleralabs-extralight.ttf", weight: "200", style: "normal" },
    { path: "./fuentes/alera-labs-scientific-humanistic/aleralabs-light.ttf", weight: "300", style: "normal" },
    { path: "./fuentes/alera-labs-scientific-humanistic/aleralabs-regular.ttf", weight: "400", style: "normal" },
    { path: "./fuentes/alera-labs-scientific-humanistic/aleralabs-medium.ttf", weight: "500", style: "normal" },
    { path: "./fuentes/alera-labs-scientific-humanistic/aleralabs-semibold.ttf", weight: "600", style: "normal" },
    { path: "./fuentes/alera-labs-scientific-humanistic/aleralabs-bold.ttf", weight: "700", style: "normal" },
    { path: "./fuentes/alera-labs-scientific-humanistic/aleralabs-extrabold.ttf", weight: "800", style: "normal" },
    { path: "./fuentes/alera-labs-scientific-humanistic/aleralabs-black.ttf", weight: "900", style: "normal" },
    { path: "./fuentes/alera-labs-scientific-humanistic/aleralabs-thinitalic.ttf", weight: "100", style: "italic" },
    { path: "./fuentes/alera-labs-scientific-humanistic/aleralabs-extralightitalic.ttf", weight: "200", style: "italic" },
    { path: "./fuentes/alera-labs-scientific-humanistic/aleralabs-lightitalic.ttf", weight: "300", style: "italic" },
    { path: "./fuentes/alera-labs-scientific-humanistic/aleralabs-italic.ttf", weight: "400", style: "italic" },
    { path: "./fuentes/alera-labs-scientific-humanistic/aleralabs-mediumitalic.ttf", weight: "500", style: "italic" },
    { path: "./fuentes/alera-labs-scientific-humanistic/aleralabs-semibolditalic.ttf", weight: "600", style: "italic" },
    { path: "./fuentes/alera-labs-scientific-humanistic/aleralabs-bolditalic.ttf", weight: "700", style: "italic" },
    { path: "./fuentes/alera-labs-scientific-humanistic/aleralabs-extrabolditalic.ttf", weight: "800", style: "italic" },
    { path: "./fuentes/alera-labs-scientific-humanistic/aleralabs-blackitalic.ttf", weight: "900", style: "italic" },
  ],
  variable: "--font-alera",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: "Parque Ambiental",
  description:
    "Gestión ambiental clara y conectada para el Parque Ambiental Municipal.",
  manifest: "/manifest.json",
  icons: {
    icon: "/icons/favicon-32.png",
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Parque Ambiental",
  },
  openGraph: {
    title: "Parque Ambiental",
    description: "Gestión ambiental, clara y conectada.",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
    locale: "es_AR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Parque Ambiental",
    description: "Gestión ambiental, clara y conectada.",
    images: ["/og.png"],
  },
};

// En Next 16 themeColor va en el export `viewport`, no en `metadata`: puesto
// en metadata queda ignorado y avisa por consola.
export const viewport: Viewport = {
  themeColor: "#141618",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${alera.variable} h-full`}>
      <body className="min-h-full">
        {children}
        <RegistrarSW />
      </body>
    </html>
  );
}
