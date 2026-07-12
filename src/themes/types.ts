export const THEME_API_VERSION = "1" as const;
export const THEME_CORE_VERSION = "0.1.0" as const;

export type ThemeCapability =
  | "home-modules"
  | "entry-toc"
  | "entry-navigation"
  | "custom-pages"
  | "not-found";

export type ThemeCoreCompatibility = {
  minimum: string;
  maximumExclusive?: string;
};

export type ThemeLinkViewModel = {
  label: string;
  href: string;
  isExternal: boolean;
};

export type ThemeNavigationItemViewModel = ThemeLinkViewModel & {
  id: string;
  iconUrl: string | null;
  isCurrent: boolean;
};

export type ThemeNavigationViewModel = {
  label: string;
  items: ThemeNavigationItemViewModel[];
};

export type ThemeSiteViewModel = {
  title: string;
  description: string;
  homeHref: string;
  footer: {
    copyrightLabel: string;
    uptimeLabel: string;
    hostingLabel: string;
  };
};

export type ThemeTagViewModel = {
  id: string;
  label: string;
  href: string;
};

export type ThemeEntrySummaryViewModel = {
  id: string;
  typeId: string;
  typeLabel: string;
  title: string;
  href: string;
  excerpt: string | null;
  cover: { src: string; alt: string } | null;
  published: {
    iso: string;
    label: string;
  };
  tags: ThemeTagViewModel[];
};

export type ThemeHomeModuleViewModel =
  | {
      id: string;
      kind: "entries";
      title: string;
      entries: ThemeEntrySummaryViewModel[];
      moreLink: ThemeLinkViewModel;
      emptyMessage: string;
    }
  | {
      id: string;
      kind: "now";
      title: string;
      statusLabel: string;
      facts: Array<{ label: string; value: string }>;
      completed: string[];
    }
  | {
      id: string;
      kind: "links";
      title: string;
      links: Array<
        ThemeNavigationItemViewModel & {
          hostLabel: string;
        }
      >;
      emptyMessage: string;
    }
  | {
      id: string;
      kind: "stack";
      title: string;
      items: string[];
    };

export type ThemePageContextViewModel = {
  site: ThemeSiteViewModel;
  navigation: ThemeNavigationViewModel;
};

export type ThemeHomeViewModel = ThemePageContextViewModel & {
  view: "home";
  hero: {
    title: string;
    bio: string;
    tags: string[];
  };
  modules: ThemeHomeModuleViewModel[];
};

export type ThemeCollectionViewModel = ThemePageContextViewModel & {
  view: "collection";
  title: string;
  description: string;
  href: string;
  pathLabel: string;
  countLabel: string;
  sortLabel: string;
  entries: ThemeEntrySummaryViewModel[];
  emptyMessage: string;
  backLink: ThemeLinkViewModel | null;
};

export type ThemeRenderedContentViewModel = {
  html: string;
  text: string;
  toc: Array<{ id: string; level: 2 | 3; text: string }>;
};

export type ThemeAdjacentEntryViewModel = {
  title: string;
  href: string;
  label: string;
};

export type ThemeEntryViewModel = ThemePageContextViewModel & {
  view: "entry";
  id: string;
  typeId: string;
  typeLabel: string;
  title: string;
  href: string;
  excerpt: string | null;
  cover: { src: string; alt: string } | null;
  published: {
    iso: string;
    label: string;
  };
  readingTimeLabel: string;
  tags: ThemeTagViewModel[];
  content: ThemeRenderedContentViewModel;
  backLink: ThemeLinkViewModel;
  adjacent: {
    previous: ThemeAdjacentEntryViewModel | null;
    next: ThemeAdjacentEntryViewModel | null;
  };
};

export type ThemePageViewModel = ThemePageContextViewModel & {
  view: "page";
  title: string;
  href: string;
  content: ThemeRenderedContentViewModel;
};

export type ThemeNotFoundViewModel = ThemePageContextViewModel & {
  view: "not-found";
  statusCode: 404;
  title: string;
  description: string;
  homeLink: ThemeLinkViewModel;
};

export type ThemeViewModel =
  | ThemeHomeViewModel
  | ThemeCollectionViewModel
  | ThemeEntryViewModel
  | ThemePageViewModel
  | ThemeNotFoundViewModel;

export type ThemeSlotProps<Model extends ThemeViewModel> = {
  model: Model;
};

export type ThemeDefinition = {
  meta: {
    id: string;
    name: string;
    version: string;
    description: string;
  };
  apiVersion: typeof THEME_API_VERSION;
  coreCompatibility: ThemeCoreCompatibility;
  capabilities: readonly ThemeCapability[];
  tokens: Record<string, string>;
  slots: {
    Home(props: ThemeSlotProps<ThemeHomeViewModel>): React.ReactNode;
    Collection(props: ThemeSlotProps<ThemeCollectionViewModel>): React.ReactNode;
    Entry(props: ThemeSlotProps<ThemeEntryViewModel>): React.ReactNode;
    Page(props: ThemeSlotProps<ThemePageViewModel>): React.ReactNode;
    NotFound(props: ThemeSlotProps<ThemeNotFoundViewModel>): React.ReactNode;
  };
};
