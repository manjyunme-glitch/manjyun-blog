import { redirect } from "next/navigation";
import { loginAction } from "@/app/admin/actions";
import { getCurrentAdmin } from "@/lib/auth/session";
import { isSetupComplete } from "@/lib/db/queries";

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
        <div>
          <h1 className="admin-title">登录写作台</h1>
          <p className="admin-subtitle">管理文章、媒体、主题和首页模块。</p>
        </div>
        {error ? <p className="error-text">{decodeURIComponent(error)}</p> : null}
        <div className="field">
          <label>用户名</label>
          <input className="input" name="username" autoComplete="username" required />
        </div>
        <div className="field">
          <label>密码</label>
          <input className="input" name="password" type="password" autoComplete="current-password" required />
        </div>
        <button className="btn primary" type="submit">
          登录
        </button>
      </form>
    </main>
  );
}
