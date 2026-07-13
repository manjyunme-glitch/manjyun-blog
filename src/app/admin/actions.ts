"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import {
  createAdminUser,
  getAdminByUsername,
  isSetupComplete
} from "@/lib/db/queries";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  clearLoginFailures,
  clientIpFromHeaders,
  loginRetryAfterSeconds,
  recordLoginFailure
} from "@/lib/auth/login-rate-limit";
import { clearSession, setSession } from "@/lib/auth/session";

const dummyPasswordHash =
  "scrypt$manjyun-login-dummy-salt$2FTEXpgQdCXahV6WzRA-S6Hi2obcM8fS3dLm89fJCe-5W68ljjUsNjflizpx7MlLCbRkl9wRw0aNYFybP9YYyw";

function cleanRedirectError(error: unknown) {
  return encodeURIComponent(
    error instanceof Error ? error.message : "操作失败，请检查输入。"
  );
}

export async function setupAction(formData: FormData) {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const passwordConfirm = String(formData.get("passwordConfirm") ?? "");
  if (!username || password.length < 8) {
    redirect("/admin/setup?error=用户名不能为空，密码至少 8 位");
  }
  if (password !== passwordConfirm) {
    redirect("/admin/setup?error=两次输入的密码不一致");
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
  const requestHeaders = await headers();
  const clientIp = clientIpFromHeaders(requestHeaders);
  if (loginRetryAfterSeconds(username, clientIp) > 0) {
    redirect("/admin/login?error=登录尝试过多，请稍后再试");
  }

  const admin = getAdminByUsername(username);
  const passwordMatches = await verifyPassword(
    password,
    admin?.passwordHash ?? dummyPasswordHash
  );
  if (!admin || !passwordMatches) {
    recordLoginFailure(username, clientIp);
    redirect("/admin/login?error=用户名或密码错误");
  }

  clearLoginFailures(username, clientIp);
  await setSession(admin.id);
  redirect("/admin");
}

export async function logoutAction() {
  await clearSession();
  redirect("/admin/login");
}
