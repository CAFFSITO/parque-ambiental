// app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: "Parque Ambiental | Municipalidad de Berisso",
  description:
    "Gestión ambiental clara y conectada para el Parque Ambiental Municipal de Berisso.",
  openGraph: {
    title: "Parque Ambiental | Municipalidad de Berisso",
    description: "Gestión ambiental, clara y conectada.",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
    locale: "es_AR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Parque Ambiental | Municipalidad de Berisso",
    description: "Gestión ambiental, clara y conectada.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${inter.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
