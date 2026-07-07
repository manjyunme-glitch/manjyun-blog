"use server";

import { redirect } from "next/navigation";
import {
  createAdminUser,
  getAdminByUsername,
  isSetupComplete
} from "@/lib/db/queries";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { clearSession, setSession } from "@/lib/auth/session";

function cleanRedirectError(error: unknown) {
  return encodeURIComponent(
    error instanceof Error ? error.message : "操作失败，请检查输入。"
  );
}

export async function setupAction(formData: FormData) {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!username || password.length < 8) {
    redirect("/admin/setup?error=用户名不能为空，密码至少 8 位");
  }

  try {
    const passwordHash = await hashPassword(password);
    createAdminUser(username, passwordHash);
    const admin = getAdminByUsername(username);
    if (admin) {
      await setSession(admin.id);
    }
  } catch (error) {
    redirect(`/admin/setup?error=${cleanRedirectError(error)}`);
  }

  redirect("/admin");
}

export async function loginAction(formData: FormData) {
  if (!isSetupComplete()) {
    redirect("/admin/setup");
  }

  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const admin = getAdminByUsername(username);
  if (!admin || !(await verifyPassword(password, admin.passwordHash))) {
    redirect("/admin/login?error=用户名或密码错误");
  }

  await setSession(admin.id);
  redirect("/admin");
}

export async function logoutAction() {
  await clearSession();
  redirect("/admin/login");
}
