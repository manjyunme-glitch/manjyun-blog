import Link from "next/link";
import { PublicInteractions } from "@/components/theme/PublicInteractions";
import { PostToc } from "@/components/theme/PostToc";
import { formatDate, hostFromUrl, uptimeFrom } from "@/lib/content/format";
import { splitCommaList } from "@/lib/content/slug";
import type { HomeModule, NavLink, PostRecord } from "@/types/blog";
import type {
  ThemeArchiveProps,
  ThemeDefinition,
  ThemeHomeProps,
  ThemePageProps,
  ThemePostProps
} from "@/themes/types";

function configList(config: Record<string, unknown>, key: string, fallback: string) {
  const value = config[key];
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value === "string") return splitCommaList(value);
  return splitCommaList(fallback);
}

function LinkGlyph({ link }: { link: NavLink }) {
  if (link.iconUrl) {
    return (
      <span className="link-icon" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={link.iconUrl} alt="" loading="lazy" />
      </span>
    );
  }

  return <span className="link-letter">{link.label.slice(0, 1)}</span>;
}

function isExternalUrl(url: string) {
  return /^https?:\/\//i.test(url);
}

function Shell({
  settings,
  navLinks,
  children,
  wide = false
}: {
  settings: ThemeHomeProps["settings"];
  navLinks: NavLink[];
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <>
      <a className="skip-link" href="#main-content">
        跳到内容
      </a>
      <nav className="site-nav">
        <Link className="nav-brand" href="/">
          {settings.siteTitle}
          <span>.</span>
        </Link>
        <div className="nav-links">
          {navLinks.map((link) => (
            <Link key={link.id} className="nav-link" href={link.url}>
              {link.label}
            </Link>
          ))}
        </div>
      </nav>
      <div className={`public-wrap ${wide ? "public-wrap-wide" : ""}`}>
        <main id="main-content">{children}</main>
        <footer className="site-footer">
          <span>&copy; {new Date().getFullYear()} {settings.siteTitle}</span>
          <div className="footer-right">
            <span className="uptime">
              <span className="uptime-dot" />
              uptime: {uptimeFrom(settings.uptimeStart)}
            </span>
            <span>hosted on my own infra</span>
          </div>
        </footer>
      </div>
      <PublicInteractions />
    </>
  );
}

function PromptBlock({
  title,
  command,
  output
}: {
  title: string;
  command: string;
  output?: string;
}) {
  return (
    <div className="prompt-block">
      <span className="line">
        <span className="user">{title}</span>
        <span className="at">@</span>
        <span className="host">homelab</span>:<span className="path">~</span>${" "}
        <span className="cmd">{command}</span>
      </span>
      {output ? (
        <span className="line output">
          {output}
          <span className="cursor" />
        </span>
      ) : null}
    </div>
  );
}

function Section({
  title,
  moreHref,
  children
}: {
  title: string;
  moreHref?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">{title}</h2>
        {moreHref ? (
          <Link className="section-more" href={moreHref}>
            all
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function PostList({
  posts,
  empty,
  detailed = false
}: {
  posts: PostRecord[];
  empty: string;
  detailed?: boolean;
}) {
  if (!posts.length) {
    return <p className="empty-state">{empty}</p>;
  }

  return (
    <div className={`posts-list ${detailed ? "posts-list-detailed" : ""}`}>
      {posts.map((post) => {
        const href = post.type === "project" ? `/projects/${post.slug}` : `/posts/${post.slug}`;
        const tags = post.tags ?? [];

        return (
          <article key={post.id} className="post-row">
            <span className="post-date">{formatDate(post.publishedAt ?? post.createdAt)}</span>
            <Link className="post-body" href={href}>
              <span className="post-title">{post.title}</span>
              {detailed && post.excerpt ? (
                <span className="post-excerpt">{post.excerpt}</span>
              ) : null}
            </Link>
            {tags.length ? (
              <span className="post-tags">
                {tags.slice(0, 4).map((tag) => (
                  <Link key={tag.id} href={`/tag/${tag.slug}`}>
                    {tag.name}
                  </Link>
                ))}
              </span>
            ) : (
              <span className="post-tags post-tags-empty" aria-hidden="true" />
            )}
            <span className="post-kind">{post.type}</span>
          </article>
        );
      })}
    </div>
  );
}

function Home(props: ThemeHomeProps) {
  const { settings, modules, navLinks, frequentLinks, posts, projects } = props;
  const tags = splitCommaList(settings.heroTags);
  const enabledModules = [...modules]
    .filter((module) => module.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const renderModule = (module: HomeModule) => {
    const config = module.config ?? {};

    switch (module.id) {
      case "recentPosts":
        return (
          <Section
            key={module.id}
            title={String(config.title ?? "Recent Posts")}
            moreHref="/posts"
          >
            <PostList posts={posts} empty="还没有发布文章。登录后台写第一篇。" />
          </Section>
        );
      case "now":
        return (
          <Section key={module.id} title={String(config.title ?? "Now")}>
            <div className="now-panel">
              <div className="now-status">
                <span className="now-dot" />
                online
              </div>
              <p>
                <strong>正在折腾：</strong>
                {String(config.workingOn ?? "暂无记录")}
              </p>
              <p>
                <strong>最近在看：</strong>
                {String(config.reading ?? "暂无记录")}
              </p>
              <div className="done-items">
                {Array.isArray(config.completed)
                  ? config.completed.map((item) => (
                      <span key={String(item)} className="done-item">
                        {String(item)}
                      </span>
                    ))
                  : null}
              </div>
            </div>
          </Section>
        );
      case "projects":
        return (
          <Section
            key={module.id}
            title={String(config.title ?? "Projects")}
            moreHref="/projects"
          >
            <PostList posts={projects} empty="还没有发布项目记录。" />
          </Section>
        );
      case "frequentLinks":
        return (
          <Section key={module.id} title={String(config.title ?? "Frequent")}>
            {frequentLinks.length ? (
              <div className="links-grid">
                {frequentLinks.map((link) => (
                  <a
                    className="link-card"
                    href={link.url}
                    key={link.id}
                    target={isExternalUrl(link.url) ? "_blank" : undefined}
                    rel={isExternalUrl(link.url) ? "noopener noreferrer" : undefined}
                  >
                    <LinkGlyph link={link} />
                    <span>
                      <strong>{link.label}</strong>
                      <small>{hostFromUrl(link.url)}</small>
                    </span>
                  </a>
                ))}
              </div>
            ) : (
              <p className="empty-state">后台设置常用链接后会显示在这里。</p>
            )}
          </Section>
        );
      case "stack": {
        const stackItems = configList(config, "items", settings.stackItems);
        return (
          <Section key={module.id} title={String(config.title ?? "Stack")}>
            <div className="stack-grid">
              {stackItems.map((item) => (
                <span key={item} className="stack-item">
                  {item}
                </span>
              ))}
            </div>
          </Section>
        );
      }
      default:
        return null;
    }
  };

  return (
    <Shell settings={settings} navLinks={navLinks}>
      <section className="hero">
        <PromptBlock
          title={settings.siteTitle}
          command="cat about.me"
          output="loading profile..."
        />
        <h1 className="site-title">
          {settings.siteTitle}
          <span>.</span>
        </h1>
        <p className="hero-bio">{settings.heroBio}</p>
        <div className="tag-cloud">
          {tags.map((tag) => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
        </div>
      </section>
      {enabledModules.map(renderModule)}
    </Shell>
  );
}

function Post(props: ThemePostProps) {
  const { settings, navLinks, post, rendered, readingTime, previous, next } = props;
  const backHref = post.type === "project" ? "/projects" : "/posts";
  const hasToc = rendered.toc.length >= 2;

  return (
    <Shell settings={settings} navLinks={navLinks} wide={hasToc}>
      <Link href={backHref} className="back-link article-back-link">
        ← cd {post.type === "project" ? "/projects" : "/posts"}
      </Link>
      <article className={`article ${hasToc ? "article-with-toc" : ""}`} aria-label={post.title}>
        {hasToc ? <PostToc items={rendered.toc} /> : null}

        <div className="article-main">
          <header className="article-header">
            <div className="article-meta">
              <time dateTime={post.publishedAt ?? post.createdAt}>
                {formatDate(post.publishedAt ?? post.createdAt)}
              </time>
              {post.tags[0] ? (
                <Link href={`/tag/${post.tags[0].slug}`}>{post.tags[0].name}</Link>
              ) : null}
              <span>{readingTime}</span>
            </div>
            {post.excerpt ? <p className="article-excerpt">{post.excerpt}</p> : null}
          </header>

          {post.cover ? (
            <figure className="article-cover">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={post.cover} alt={post.title} loading="lazy" />
            </figure>
          ) : null}

          <div
            className="article-content gh-content"
            dangerouslySetInnerHTML={{ __html: rendered.html }}
          />

          <footer className="article-footer">
            {post.tags.length ? (
              <div className="article-tags">
                {post.tags.map((tag) => (
                  <Link className="tag" key={tag.id} href={`/tag/${tag.slug}`}>
                    {tag.name}
                  </Link>
                ))}
              </div>
            ) : null}
            <div className="article-nav">
              {previous ? (
                <Link
                  className="article-nav-link"
                  href={previous.type === "project" ? `/projects/${previous.slug}` : `/posts/${previous.slug}`}
                >
                  <span>← 上一篇</span>
                  <strong>{previous.title}</strong>
                </Link>
              ) : <span />}
              {next ? (
                <Link
                  className="article-nav-link next"
                  href={next.type === "project" ? `/projects/${next.slug}` : `/posts/${next.slug}`}
                >
                  <span>下一篇 →</span>
                  <strong>{next.title}</strong>
                </Link>
              ) : <span />}
            </div>
          </footer>
        </div>
      </article>
    </Shell>
  );
}

function Archive(props: ThemeArchiveProps) {
  const entryLabel = props.posts.length === 1 ? "entry" : "entries";
  const command =
    props.posts[0]?.type === "project" || props.title === props.settings.projectsTitle
      ? "ls /projects/"
      : "ls /posts/";

  return (
    <Shell settings={props.settings} navLinks={props.navLinks}>
      {props.backHref ? (
        <Link href={props.backHref} className="back-link article-back-link">
          ← cd {props.backLabel ?? "/posts"}
        </Link>
      ) : null}
      <div className="archive-header">
        <PromptBlock title={props.settings.siteTitle} command={command} />
        <h1 className="archive-title">{props.title}</h1>
        <p className="archive-desc">{props.description}</p>
        <div className="archive-statline">
          <span>{props.posts.length} {entryLabel}</span>
          <span>sorted by published date</span>
        </div>
      </div>
      <PostList posts={props.posts} empty="这里还没有内容。" detailed />
    </Shell>
  );
}

function Page(props: ThemePageProps) {
  return (
    <Shell settings={props.settings} navLinks={props.navLinks}>
      <article className="article page-article">
        <header className="article-header">
          <h1 className="article-title">{props.title}</h1>
        </header>
        <div
          className="article-content gh-content"
          dangerouslySetInnerHTML={{ __html: props.rendered.html }}
        />
      </article>
    </Shell>
  );
}

export const manjyunConsoleTheme: ThemeDefinition = {
  meta: {
    id: "manjyun-console",
    name: "ManJyun Console",
    version: "0.1.0",
    description: "A compact terminal-inspired personal blog theme."
  },
  tokens: {
    bg: "#0a0a0a",
    surface: "#141414",
    text: "#e0ddd5",
    accent: "#e8a84c"
  },
  slots: {
    Home,
    Post,
    Archive,
    Page
  }
};
