"use server";

// app/(panel)/acciones.ts

import { redirect } from "next/navigation";
import { logout } from "@/lib/auth";

export async function cerrarSesion(): Promise<void> {
  await logout();
  redirect("/login");
}
