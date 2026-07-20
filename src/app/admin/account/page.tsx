import { changePasswordAction } from "@/app/admin/actions";
import { AdminFrame } from "@/components/admin/AdminFrame";
import { requireAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AdminAccountPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const admin = await requireAdmin();
  const { error, success } = await searchParams;

  return (
    <AdminFrame
      title="账号安全"
      subtitle={`当前管理员：${admin.username}`}
      breadcrumbs={[
        { label: "概览", href: "/admin" },
        { label: "账号安全" }
      ]}
    >
      <form className="admin-panel form-grid" action={changePasswordAction}>
        {error ? (
          <p className="admin-notice error" role="alert">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="admin-notice success" role="status">
            {success}
          </p>
        ) : null}
        <div className="field">
          <label htmlFor="current-password">当前密码</label>
          <input
            id="current-password"
            className="input"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            maxLength={1024}
            autoFocus
            required
          />
        </div>
        <div className="field">
          <label htmlFor="new-password">新密码</label>
          <input
            id="new-password"
            className="input"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={1024}
            required
            aria-describedby="new-password-hint"
          />
          <p className="field-hint" id="new-password-hint">
            至少 8 位；成功后当前浏览器会获得新会话，其他已登录会话全部失效。
          </p>
        </div>
        <div className="field">
          <label htmlFor="new-password-confirm">确认新密码</label>
          <input
            id="new-password-confirm"
            className="input"
            name="passwordConfirm"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={1024}
            required
          />
        </div>
        <div className="btn-row">
          <button className="btn primary" type="submit">
            更新密码并撤销其他会话
          </button>
        </div>
      </form>
    </AdminFrame>
  );
}
