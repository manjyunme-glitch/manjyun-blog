import { redirect } from "next/navigation";
import { setupAction } from "@/app/admin/actions";
import { isSetupComplete } from "@/lib/db/queries";
import { AdminThemeChrome } from "@/components/admin/AdminThemeChrome";

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
        <AdminThemeChrome slot="AuthDecoration" />
        <div>
          <h1 className="admin-title">初始化 ManJyun Admin</h1>
          <p className="admin-subtitle">
            创建唯一管理员账号；初始化令牌会在首次启动日志中显示，并保存在数据目录。
          </p>
        </div>
        {error ? <p className="admin-notice error" role="alert" tabIndex={-1}>{error}</p> : null}
        <div className="field">
          <label htmlFor="setup-token">初始化令牌</label>
          <input
            id="setup-token"
            className="input"
            name="setupToken"
            type="password"
            autoComplete="off"
            maxLength={512}
            spellCheck={false}
            autoFocus
            required
            aria-describedby="setup-token-hint"
          />
          <p className="field-hint" id="setup-token-hint">
            自动生成的令牌只用于首次初始化，成功后会立即失效。
          </p>
        </div>
        <div className="field">
          <label htmlFor="setup-username">用户名</label>
          <input id="setup-username" className="input" name="username" autoComplete="username" maxLength={128} required />
        </div>
        <div className="field">
          <label htmlFor="setup-password">密码</label>
          <input id="setup-password" className="input" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={1024} required aria-describedby="setup-password-hint" />
          <p className="field-hint" id="setup-password-hint">至少 8 位，建议使用独立于其他服务的密码。</p>
        </div>
        <div className="field">
          <label htmlFor="setup-password-confirm">确认密码</label>
          <input id="setup-password-confirm" className="input" name="passwordConfirm" type="password" autoComplete="new-password" minLength={8} maxLength={1024} required />
        </div>
        <button className="btn primary" type="submit">
          创建管理员
        </button>
      </form>
    </main>
  );
}
