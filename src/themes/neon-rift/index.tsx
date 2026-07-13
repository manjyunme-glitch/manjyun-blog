import Link from "next/link";
import { PostToc } from "@/components/theme/PostToc";
import { PublicInteractions } from "@/components/theme/PublicInteractions";
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

function SignalLink({
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

function RiftShell({
  model,
  children,
  reading = false
}: {
  model: ThemePageContextViewModel;
  children: React.ReactNode;
  reading?: boolean;
}) {
  return (
    <div className="rift-theme" data-theme="neon-rift">
      <a className="rift-skip" href="#main-content">跳到内容</a>
      <div className="rift-scanlines" aria-hidden="true" />
      <header className="rift-header" data-site-nav>
        <Link className="rift-brand" href={model.site.homeHref}>
          <span className="rift-brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span><strong>{model.site.title}</strong><small>unauthorized data vault</small></span>
        </Link>
        <nav className="rift-nav" aria-label={model.navigation.label}>
          {model.navigation.items.map((item, index) =>
            item.isExternal ? (
              <a
                key={item.id}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-current={item.isCurrent ? "page" : undefined}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>{item.label}<b aria-hidden="true">↗</b>
              </a>
            ) : (
              <Link
                key={item.id}
                href={item.href}
                aria-current={item.isCurrent ? "page" : undefined}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>{item.label}
              </Link>
            )
          )}
        </nav>
        <span className="rift-live"><i aria-hidden="true" />SYSTEM / NO SAFE MODE</span>
      </header>
      <main id="main-content" className={`rift-main ${reading ? "rift-main-reading" : ""}`}>
        {children}
      </main>
      <footer className="rift-footer">
        <span className="rift-coordinate">31°14&apos;N / 121°28&apos;E</span>
        <span>{model.site.footer.copyrightLabel}</span>
        <span>{model.site.footer.uptimeLabel} · {model.site.footer.hostingLabel}</span>
      </footer>
      <PublicInteractions />
    </div>
  );
}

function SignalIndex({ index }: { index: number }) {
  return <span className="rift-signal-index">CH.{String(index + 1).padStart(2, "0")}</span>;
}

function EntryRow({ entry, index }: { entry: ThemeEntrySummaryViewModel; index: number }) {
  return (
    <article className="rift-entry-row">
      <SignalIndex index={index} />
      <div className="rift-entry-copy">
        <div className="rift-entry-meta">
          <span>{entry.typeLabel}</span>
          <time dateTime={entry.published.iso}>{entry.published.label}</time>
        </div>
        <h3><Link href={entry.href}>{entry.title}</Link></h3>
        {entry.excerpt ? <p>{entry.excerpt}</p> : null}
        {entry.tags.length ? (
          <div className="rift-entry-tags">
            {entry.tags.slice(0, 4).map((tag) => <Link href={tag.href} key={tag.id}>#{tag.label}</Link>)}
          </div>
        ) : null}
      </div>
      <Link className="rift-entry-open" href={entry.href} aria-label={`打开：${entry.title}`}>↗</Link>
    </article>
  );
}

function EntryModule({ module }: { module: Extract<ThemeHomeModuleViewModel, { kind: "entries" }> }) {
  return (
    <section className={`rift-channel rift-channel-${module.id}`}>
      <header className="rift-section-head">
        <div><span>TRANSMISSION / {module.id.toUpperCase()}</span><h2>{module.title}</h2></div>
        <SignalLink className="rift-more" link={module.moreLink}>{module.moreLink.label}<b>↗</b></SignalLink>
      </header>
      {module.entries.length ? (
        <div className="rift-entry-list">
          {module.entries.map((entry, index) => <EntryRow entry={entry} index={index} key={entry.id} />)}
        </div>
      ) : <p className="rift-empty">NO SIGNAL / {module.emptyMessage}</p>}
    </section>
  );
}

function StatusModule({ module }: { module: Extract<ThemeHomeModuleViewModel, { kind: "now" }> }) {
  return (
    <section className="rift-status-panel">
      <span className="rift-panel-code">STATUS::NOW</span>
      <h2>{module.title}</h2>
      <strong><i aria-hidden="true" />{module.statusLabel}</strong>
      <dl>{module.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>
      <div className="rift-completed">
        {module.completed.map((item) => <span key={item}>✓ {item}</span>)}
      </div>
    </section>
  );
}

function LinksModule({ module }: { module: Extract<ThemeHomeModuleViewModel, { kind: "links" }> }) {
  return (
    <section className="rift-link-panel">
      <span className="rift-panel-code">UPLINK::NODES</span>
      <h2>{module.title}</h2>
      {module.links.length ? (
        <div>
          {module.links.map((link, index) => (
            <SignalLink className="rift-node-link" link={link} key={link.id}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{link.label}</strong>
              <small>{link.hostLabel}</small>
              <b>↗</b>
            </SignalLink>
          ))}
        </div>
      ) : <p className="rift-empty">{module.emptyMessage}</p>}
    </section>
  );
}

function StackModule({ module }: { module: Extract<ThemeHomeModuleViewModel, { kind: "stack" }> }) {
  return (
    <section className="rift-stack-panel">
      <span className="rift-panel-code">LOADOUT::STACK</span>
      <h2>{module.title}</h2>
      <div>{module.items.map((item, index) => <span key={item}><i>{String(index + 1).padStart(2, "0")}</i>{item}</span>)}</div>
    </section>
  );
}

function Home({ model }: { model: ThemeHomeViewModel }) {
  const entries = model.modules.filter(
    (module): module is Extract<ThemeHomeModuleViewModel, { kind: "entries" }> => module.kind === "entries"
  );
  const status = model.modules.find(
    (module): module is Extract<ThemeHomeModuleViewModel, { kind: "now" }> => module.kind === "now"
  );
  const links = model.modules.find(
    (module): module is Extract<ThemeHomeModuleViewModel, { kind: "links" }> => module.kind === "links"
  );
  const stack = model.modules.find(
    (module): module is Extract<ThemeHomeModuleViewModel, { kind: "stack" }> => module.kind === "stack"
  );

  return (
    <RiftShell model={model}>
      <section className="rift-hero">
        <div className="rift-hero-coordinate"><span>DISTRICT / SH-31</span><span>UNAUTHORIZED ARCHIVE / ONLINE</span></div>
        <div className="rift-hero-copy">
          <p>LOCAL USER PROFILE / 私人数据节点</p>
          <h1 data-text={model.hero.title} aria-label={model.hero.title}>{model.hero.title}</h1>
          <p className="rift-hero-bio">{model.hero.bio}</p>
          <div className="rift-hero-tags">
            {model.hero.tags.map((tag, index) => <span key={tag}><i>{String(index + 1).padStart(2, "0")}</i>{tag}</span>)}
          </div>
        </div>
        <div className="rift-tower" aria-hidden="true">
          <span className="rift-tower-grid" />
          <span className="rift-tower-halo" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/themes/neon-rift/signal-tower.png" alt="" width="864" height="1821" />
          <span className="rift-tower-scan" />
          <span className="rift-tower-beacon"><i /><i /><i /></span>
          <small>RX<br />98.7</small>
        </div>
        <span className="rift-scroll-cue">BREACH THE ARCHIVE <i>↓</i></span>
      </section>
      <div className="rift-home-grid">
        <div className="rift-home-feed">{entries.map((module) => <EntryModule module={module} key={module.id} />)}</div>
        <aside className="rift-home-telemetry">
          {status ? <StatusModule module={status} /> : null}
          {links ? <LinksModule module={links} /> : null}
          {stack ? <StackModule module={stack} /> : null}
        </aside>
      </div>
    </RiftShell>
  );
}

function Collection({ model }: { model: ThemeCollectionViewModel }) {
  return (
    <RiftShell model={model}>
      <header className="rift-archive-head">
        <div>
          {model.backLink ? <SignalLink className="rift-back" link={model.backLink}>← {model.backLink.label}</SignalLink> : null}
          <span>ARCHIVE::{model.pathLabel.toUpperCase()}</span>
          <h1>{model.title}</h1>
          <p>{model.description}</p>
        </div>
        <div className="rift-archive-stats"><span>{model.countLabel}</span><span>{model.sortLabel}</span><b>SYNC 100%</b></div>
      </header>
      {model.entries.length ? (
        <div className="rift-archive-list">
          {model.entries.map((entry, index) => <EntryRow entry={entry} index={index} key={entry.id} />)}
        </div>
      ) : <p className="rift-empty">NO SIGNAL / {model.emptyMessage}</p>}
    </RiftShell>
  );
}

function Entry({ model }: { model: ThemeEntryViewModel }) {
  const hasToc = model.content.toc.length >= 2;
  return (
    <RiftShell model={model} reading>
      <article className={`rift-article ${hasToc ? "rift-article-with-toc" : ""}`}>
        <header className="rift-article-head">
          <SignalLink className="rift-back" link={model.backLink}>← RETURN / {model.backLink.label}</SignalLink>
          <div className="rift-article-signal"><span>SIGNAL::{model.typeLabel}</span><span>ENCRYPTION / NONE</span></div>
          <h1>{model.title}</h1>
          {model.excerpt ? <p>{model.excerpt}</p> : null}
          <div className="rift-article-meta">
            <time dateTime={model.published.iso}>{model.published.label}</time>
            <span>{model.readingTimeLabel}</span>
            <span>{String(model.content.toc.length).padStart(2, "0")} SECTIONS</span>
          </div>
          {model.cover ? (
            <figure className="rift-article-cover">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={model.cover.src} alt={model.cover.alt} />
              <figcaption>VISUAL RECORD / {model.typeLabel}</figcaption>
            </figure>
          ) : null}
        </header>
        <div className="rift-article-grid">
          {hasToc ? <PostToc items={model.content.toc} /> : null}
          <div className="rift-prose gh-content" dangerouslySetInnerHTML={{ __html: model.content.html }} />
          <aside className="rift-reading-rail" aria-hidden="true"><span>RECEIVING</span><i /><small>100%</small></aside>
        </div>
        <footer className="rift-article-footer">
          <div className="rift-article-tags">{model.tags.map((tag) => <Link key={tag.id} href={tag.href}>#{tag.label}</Link>)}</div>
          <nav className="rift-adjacent" aria-label="相邻内容">
            {model.adjacent.previous ? <Link href={model.adjacent.previous.href}><span>← {model.adjacent.previous.label}</span><strong>{model.adjacent.previous.title}</strong></Link> : <span />}
            {model.adjacent.next ? <Link href={model.adjacent.next.href}><span>{model.adjacent.next.label} →</span><strong>{model.adjacent.next.title}</strong></Link> : <span />}
          </nav>
        </footer>
      </article>
    </RiftShell>
  );
}

function Page({ model }: { model: ThemePageViewModel }) {
  return (
    <RiftShell model={model} reading>
      <article className="rift-page">
        <header><span>STATIC MEMORY / UNDATED</span><h1>{model.title}</h1></header>
        <div className="rift-prose gh-content" dangerouslySetInnerHTML={{ __html: model.content.html }} />
      </article>
    </RiftShell>
  );
}

function NotFound({ model }: { model: ThemeNotFoundViewModel }) {
  return (
    <RiftShell model={model}>
      <section className="rift-not-found">
        <div className="rift-lost-signal" aria-hidden="true"><span>4</span><i /><span>4</span></div>
        <span>ERROR::{model.statusCode} / FREQUENCY LOST</span>
        <h1>{model.title}</h1>
        <p>{model.description}</p>
        <SignalLink className="rift-reconnect" link={model.homeLink}>{model.homeLink.label}<b>重新连接 ↗</b></SignalLink>
      </section>
    </RiftShell>
  );
}

export const neonRiftTheme: ThemeDefinition = {
  meta: {
    id: "neon-rift",
    name: "Neon Rift",
    version: "1.0.0",
    description: "赛博朋克夜城中的个人记忆广播站，以非对称信号栅格、锐利切角和克制霓虹组织内容。"
  },
  apiVersion: THEME_API_VERSION,
  coreCompatibility: { minimum: "0.1.0", maximumExclusive: "1.0.0" },
  capabilities: ["home-modules", "entry-toc", "entry-navigation", "custom-pages", "not-found"],
  tokens: { bg: "#0b0b0d", surface: "#141416", text: "#f4f1df", accent: "#fcee0a" },
  slots: { Home, Collection, Entry, Page, NotFound }
};
