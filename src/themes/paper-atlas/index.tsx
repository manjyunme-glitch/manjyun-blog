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
  type ThemeLinkViewModel,
  type ThemeNotFoundViewModel,
  type ThemePageContextViewModel,
  type ThemePageViewModel
} from "@/themes/types";

function SmartLink({
  link,
  className,
  children
}: {
  link: ThemeLinkViewModel;
  className?: string;
  children?: React.ReactNode;
}) {
  if (link.isExternal) {
    return (
      <a className={className} href={link.href} target="_blank" rel="noopener noreferrer">
        {children ?? link.label}
      </a>
    );
  }
  return (
    <Link className={className} href={link.href}>
      {children ?? link.label}
    </Link>
  );
}

function PaperShell({
  model,
  children,
  reading = false
}: {
  model: ThemePageContextViewModel;
  children: React.ReactNode;
  reading?: boolean;
}) {
  return (
    <div className="paper-theme" data-theme="paper-atlas">
      <a className="paper-skip" href="#main-content">
        跳到内容
      </a>
      <header className="paper-header" data-site-nav>
        <Link className="paper-brand" href={model.site.homeHref}>
          <span className="paper-brand-mark">PA</span>
          <span>
            <strong>{model.site.title}</strong>
            <small>notes · projects · field records</small>
          </span>
        </Link>
        <nav className="paper-nav" aria-label={model.navigation.label}>
          {model.navigation.items.map((item) =>
            item.isExternal ? (
              <a
                key={item.id}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-current={item.isCurrent ? "page" : undefined}
              >
                {item.label}
              </a>
            ) : (
              <Link
                key={item.id}
                href={item.href}
                aria-current={item.isCurrent ? "page" : undefined}
              >
                {item.label}
              </Link>
            )
          )}
        </nav>
      </header>
      <main id="main-content" className={`paper-main ${reading ? "paper-main-reading" : ""}`}>
        {children}
      </main>
      <footer className="paper-footer">
        <span>{model.site.footer.copyrightLabel}</span>
        <span>{model.site.footer.uptimeLabel}</span>
        <span>{model.site.footer.hostingLabel}</span>
      </footer>
      <PublicInteractions />
    </div>
  );
}

function EntryArtwork({ entry, feature = false }: { entry: ThemeEntrySummaryViewModel; feature?: boolean }) {
  if (entry.cover) {
    return (
      <span className={`paper-artwork ${feature ? "paper-artwork-feature" : ""}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={entry.cover.src} alt={entry.cover.alt} loading={feature ? "eager" : "lazy"} />
      </span>
    );
  }
  return (
    <span className={`paper-artwork paper-artwork-placeholder ${feature ? "paper-artwork-feature" : ""}`} aria-hidden="true">
      <span>{entry.typeLabel}</span>
      <strong>{entry.title.slice(0, 2)}</strong>
    </span>
  );
}

function EntryMeta({ entry }: { entry: ThemeEntrySummaryViewModel }) {
  return (
    <span className="paper-entry-meta">
      <span>{entry.typeLabel}</span>
      <time dateTime={entry.published.iso}>{entry.published.label}</time>
    </span>
  );
}

function FeatureEntry({ entry }: { entry: ThemeEntrySummaryViewModel }) {
  return (
    <article className="paper-feature">
      <Link
        href={entry.href}
        className="paper-feature-art"
        aria-label={`阅读${entry.title}`}
      >
        <EntryArtwork entry={entry} feature />
      </Link>
      <div className="paper-feature-copy">
        <EntryMeta entry={entry} />
        <h2>
          <Link href={entry.href}>{entry.title}</Link>
        </h2>
        <p>{entry.excerpt || "打开这篇记录，继续阅读完整内容。"}</p>
        <Link className="paper-read-link" href={entry.href}>
          阅读全文 <span>↗</span>
        </Link>
      </div>
    </article>
  );
}

function EntryIndex({ entries }: { entries: ThemeEntrySummaryViewModel[] }) {
  if (!entries.length) return null;
  return (
    <div className="paper-entry-index">
      {entries.map((entry, index) => (
        <article key={entry.id} className="paper-index-row">
          <span className="paper-index-number">{String(index + 1).padStart(2, "0")}</span>
          <div>
            <EntryMeta entry={entry} />
            <h3><Link href={entry.href}>{entry.title}</Link></h3>
            {entry.excerpt ? <p>{entry.excerpt}</p> : null}
          </div>
          <span className="paper-index-arrow" aria-hidden="true">→</span>
        </article>
      ))}
    </div>
  );
}

function HomeEntriesModule({ module }: { module: Extract<ThemeHomeModuleViewModel, { kind: "entries" }> }) {
  const [feature, ...rest] = module.entries;
  return (
    <section className={`paper-section paper-section-${module.id}`}>
      <div className="paper-section-head">
        <div>
          <span>Editorial selection</span>
          <h2>{module.title}</h2>
        </div>
        <SmartLink className="paper-all-link" link={module.moreLink}>
          {module.moreLink.label} <span>→</span>
        </SmartLink>
      </div>
      {feature ? (
        <>
          <FeatureEntry entry={feature} />
          <EntryIndex entries={rest} />
        </>
      ) : (
        <p className="paper-empty">{module.emptyMessage}</p>
      )}
    </section>
  );
}

function ProjectModule({ module }: { module: Extract<ThemeHomeModuleViewModel, { kind: "entries" }> }) {
  return (
    <section className="paper-section paper-project-section">
      <div className="paper-section-head">
        <div><span>Selected works</span><h2>{module.title}</h2></div>
        <SmartLink className="paper-all-link" link={module.moreLink}>{module.moreLink.label} <span>→</span></SmartLink>
      </div>
      {module.entries.length ? (
        <div className="paper-project-grid">
          {module.entries.map((entry) => (
            <article key={entry.id} className="paper-project-card">
              <Link href={entry.href} aria-label={`查看项目：${entry.title}`}>
                <EntryArtwork entry={entry} />
              </Link>
              <EntryMeta entry={entry} />
              <h3><Link href={entry.href}>{entry.title}</Link></h3>
              {entry.excerpt ? <p>{entry.excerpt}</p> : null}
              <div className="paper-card-tags">
                {entry.tags.slice(0, 4).map((tag) => <Link href={tag.href} key={tag.id}>{tag.label}</Link>)}
              </div>
            </article>
          ))}
        </div>
      ) : <p className="paper-empty">{module.emptyMessage}</p>}
    </section>
  );
}

function MarginModule({ module }: { module: Exclude<ThemeHomeModuleViewModel, { kind: "entries" }> }) {
  if (module.kind === "now") {
    return (
      <aside className="paper-margin-note paper-now">
        <span className="paper-note-pin">NOW</span>
        <h2>{module.title}</h2>
        <strong>{module.statusLabel}</strong>
        {module.facts.map((fact) => <p key={fact.label}><b>{fact.label}</b>{fact.value}</p>)}
        <div>{module.completed.map((item) => <span key={item}>✓ {item}</span>)}</div>
      </aside>
    );
  }
  if (module.kind === "stack") {
    return (
      <aside className="paper-margin-note paper-stack">
        <span className="paper-note-pin">TOOLS</span>
        <h2>{module.title}</h2>
        <div>{module.items.map((item) => <span key={item}>{item}</span>)}</div>
      </aside>
    );
  }
  return (
    <aside className="paper-margin-note paper-links">
      <span className="paper-note-pin">LINKS</span>
      <h2>{module.title}</h2>
      {module.links.length ? module.links.map((link) => (
        <SmartLink key={link.id} link={link}>
          <span>{link.label}</span><small>{link.hostLabel}</small>
        </SmartLink>
      )) : <p>{module.emptyMessage}</p>}
    </aside>
  );
}

function Home({ model }: { model: ThemeHomeViewModel }) {
  const entryModules = model.modules.filter(
    (module): module is Extract<ThemeHomeModuleViewModel, { kind: "entries" }> => module.kind === "entries"
  );
  const marginModules = model.modules.filter(
    (module): module is Exclude<ThemeHomeModuleViewModel, { kind: "entries" }> => module.kind !== "entries"
  );

  return (
    <PaperShell model={model}>
      <section className="paper-masthead">
        <div className="paper-masthead-kicker"><span>Vol. 01</span><span>Independent field notes</span></div>
        <h1>{model.hero.title}</h1>
        <p>{model.hero.bio}</p>
        <div className="paper-topic-line">
          <span>Filed under</span>
          {model.hero.tags.map((tag) => <span key={tag}>{tag}</span>)}
        </div>
      </section>
      <div className="paper-home-layout">
        <div className="paper-home-primary">
          {entryModules.map((module) =>
            module.id === "projects"
              ? <ProjectModule module={module} key={module.id} />
              : <HomeEntriesModule module={module} key={module.id} />
          )}
        </div>
        <div className="paper-home-margin">
          {marginModules.map((module) => <MarginModule module={module} key={module.id} />)}
        </div>
      </div>
    </PaperShell>
  );
}

function groupEntriesByYear(entries: ThemeEntrySummaryViewModel[]) {
  const groups = new Map<string, ThemeEntrySummaryViewModel[]>();
  for (const entry of entries) {
    const parsed = new Date(entry.published.iso);
    const year = Number.isNaN(parsed.getTime()) ? entry.published.label.slice(0, 4) : String(parsed.getFullYear());
    groups.set(year, [...(groups.get(year) ?? []), entry]);
  }
  return Array.from(groups.entries());
}

function Collection({ model }: { model: ThemeCollectionViewModel }) {
  const groups = groupEntriesByYear(model.entries);
  return (
    <PaperShell model={model}>
      <header className="paper-collection-head">
        {model.backLink ? <SmartLink className="paper-back" link={model.backLink}>← {model.backLink.label}</SmartLink> : null}
        <span>Index / {model.pathLabel}</span>
        <h1>{model.title}</h1>
        <p>{model.description}</p>
        <div><span>{model.countLabel}</span><span>{model.sortLabel}</span></div>
      </header>
      {groups.length ? groups.map(([year, entries]) => (
        <section className="paper-year-group" key={year}>
          <h2>{year}</h2>
          <EntryIndex entries={entries} />
        </section>
      )) : <p className="paper-empty">{model.emptyMessage}</p>}
    </PaperShell>
  );
}

function Entry({ model }: { model: ThemeEntryViewModel }) {
  const hasToc = model.content.toc.length >= 2;
  return (
    <PaperShell model={model} reading>
      <article className={`paper-article ${hasToc ? "paper-article-with-toc" : ""}`}>
        <header className="paper-article-head">
          <SmartLink className="paper-back" link={model.backLink}>← {model.backLink.label}</SmartLink>
          <div className="paper-article-kicker">
            <span>{model.typeLabel}</span>
            <time dateTime={model.published.iso}>{model.published.label}</time>
            <span>{model.readingTimeLabel}</span>
          </div>
          <h1>{model.title}</h1>
          {model.excerpt ? <p>{model.excerpt}</p> : null}
          {model.cover ? (
            <figure className="paper-article-cover">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={model.cover.src} alt={model.cover.alt} />
            </figure>
          ) : null}
        </header>
        <div className="paper-article-layout">
          {hasToc ? <PostToc items={model.content.toc} /> : null}
          <div className="paper-prose gh-content" dangerouslySetInnerHTML={{ __html: model.content.html }} />
        </div>
        <footer className="paper-article-footer">
          <div className="paper-article-tags">
            {model.tags.map((tag) => <Link key={tag.id} href={tag.href}>{tag.label}</Link>)}
          </div>
          <nav className="paper-adjacent" aria-label="相邻内容">
            {model.adjacent.previous ? (
              <Link href={model.adjacent.previous.href}><span>← {model.adjacent.previous.label}</span><strong>{model.adjacent.previous.title}</strong></Link>
            ) : <span />}
            {model.adjacent.next ? (
              <Link href={model.adjacent.next.href}><span>{model.adjacent.next.label} →</span><strong>{model.adjacent.next.title}</strong></Link>
            ) : <span />}
          </nav>
        </footer>
      </article>
    </PaperShell>
  );
}

function Page({ model }: { model: ThemePageViewModel }) {
  return (
    <PaperShell model={model} reading>
      <article className="paper-page">
        <header><span>Standalone page</span><h1>{model.title}</h1></header>
        <div className="paper-prose gh-content" dangerouslySetInnerHTML={{ __html: model.content.html }} />
      </article>
    </PaperShell>
  );
}

function NotFound({ model }: { model: ThemeNotFoundViewModel }) {
  return (
    <PaperShell model={model}>
      <section className="paper-not-found">
        <span>Errata / {model.statusCode}</span>
        <strong aria-hidden="true">404</strong>
        <h1>{model.title}</h1>
        <p>{model.description}</p>
        <SmartLink className="paper-read-link" link={model.homeLink}>{model.homeLink.label} →</SmartLink>
      </section>
    </PaperShell>
  );
}

export const paperAtlasTheme: ThemeDefinition = {
  meta: {
    id: "paper-atlas",
    name: "Paper Atlas",
    version: "1.0.0",
    description: "明亮的编辑部与纸上图鉴风格，以非对称版式、衬线标题和页边批注组织内容。"
  },
  apiVersion: THEME_API_VERSION,
  coreCompatibility: { minimum: "0.1.0", maximumExclusive: "1.0.0" },
  capabilities: ["home-modules", "entry-toc", "entry-navigation", "custom-pages", "not-found"],
  tokens: {
    bg: "#f4f0e6",
    surface: "#fffdf7",
    text: "#211e1a",
    accent: "#c94a35"
  },
  slots: { Home, Collection, Entry, Page, NotFound }
};
