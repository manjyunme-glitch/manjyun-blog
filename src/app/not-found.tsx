import Link from "next/link";

export default function NotFound() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="prompt-block">
          <span className="line">
            <span className="user">manjyun</span>@<span className="host">homelab</span>
            :<span className="path">~</span>$ <span className="cmd">cat missing</span>
          </span>
          <span className="line output">404: not found</span>
        </div>
        <h1 className="admin-title">页面不存在</h1>
        <p className="admin-subtitle">这个路径没有找到可以展示的内容。</p>
        <div className="btn-row" style={{ marginTop: "1rem" }}>
          <Link className="btn primary" href="/">
            返回首页
          </Link>
        </div>
      </div>
    </div>
  );
}
