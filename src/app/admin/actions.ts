"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  changeAdminPassword,
  createAdminUser,
  getAdminByUsername,
  isSetupComplete
} from "@/lib/db/queries";
import {
  maximumPasswordBytes,
  maximumUsernameLength,
  minimumPasswordLength,
  passwordIsWithinBounds,
  validatedUsername
} from "@/lib/auth/input";
import {
  clearLoginFailures,
  clientIpFromHeaders,
  reserveLoginAttempt
} from "@/lib/auth/login-rate-limit";
import {
  hashPassword,
  PasswordWorkLimitError,
  verifyPassword
} from "@/lib/auth/password";
import {
  requireAdmin,
  revokeCurrentSessionsAndClear,
  setSession
} from "@/lib/auth/session";
import {
  consumeSetupToken,
  setupTokenMatches
} from "@/lib/auth/setup-token";
import {
  auditLog,
  auditRequestId
} from "@/lib/observability/audit";

const dummyPasswordHash =
  "scrypt$manjyun-login-dummy-salt$2FTEXpgQdCXahV6WzRA-S6Hi2obcM8fS3dLm89fJCe-5W68ljjUsNjflizpx7MlLCbRkl9wRw0aNYFybP9YYyw";

function redirectWithMessage(
  pathname: string,
  kind: "error" | "success",
  message: string
): never {
  redirect(`${pathname}?${new URLSearchParams({ [kind]: message })}`);
}

export async function setupAction(formData: FormData) {
  if (isSetupComplete()) redirect("/admin/login");
  const requestHeaders = await headers();
  const auditContext = {
    requestId: auditRequestId(requestHeaders),
    source: clientIpFromHeaders(requestHeaders)
  };

  const submittedToken = String(formData.get("setupToken") ?? "");
  if (!setupTokenMatches(submittedToken)) {
    auditLog({
      action: "admin.setup",
      outcome: "rejected",
      ...auditContext,
      code: "INVALID_SETUP_TOKEN"
    });
    redirectWithMessage("/admin/setup", "error", "初始化令牌无效。");
  }

  const username = validatedUsername(formData.get("username"));
  const password = String(formData.get("password") ?? "");
  const passwordConfirm = String(formData.get("passwordConfirm") ?? "");
  if (!username) {
    auditLog({
      action: "admin.setup",
      outcome: "rejected",
      ...auditContext,
      code: "INVALID_USERNAME"
    });
    redirectWithMessage(
      "/admin/setup",
      "error",
      `用户名不能为空，且最多 ${maximumUsernameLength} 个字符。`
    );
  }
  if (!passwordIsWithinBounds(password)) {
    auditLog({
      action: "admin.setup",
      outcome: "rejected",
      ...auditContext,
      code: "INVALID_PASSWORD_BOUNDS"
    });
    redirectWithMessage(
      "/admin/setup",
      "error",
      `密码至少 ${minimumPasswordLength} 位，且不能超过 ${maximumPasswordBytes} 字节。`
    );
  }
  if (password !== passwordConfirm) {
    auditLog({
      action: "admin.setup",
      outcome: "rejected",
      ...auditContext,
      code: "PASSWORD_CONFIRMATION_MISMATCH"
    });
    redirectWithMessage("/admin/setup", "error", "两次输入的密码不一致。");
  }

  let admin;
  try {
    const passwordHash = await hashPassword(password);
    admin = createAdminUser(username, passwordHash);
  } catch (error) {
    if (isSetupComplete()) {
      consumeSetupToken();
      auditLog({
        action: "admin.setup",
        outcome: "rejected",
        ...auditContext,
        code: "ALREADY_INITIALIZED"
      });
      redirect("/admin/login");
    }
    auditLog({
      action: "admin.setup",
      outcome: "failure",
      ...auditContext,
      code: "SETUP_FAILED"
    });
    redirectWithMessage(
      "/admin/setup",
      "error",
      error instanceof Error ? error.message : "初始化失败，请检查输入。"
    );
  }

  consumeSetupToken();
  await setSession(admin.id, admin.sessionVersion);
  auditLog({
    action: "admin.setup",
    outcome: "success",
    ...auditContext,
    actorId: admin.id
  });
  redirect("/admin");
}

export async function loginAction(formData: FormData) {
  if (!isSetupComplete()) {
    redirect("/admin/setup");
  }

  const rawUsername = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  const requestHeaders = await headers();
  const clientIp = clientIpFromHeaders(requestHeaders);
  const requestId = auditRequestId(requestHeaders);
  if (reserveLoginAttempt(rawUsername, clientIp) > 0) {
    auditLog({
      action: "admin.login",
      outcome: "rejected",
      requestId,
      source: clientIp,
      code: "RATE_LIMITED"
    });
    redirectWithMessage(
      "/admin/login",
      "error",
      "登录尝试过多，请稍后再试。"
    );
  }

  const username = validatedUsername(rawUsername);
  if (!username || !password || Buffer.byteLength(password, "utf8") > maximumPasswordBytes) {
    auditLog({
      action: "admin.login",
      outcome: "rejected",
      requestId,
      source: clientIp,
      code: "INVALID_CREDENTIALS"
    });
    redirectWithMessage("/admin/login", "error", "用户名或密码错误。");
  }

  const admin = getAdminByUsername(username);
  let passwordMatches = false;
  try {
    passwordMatches = await verifyPassword(
      password,
      admin?.passwordHash ?? dummyPasswordHash
    );
  } catch (error) {
    if (error instanceof PasswordWorkLimitError) {
      auditLog({
        action: "admin.login",
        outcome: "rejected",
        requestId,
        source: clientIp,
        code: "PASSWORD_WORK_LIMIT"
      });
      redirectWithMessage(
        "/admin/login",
        "error",
        "登录请求过多，请稍后再试。"
      );
    }
    auditLog({
      action: "admin.login",
      outcome: "failure",
      requestId,
      source: clientIp,
      code: "PASSWORD_VERIFICATION_FAILED"
    });
    throw error;
  }
  if (!admin || !passwordMatches) {
    auditLog({
      action: "admin.login",
      outcome: "rejected",
      requestId,
      source: clientIp,
      code: "INVALID_CREDENTIALS"
    });
    redirectWithMessage("/admin/login", "error", "用户名或密码错误。");
  }

  clearLoginFailures(username, clientIp);
  await setSession(admin.id, admin.sessionVersion);
  auditLog({
    action: "admin.login",
    outcome: "success",
    requestId,
    source: clientIp,
    actorId: admin.id
  });
  redirect("/admin");
}

export async function changePasswordAction(formData: FormData) {
  const currentAdmin = await requireAdmin();
  const requestHeaders = await headers();
  const clientIp = clientIpFromHeaders(requestHeaders);
  const requestId = auditRequestId(requestHeaders);
  if (reserveLoginAttempt(currentAdmin.username, clientIp) > 0) {
    auditLog({
      action: "admin.password.change",
      outcome: "rejected",
      requestId,
      source: clientIp,
      actorId: currentAdmin.id,
      code: "RATE_LIMITED"
    });
    redirectWithMessage(
      "/admin/account",
      "error",
      "密码验证尝试过多，请稍后再试。"
    );
  }
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const password = String(formData.get("password") ?? "");
  const passwordConfirm = String(formData.get("passwordConfirm") ?? "");

  if (
    !currentPassword ||
    Buffer.byteLength(currentPassword, "utf8") > maximumPasswordBytes
  ) {
    auditLog({
      action: "admin.password.change",
      outcome: "rejected",
      requestId,
      source: clientIp,
      actorId: currentAdmin.id,
      code: "INVALID_CURRENT_PASSWORD"
    });
    redirectWithMessage("/admin/account", "error", "当前密码不正确。");
  }
  if (!passwordIsWithinBounds(password)) {
    auditLog({
      action: "admin.password.change",
      outcome: "rejected",
      requestId,
      source: clientIp,
      actorId: currentAdmin.id,
      code: "INVALID_PASSWORD_BOUNDS"
    });
    redirectWithMessage(
      "/admin/account",
      "error",
      `新密码至少 ${minimumPasswordLength} 位，且不能超过 ${maximumPasswordBytes} 字节。`
    );
  }
  if (password !== passwordConfirm) {
    auditLog({
      action: "admin.password.change",
      outcome: "rejected",
      requestId,
      source: clientIp,
      actorId: currentAdmin.id,
      code: "PASSWORD_CONFIRMATION_MISMATCH"
    });
    redirectWithMessage("/admin/account", "error", "两次输入的新密码不一致。");
  }

  const credentials = getAdminByUsername(currentAdmin.username);
  let currentMatches = false;
  try {
    currentMatches = await verifyPassword(
      currentPassword,
      credentials?.passwordHash ?? dummyPasswordHash
    );
  } catch (error) {
    if (error instanceof PasswordWorkLimitError) {
      auditLog({
        action: "admin.password.change",
        outcome: "rejected",
        requestId,
        source: clientIp,
        actorId: currentAdmin.id,
        code: "PASSWORD_WORK_LIMIT"
      });
      redirectWithMessage(
        "/admin/account",
        "error",
        "密码验证请求过多，请稍后再试。"
      );
    }
    auditLog({
      action: "admin.password.change",
      outcome: "failure",
      requestId,
      source: clientIp,
      actorId: currentAdmin.id,
      code: "PASSWORD_VERIFICATION_FAILED"
    });
    throw error;
  }
  if (!credentials || !currentMatches) {
    auditLog({
      action: "admin.password.change",
      outcome: "rejected",
      requestId,
      source: clientIp,
      actorId: currentAdmin.id,
      code: "INVALID_CURRENT_PASSWORD"
    });
    redirectWithMessage("/admin/account", "error", "当前密码不正确。");
  }
  clearLoginFailures(currentAdmin.username, clientIp);

  let passwordHash: string;
  try {
    passwordHash = await hashPassword(password);
  } catch (error) {
    if (error instanceof PasswordWorkLimitError) {
      auditLog({
        action: "admin.password.change",
        outcome: "rejected",
        requestId,
        source: clientIp,
        actorId: currentAdmin.id,
        code: "PASSWORD_WORK_LIMIT"
      });
      redirectWithMessage(
        "/admin/account",
        "error",
        "密码服务繁忙，请稍后重试。"
      );
    }
    auditLog({
      action: "admin.password.change",
      outcome: "failure",
      requestId,
      source: clientIp,
      actorId: currentAdmin.id,
      code: "PASSWORD_HASH_FAILED"
    });
    throw error;
  }
  const updated = changeAdminPassword(
    currentAdmin.id,
    credentials.passwordHash,
    passwordHash
  );
  if (!updated) {
    auditLog({
      action: "admin.password.change",
      outcome: "rejected",
      requestId,
      source: clientIp,
      actorId: currentAdmin.id,
      code: "VERSION_CONFLICT"
    });
    redirectWithMessage(
      "/admin/account",
      "error",
      "密码已在其他会话中变更，请重新登录。"
    );
  }

  await setSession(updated.id, updated.sessionVersion);
  auditLog({
    action: "admin.password.change",
    outcome: "success",
    requestId,
    source: clientIp,
    actorId: updated.id
  });
  redirectWithMessage(
    "/admin/account",
    "success",
    "密码已更新，其他会话已全部撤销。"
  );
}

export async function logoutAction() {
  const admin = await requireAdmin();
  const requestHeaders = await headers();
  await revokeCurrentSessionsAndClear();
  auditLog({
    action: "admin.logout",
    outcome: "success",
    requestId: auditRequestId(requestHeaders),
    source: clientIpFromHeaders(requestHeaders),
    actorId: admin.id
  });
  redirect("/admin/login");
}
