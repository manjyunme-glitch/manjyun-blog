import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminById, isSetupComplete } from "@/lib/db/queries";
import { getDataDir } from "@/lib/paths";

const cookieName = "mj_session";
const maxAgeSeconds = 60 * 60 * 24 * 14;

function getSecret() {
  const envSecret = process.env.AUTH_SECRET;
  if (envSecret) return envSecret;

  const secretPath = path.join(getDataDir(), "auth-secret");
  fs.mkdirSync(path.dirname(secretPath), { recursive: true });
  if (!fs.existsSync(secretPath)) {
    fs.writeFileSync(secretPath, crypto.randomBytes(32).toString("base64url"), {
      mode: 0o600
    });
  }
  return fs.readFileSync(secretPath, "utf8").trim();
}

function sign(payload: string) {
  return crypto.createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

function encodeSession(adminId: number) {
  const payload = Buffer.from(
    JSON.stringify({
      sub: adminId,
      exp: Math.floor(Date.now() / 1000) + maxAgeSeconds
    })
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function decodeSession(token: string | undefined) {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || sign(payload) !== signature) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      sub: number;
      exp: number;
    };
    if (!parsed.sub || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed.sub;
  } catch {
    return null;
  }
}

export async function setSession(adminId: number) {
  const store = await cookies();
  store.set(cookieName, encodeSession(adminId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds
  });
}

export async function clearSession() {
  const store = await cookies();
  store.delete(cookieName);
}

export async function getCurrentAdmin() {
  const store = await cookies();
  const adminId = decodeSession(store.get(cookieName)?.value);
  if (!adminId) return null;
  return getAdminById(adminId);
}

export async function requireAdmin() {
  if (!isSetupComplete()) {
    redirect("/admin/setup");
  }

  const admin = await getCurrentAdmin();
  if (!admin) {
    redirect("/admin/login");
  }
  return admin;
}

export async function requireAdminForApi() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return null;
  }
  return admin;
}
