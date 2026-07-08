import Link from "next/link";
import { AdminFrame } from "@/components/admin/AdminFrame";
import { DeploymentStatusCard } from "@/components/admin/DeploymentStatusCard";
import { requireAdmin } from "@/lib/auth/session";
import { dashboardStats, listPosts } from "@/lib/db/queries";
import { formatDate } from "@/lib/content/format";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  await requireAdmin();
  const stats = dashboardStats();
  const recent = listPosts({ limit: 4 });

  return (
    <AdminFrame
      title="概览"
      subtitle="站点健康、快捷动作和最近活动。完整内容管理放在“文章”。"
      breadcrumbs={[{ label: "概览" }]}
      activeNav="/admin"
      action={<Link className="btn primary" href="/admin/posts/new">写新草稿</Link>}
    >
      <div className="dashboard-grid">
        <section className="stats-grid">
          <div className="stat-card"><strong>{stats.published}</strong><span>已发布</span></div>
          <div className="stat-card"><strong>{stats.drafts}</strong><span>草稿</span></div>
          <div className="stat-card"><strong>{stats.trashed}</strong><span>回收站</span></div>
          <div className="stat-card"><strong>{stats.media}</strong><span>媒体</span></div>
        </section>
        <DeploymentStatusCard />
        <section className="admin-panel quick-panel">
          <h2 className="section-title">快捷动作</h2>
          <div className="quick-actions">
            <Link className="btn primary" href="/admin/posts/new">新建文章</Link>
            <Link className="btn" href="/admin/posts?status=draft">查看草稿</Link>
            <Link className="btn" href="/admin/posts?status=trashed">打开回收站</Link>
            <Link className="btn" href="/admin/settings">维护首页 Stack</Link>
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
