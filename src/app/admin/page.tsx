import Link from "next/link";
import { AdminFrame } from "@/components/admin/AdminFrame";
import { DeploymentStatusCard } from "@/components/admin/DeploymentStatusCard";
import { requireAdmin } from "@/lib/auth/session";
import { dashboardStats, listAdminPostSummaries } from "@/lib/db/queries";
import { formatDate } from "@/lib/content/format";
import { resolveAdminTheme } from "@/admin/themes/registry";
import { getSiteSettings } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  await requireAdmin();
  const stats = dashboardStats();
  const recent = listAdminPostSummaries({ limit: 4 }).posts;
  const currentAdminTheme = resolveAdminTheme(getSiteSettings().activeTheme);

  return (
    <AdminFrame
      title="概览"
      subtitle="站点健康、快捷动作和最近活动。完整管理功能放在“内容”。"
      breadcrumbs={[{ label: "概览" }]}
      activeNav="/admin"
      action={<Link className="btn primary" href="/admin/posts/new">写新草稿</Link>}
    >
      <div className="dashboard-grid">
        <section className="stats-grid">
          <Link className="stat-card" href="/admin/posts?status=published"><strong>{stats.published}</strong><span>已发布</span></Link>
          <Link className="stat-card" href="/admin/posts?status=draft"><strong>{stats.drafts}</strong><span>草稿</span></Link>
          <Link className="stat-card" href="/admin/posts?status=trashed"><strong>{stats.trashed}</strong><span>回收站</span></Link>
          <Link className="stat-card" href="/admin/media"><strong>{stats.media}</strong><span>媒体</span></Link>
        </section>
        <section className="admin-panel dashboard-theme-status">
          <div>
            <span className="deployment-kicker">Appearance</span>
            <h2>{currentAdminTheme.theme.meta.variantLabel}</h2>
            <p>前台与 ManJyun Admin 正在使用同一主题语言。</p>
          </div>
          <Link className="btn" href="/admin/themes">管理外观</Link>
        </section>
        <DeploymentStatusCard />
        <section className="admin-panel quick-panel">
          <h2 className="section-title">快捷动作</h2>
          <div className="quick-actions">
            <Link className="btn primary" href="/admin/posts/new">新建内容</Link>
            <Link className="btn" href="/admin/posts?status=draft">查看草稿</Link>
            <Link className="btn" href="/admin/settings">维护站点设置</Link>
            <Link className="btn" href="/" target="_blank">查看公开站点 ↗</Link>
          </div>
        </section>
        <section className="admin-panel activity-panel">
          <h2 className="section-title">最近活动</h2>
          <div className="posts-list">
            {recent.length ? recent.map((post) => (
              <Link className="post-row" href={`/admin/posts/${post.id}`} key={post.id}>
                <span className="post-date">{formatDate(post.updatedAt)}</span>
                <span className="post-title">{post.title}</span>
                <span className={`status-pill ${post.status}`}>
                  {post.status === "published" ? "已发布" : "草稿"}
                </span>
              </Link>
            )) : <p className="empty-state">还没有活动，先写第一篇草稿。</p>}
          </div>
        </section>
      </div>
    </AdminFrame>
  );
}
