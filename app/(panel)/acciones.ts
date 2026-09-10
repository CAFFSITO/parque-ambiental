"use server";

// app/(panel)/acciones.ts

import { redirect } from "next/navigation";
import { exigirSesion, logout } from "@/lib/auth";

export async function cerrarSesion(): Promise<void> {
  await exigirSesion();
  await logout();
  redirect("/login");
}
