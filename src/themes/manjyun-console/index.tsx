import Link from "next/link";
import { PublicInteractions } from "@/components/theme/PublicInteractions";
import { PostToc } from "@/components/theme/PostToc";
import {
  THEME_API_VERSION,
  type ThemeCollectionViewModel,
  type ThemeDefinition,
  type ThemeEntrySummaryViewModel,
  type ThemeEntryViewModel,
  type ThemeHomeModuleViewModel,
  type ThemeHomeViewModel,
  type ThemeNavigationItemViewModel,
  type ThemeNavigationViewModel,
  type ThemeNotFoundViewModel,
  type ThemePageViewModel,
  type ThemeSiteViewModel
} from "@/themes/types";

type ThemeCardLink = ThemeNavigationItemViewModel & { hostLabel: string };

function LinkGlyph({ link }: { link: ThemeCardLink }) {
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

function Shell({
  site,
  navigation,
  children,
  wide = false,
  home = false
}: {
  site: ThemeSiteViewModel;
  navigation: ThemeNavigationViewModel;
  children: React.ReactNode;
  wide?: boolean;
  home?: boolean;
}) {
  return (
    <div className="theme-root" data-theme="manjyun-console">
      <a className="skip-link" href="#main-content">
        跳到内容
      </a>
      <nav className="site-nav" data-site-nav aria-label={navigation.label}>
        <Link className="nav-brand" href={site.homeHref}>
          {site.title}
          <span>.</span>
        </Link>
        <div className="nav-links">
          {navigation.items.map((item) =>
            item.isExternal ? (
              <a
                key={item.id}
                className="nav-link"
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {item.label}
              </a>
            ) : (
              <Link
                key={item.id}
                className="nav-link"
                href={item.href}
                aria-current={item.isCurrent ? "page" : undefined}
              >
                {item.label}
              </Link>
            )
          )}
        </div>
      </nav>
      <div className={`public-wrap ${wide ? "public-wrap-wide" : ""} ${home ? "public-wrap-home" : ""}`}>
        <main id="main-content">{children}</main>
        <footer className="site-footer">
          <span>{site.footer.copyrightLabel}</span>
          <div className="footer-right">
            <span className="uptime">
              <span className="uptime-dot" aria-hidden="true" />
              {site.footer.uptimeLabel}
            </span>
            <span>{site.footer.hostingLabel}</span>
          </div>
        </footer>
      </div>
      <PublicInteractions />
    </div>
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
    <div className="prompt-block" aria-hidden="true">
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
  id,
  title,
  moreLink,
  children
}: {
  id: string;
  title: string;
  moreLink?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section className={`section section-${id}`}>
      <div className="section-head">
        <h2 className="section-title">{title}</h2>
        {moreLink ? (
          <Link className="section-more" href={moreLink.href}>
            {moreLink.label}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function PostList({
  entries,
  empty,
  detailed = false
}: {
  entries: ThemeEntrySummaryViewModel[];
  empty: string;
  detailed?: boolean;
}) {
  if (!entries.length) {
    return <p className="empty-state">{empty}</p>;
  }

  return (
    <div className={`posts-list ${detailed ? "posts-list-detailed" : ""}`}>
      {entries.map((entry) => (
        <article key={entry.id} className="post-row">
          <time className="post-date" dateTime={entry.published.iso}>
            {entry.published.label}
          </time>
          <Link className="post-body" href={entry.href}>
            <span className="post-title">{entry.title}</span>
            {detailed && entry.excerpt ? (
              <span className="post-excerpt">{entry.excerpt}</span>
            ) : null}
          </Link>
          {entry.tags.length ? (
            <span className="post-tags">
              {entry.tags.slice(0, 4).map((tag) => (
                <Link key={tag.id} href={tag.href}>
                  {tag.label}
                </Link>
              ))}
            </span>
          ) : (
            <span className="post-tags post-tags-empty" aria-hidden="true" />
          )}
          <span className="post-kind">{entry.typeLabel}</span>
        </article>
      ))}
    </div>
  );
}

function HomeModule({ module }: { module: ThemeHomeModuleViewModel }) {
  switch (module.kind) {
    case "entries":
      return (
        <Section id={module.id} title={module.title} moreLink={module.moreLink}>
          <PostList entries={module.entries} empty={module.emptyMessage} />
        </Section>
      );
    case "now":
      return (
        <Section id={module.id} title={module.title}>
          <div className="now-panel">
            <div className="now-status">
              <span className="now-dot" aria-hidden="true" />
              {module.statusLabel}
            </div>
            {module.facts.map((fact) => (
              <p key={fact.label}>
                <strong>{fact.label}</strong>
                {fact.value}
              </p>
            ))}
            <div className="done-items">
              {module.completed.map((item) => (
                <span key={item} className="done-item">
                  {item}
                </span>
              ))}
            </div>
          </div>
        </Section>
      );
    case "links":
      return (
        <Section id={module.id} title={module.title}>
          {module.links.length ? (
            <div className="links-grid">
              {module.links.map((link) => (
                link.isExternal ? (
                  <a className="link-card" href={link.href} key={link.id} target="_blank" rel="noopener noreferrer">
                    <LinkGlyph link={link} />
                    <span><strong>{link.label}</strong><small>{link.hostLabel}</small></span>
                  </a>
                ) : (
                  <Link className="link-card" href={link.href} key={link.id}>
                    <LinkGlyph link={link} />
                    <span><strong>{link.label}</strong><small>{link.hostLabel}</small></span>
                  </Link>
                )
              ))}
            </div>
          ) : (
            <p className="empty-state">{module.emptyMessage}</p>
          )}
        </Section>
      );
    case "stack":
      return (
        <Section id={module.id} title={module.title}>
          <div className="stack-grid">
            {module.items.map((item) => (
              <span key={item} className="stack-item">
                {item}
              </span>
            ))}
          </div>
        </Section>
      );
  }
}

function Home({ model }: { model: ThemeHomeViewModel }) {
  return (
    <Shell site={model.site} navigation={model.navigation} home>
      <section className="hero">
        <PromptBlock
          title={model.site.title}
          command="cat about.me"
          output="profile loaded."
        />
        <h1 className="site-title">
          {model.hero.title}
          <span>.</span>
        </h1>
        <p className="hero-bio">{model.hero.bio}</p>
        <div className="tag-cloud">
          {model.hero.tags.map((tag) => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
        </div>
      </section>
      <div className="home-modules">
        {model.modules.map((module) => (
          <HomeModule key={module.id} module={module} />
        ))}
      </div>
    </Shell>
  );
}

function Entry({ model }: { model: ThemeEntryViewModel }) {
  const hasToc = model.content.toc.length >= 2;

  return (
    <Shell site={model.site} navigation={model.navigation} wide={hasToc}>
      <Link href={model.backLink.href} className="back-link article-back-link">
        ← cd {model.backLink.label}
      </Link>
      <article
        className={`article ${hasToc ? "article-with-toc" : ""}`}
        aria-labelledby="entry-title"
      >
        {hasToc ? <PostToc items={model.content.toc} /> : null}

        <div className="article-main">
          {hasToc ? (
            <details className="mobile-toc">
              <summary>内容大纲 <span>{model.content.toc.length}</span></summary>
              <nav aria-label="内容大纲">
                {model.content.toc.map((item) => (
                  <a className={`mobile-toc-h${item.level}`} href={`#${item.id}`} key={item.id}>
                    {item.text}
                  </a>
                ))}
              </nav>
            </details>
          ) : null}
          <header className="article-header">
            <h1 className="article-title" id="entry-title">{model.title}</h1>
            <div className="article-meta">
              <time dateTime={model.published.iso}>{model.published.label}</time>
              {model.tags[0] ? (
                <Link href={model.tags[0].href}>{model.tags[0].label}</Link>
              ) : null}
              <span>{model.readingTimeLabel}</span>
            </div>
            {model.excerpt ? <p className="article-excerpt">{model.excerpt}</p> : null}
          </header>

          {model.cover ? (
            <figure className="article-cover">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={model.cover.src} alt={model.cover.alt} loading="eager" />
            </figure>
          ) : null}

          <div
            className="article-content gh-content"
            dangerouslySetInnerHTML={{ __html: model.content.html }}
          />

          <footer className="article-footer">
            {model.tags.length ? (
              <div className="article-tags">
                {model.tags.map((tag) => (
                  <Link className="tag" key={tag.id} href={tag.href}>
                    {tag.label}
                  </Link>
                ))}
              </div>
            ) : null}
            <div className="article-nav">
              {model.adjacent.previous ? (
                <Link className="article-nav-link" href={model.adjacent.previous.href}>
                  <span>← {model.adjacent.previous.label}</span>
                  <strong>{model.adjacent.previous.title}</strong>
                </Link>
              ) : (
                <span />
              )}
              {model.adjacent.next ? (
                <Link
                  className="article-nav-link next"
                  href={model.adjacent.next.href}
                >
                  <span>{model.adjacent.next.label} →</span>
                  <strong>{model.adjacent.next.title}</strong>
                </Link>
              ) : (
                <span />
              )}
            </div>
          </footer>
        </div>
      </article>
    </Shell>
  );
}

function Collection({ model }: { model: ThemeCollectionViewModel }) {
  return (
    <Shell site={model.site} navigation={model.navigation}>
      {model.backLink ? (
        <Link href={model.backLink.href} className="back-link article-back-link">
          ← cd {model.backLink.label}
        </Link>
      ) : null}
      <div className="archive-header">
        <PromptBlock title={model.site.title} command={`ls ${model.pathLabel}/`} />
        <h1 className="archive-title">{model.title}</h1>
        <p className="archive-desc">{model.description}</p>
        <div className="archive-statline">
          <span>{model.countLabel}</span>
          <span>{model.sortLabel}</span>
        </div>
      </div>
      <PostList entries={model.entries} empty={model.emptyMessage} detailed />
    </Shell>
  );
}

function Page({ model }: { model: ThemePageViewModel }) {
  return (
    <Shell site={model.site} navigation={model.navigation}>
      <article className="article page-article">
        <header className="article-header">
          <h1 className="article-title">{model.title}</h1>
        </header>
        <div
          className="article-content gh-content"
          dangerouslySetInnerHTML={{ __html: model.content.html }}
        />
      </article>
    </Shell>
  );
}

function NotFound({ model }: { model: ThemeNotFoundViewModel }) {
  return (
    <Shell site={model.site} navigation={model.navigation}>
      <section className="not-found-page">
        <PromptBlock
          title={model.site.title}
          command="cat missing"
          output={`${model.statusCode}: not found`}
        />
        <h1 className="archive-title">{model.title}</h1>
        <p className="archive-desc">{model.description}</p>
        <div className="not-found-actions">
          <Link className="back-link" href={model.homeLink.href}>
            {model.homeLink.label}
          </Link>
        </div>
      </section>
    </Shell>
  );
}

export const manjyunConsoleTheme: ThemeDefinition = {
  meta: {
    id: "manjyun-console",
    name: "ManJyun Console",
    version: "1.0.0",
    description: "A compact terminal-inspired personal blog theme."
  },
  apiVersion: THEME_API_VERSION,
  coreCompatibility: {
    minimum: "0.1.0",
    maximumExclusive: "1.0.0"
  },
  capabilities: [
    "home-modules",
    "entry-toc",
    "entry-navigation",
    "custom-pages",
    "not-found"
  ],
  tokens: {
    bg: "#0a0a0a",
    surface: "#141414",
    text: "#e0ddd5",
    accent: "#e8a84c"
  },
  slots: {
    Home,
    Collection,
    Entry,
    Page,
    NotFound
  }
};
