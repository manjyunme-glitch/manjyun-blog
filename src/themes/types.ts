import type {
  HomeModule,
  NavLink,
  PostRecord,
  PostWithTags,
  RenderedMarkdown,
  SiteSettings
} from "@/types/blog";

export type ThemeHomeProps = {
  settings: SiteSettings;
  modules: HomeModule[];
  navLinks: NavLink[];
  frequentLinks: NavLink[];
  posts: PostRecord[];
  projects: PostRecord[];
};

export type ThemePostProps = {
  settings: SiteSettings;
  navLinks: NavLink[];
  post: PostWithTags;
  rendered: RenderedMarkdown;
  readingTime: string;
  previous: PostRecord | null;
  next: PostRecord | null;
};

export type ThemeArchiveProps = {
  settings: SiteSettings;
  navLinks: NavLink[];
  title: string;
  description: string;
  posts: PostRecord[];
};

export type ThemePageProps = {
  settings: SiteSettings;
  navLinks: NavLink[];
  title: string;
  rendered: RenderedMarkdown;
};

export type ThemeDefinition = {
  meta: {
    id: string;
    name: string;
    version: string;
    description: string;
  };
  tokens: Record<string, string>;
  slots: {
    Home(props: ThemeHomeProps): React.ReactNode;
    Post(props: ThemePostProps): React.ReactNode;
    Archive(props: ThemeArchiveProps): React.ReactNode;
    Page(props: ThemePageProps): React.ReactNode;
  };
};
