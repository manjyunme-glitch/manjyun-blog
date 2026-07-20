import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthSecret, shouldUseSecureCookie } from "@/lib/auth/config";
import {
  decodeSessionToken,
  encodeSessionToken
} from "@/lib/auth/session-token";
import {
  getAdminById,
  isSetupComplete,
  revokeAdminSessions
} from "@/lib/db/queries";

const cookieName = "mj_session";
const maxAgeSeconds = 60 * 60 * 24 * 14;

function decode(token: string | undefined) {
  return decodeSessionToken(token, getAuthSecret());
}

export async function setSession(adminId: number, sessionVersion: number) {
  const store = await cookies();
  store.set(
    cookieName,
    encodeSessionToken(
      {
        adminId,
        expiresAt: Math.floor(Date.now() / 1000) + maxAgeSeconds,
        sessionVersion
      },
      getAuthSecret()
    ),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: shouldUseSecureCookie(),
      path: "/",
      maxAge: maxAgeSeconds
    }
  );
}

export async function clearSession() {
  const store = await cookies();
  store.delete(cookieName);
}

export async function revokeCurrentSessionsAndClear() {
  const store = await cookies();
  const claims = decode(store.get(cookieName)?.value);
  if (claims) {
    const admin = getAdminById(claims.adminId);
    if (admin?.sessionVersion === claims.sessionVersion) {
      revokeAdminSessions(admin.id);
    }
  }
  store.delete(cookieName);
}

export async function getCurrentAdmin() {
  const store = await cookies();
  const claims = decode(store.get(cookieName)?.value);
  if (!claims) return null;
  const admin = getAdminById(claims.adminId);
  if (!admin || admin.sessionVersion !== claims.sessionVersion) return null;
  return admin;
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
