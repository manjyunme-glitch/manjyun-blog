import { redirect } from "next/navigation";
import { setupAction } from "@/app/admin/actions";
import { isSetupComplete } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function SetupPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (isSetupComplete()) redirect("/admin");
  const { error } = await searchParams;

  return (
    <main className="auth-page">
      <form className="auth-card form-grid" action={setupAction}>
        <div>
          <h1 className="admin-title">首次设置</h1>
          <p className="admin-subtitle">创建唯一管理员账号。完成后 setup 会自动关闭。</p>
        </div>
        {error ? <p className="error-text">{decodeURIComponent(error)}</p> : null}
        <div className="field">
          <label>用户名</label>
          <input className="input" name="username" autoComplete="username" required />
        </div>
        <div className="field">
          <label>密码</label>
          <input className="input" name="password" type="password" autoComplete="new-password" minLength={8} required />
        </div>
        <button className="btn primary" type="submit">
          创建管理员
        </button>
      </form>
    </main>
  );
}
