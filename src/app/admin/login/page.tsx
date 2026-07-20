import { redirect } from "next/navigation";
import { loginAction } from "@/app/admin/actions";
import { getCurrentAdmin } from "@/lib/auth/session";
import { isSetupComplete } from "@/lib/db/queries";
import { AdminThemeChrome } from "@/components/admin/AdminThemeChrome";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!isSetupComplete()) redirect("/admin/setup");
  const admin = await getCurrentAdmin();
  if (admin) redirect("/admin");
  const { error } = await searchParams;

  return (
    <main className="auth-page">
      <form className="auth-card form-grid" action={loginAction}>
        <AdminThemeChrome slot="AuthDecoration" />
        <div>
          <h1 className="admin-title">登录 ManJyun Admin</h1>
          <p className="admin-subtitle">进入共享工作台，管理内容、媒体、外观和站点设置。</p>
        </div>
        {error ? <p className="admin-notice error" role="alert" tabIndex={-1}>{error}</p> : null}
        <div className="field">
          <label htmlFor="login-username">用户名</label>
          <input id="login-username" className="input" name="username" autoComplete="username" maxLength={128} autoFocus required />
        </div>
        <div className="field">
          <label htmlFor="login-password">密码</label>
          <input id="login-password" className="input" name="password" type="password" autoComplete="current-password" maxLength={1024} required />
        </div>
        <button className="btn primary" type="submit">
          登录
        </button>
        <a className="auth-home-link" href="/">返回站点首页</a>
      </form>
    </main>
  );
}
