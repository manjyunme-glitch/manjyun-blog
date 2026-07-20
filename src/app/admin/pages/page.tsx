import { randomUUID } from "node:crypto";
import Link from "next/link";
import { AdminFrame } from "@/components/admin/AdminFrame";
import { createCustomPageAction } from "@/app/admin/pages/actions";
import { requireAdmin } from "@/lib/auth/session";
import { contentHref } from "@/lib/content/content-types";
import { listAdminPages } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

const statusLabels = {
  published: "已发布",
  draft: "草稿",
  trashed: "回收站"
} as const;

export default async function AdminPagesPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireAdmin();
  const pages = listAdminPages();
  const { error } = await searchParams;
  const createIdempotencyKey = randomUUID();

  return (
    <AdminFrame
      title="独立页面"
      subtitle="管理 About 与旧版本创建的自定义页面；公开地址继续保持 /{slug}。"
      breadcrumbs={[
        { label: "概览", href: "/admin" },
        { label: "独立页面" }
      ]}
    >
      <div className="settings-stack">
        <section className="settings-card form-grid">
          <div className="settings-section-head">
            <div>
              <h2>新建页面</h2>
              <p>先创建草稿，再进入完整 Markdown 编辑器完善并发布。</p>
            </div>
          </div>
          {error ? (
            <div className="admin-notice error" role="alert">
              <strong>无法创建页面</strong>
              <span>{error}</span>
            </div>
          ) : null}
          <form action={createCustomPageAction} className="settings-two">
            <input
              type="hidden"
              name="idempotencyKey"
              value={createIdempotencyKey}
            />
            <div className="field">
              <label htmlFor="custom-page-title">页面标题</label>
              <input
                className="input"
                id="custom-page-title"
                name="title"
                maxLength={200}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="custom-page-slug">Slug（可留空）</label>
              <input
                className="input"
                id="custom-page-slug"
                name="slug"
                maxLength={200}
                placeholder="留空自动生成 pages-001"
              />
            </div>
            <div className="btn-row">
              <button className="btn primary" type="submit">创建草稿并编辑</button>
            </div>
          </form>
        </section>

        <section className="settings-card">
          <div className="settings-section-head">
            <div>
              <h2>全部独立页面</h2>
              <p>
                About 现在也是这里的一条普通页面记录，是 <code>/about</code> 的唯一内容源。
              </p>
            </div>
            <span className="chip">{pages.length}</span>
          </div>
          {pages.length ? (
            <div className="content-table-wrap">
              <table className="content-table">
                <thead>
                  <tr>
                    <th>标题</th>
                    <th>路径</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {pages.map((page) => (
                    <tr key={page.id}>
                      <td data-label="标题">
                        <strong>{page.title}</strong>
                        {page.slug === "about" ? <span className="chip">About</span> : null}
                      </td>
                      <td data-label="路径"><code>{contentHref("page", page.slug)}</code></td>
                      <td data-label="状态">
                        <span className={`status-pill ${page.status}`}>
                          {statusLabels[page.status]}
                        </span>
                      </td>
                      <td data-label="操作">
                        <div className="btn-row">
                          <Link className="btn subtle" href={`/admin/pages/${page.id}`}>
                            编辑
                          </Link>
                          {page.status === "published" ? (
                            <Link
                              className="btn ghost"
                              href={contentHref("page", page.slug)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              查看 ↗
                            </Link>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty-state">暂无页面。可以在上方创建第一条页面草稿。</p>
          )}
        </section>
      </div>
    </AdminFrame>
  );
}
