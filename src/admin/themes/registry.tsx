import type { AdminThemeDefinition, ResolvedAdminTheme } from "@/admin/themes/types";

function ConsoleBrand() {
  return <span className="admin-theme-brand-mark admin-theme-brand-console">M&gt;_</span>;
}

function PaperBrand() {
  return <span className="admin-theme-brand-mark admin-theme-brand-paper">MA</span>;
}

function NeonBrand() {
  return <span className="admin-theme-brand-mark admin-theme-brand-neon"><i /><i /><i /></span>;
}

function ConsoleDecoration() {
  return <div className="admin-theme-decoration admin-theme-decoration-console" aria-hidden="true"><i /><i /><i /></div>;
}

function PaperDecoration() {
  return <div className="admin-theme-decoration admin-theme-decoration-paper" aria-hidden="true"><span>FIELD NOTES / ADMIN EDITION</span></div>;
}

function NeonDecoration() {
  return <div className="admin-theme-decoration admin-theme-decoration-neon" aria-hidden="true"><i /><span>SYSTEM::ADMIN / ONLINE</span></div>;
}

function ConsoleAuthDecoration() {
  return <div className="admin-auth-art admin-auth-art-console" aria-hidden="true"><code>admin@manjyun:~$ authenticate</code><span /></div>;
}

function PaperAuthDecoration() {
  return <div className="admin-auth-art admin-auth-art-paper" aria-hidden="true"><b>Private Desk</b><span>Issue No. 01</span></div>;
}

function NeonAuthDecoration() {
  return <div className="admin-auth-art admin-auth-art-neon" aria-hidden="true"><b>ACCESS GATE</b><span>AUTHORIZED SIGNALS ONLY</span></div>;
}

function ConsolePreview() {
  return (
    <div className="admin-pair-preview admin-pair-preview-console" aria-label="ManJyun Console 后台预览" role="img">
      <div><ConsoleBrand /><b>ManJyun Admin</b><span>Console</span></div>
      <nav><i /><i /><i /><i /></nav>
      <main><strong>42</strong><span /><span /><span /></main>
    </div>
  );
}

function PaperPreview() {
  return (
    <div className="admin-pair-preview admin-pair-preview-paper" aria-label="Paper Atlas 后台预览" role="img">
      <div><PaperBrand /><b>ManJyun Admin</b><span>Paper Atlas</span></div>
      <nav><i /><i /><i /><i /></nav>
      <main><strong>42</strong><span /><span /><span /></main>
    </div>
  );
}

function NeonPreview() {
  return (
    <div className="admin-pair-preview admin-pair-preview-neon" aria-label="Neon Rift 后台预览" role="img">
      <div><NeonBrand /><b>MANJYUN ADMIN</b><span>NEON RIFT</span></div>
      <nav><i /><i /><i /><i /></nav>
      <main><strong>42</strong><span /><span /><span /></main>
    </div>
  );
}

export const adminThemes = [
  {
    meta: {
      id: "manjyun-console",
      name: "ManJyun Admin",
      variantLabel: "Console",
      version: "1.0.0",
      description: "紧凑、清晰的终端工作台。"
    },
    tokens: {
      background: "#0a0a0a",
      surface: "#141414",
      raisedSurface: "#1a1a1a",
      strongSurface: "#202020",
      border: "#2a2a2a",
      strongBorder: "#3a3a3a",
      text: "#e0ddd5",
      softText: "#aaa49a",
      mutedText: "#928c83",
      accent: "#e8a84c",
      success: "#7ec87e",
      danger: "#e06c6c"
    },
    slots: {
      BrandMark: ConsoleBrand,
      ShellDecoration: ConsoleDecoration,
      AuthDecoration: ConsoleAuthDecoration,
      Preview: ConsolePreview
    }
  },
  {
    meta: {
      id: "paper-atlas",
      name: "ManJyun Admin",
      variantLabel: "Paper Atlas",
      version: "1.0.0",
      description: "温暖纸张、编辑批注与高可读表单。"
    },
    tokens: {
      background: "#eee8dc",
      surface: "#fffdf7",
      raisedSurface: "#f7f1e6",
      strongSurface: "#e9dfcf",
      border: "#d5c9b8",
      strongBorder: "#ab9c87",
      text: "#25211c",
      softText: "#514a40",
      mutedText: "#766d61",
      accent: "#b74334",
      success: "#397455",
      danger: "#a62f2f"
    },
    slots: {
      BrandMark: PaperBrand,
      ShellDecoration: PaperDecoration,
      AuthDecoration: PaperAuthDecoration,
      Preview: PaperPreview
    }
  },
  {
    meta: {
      id: "neon-rift",
      name: "ManJyun Admin",
      variantLabel: "Neon Rift",
      version: "1.0.0",
      description: "高对比信号界面与克制的赛博朋克装饰。"
    },
    tokens: {
      background: "#09090c",
      surface: "#121217",
      raisedSurface: "#191920",
      strongSurface: "#22222a",
      border: "#34343d",
      strongBorder: "#5e5e6b",
      text: "#f4f1df",
      softText: "#c4c1b4",
      mutedText: "#8b8990",
      accent: "#fcee0a",
      success: "#50f0b0",
      danger: "#ff315f"
    },
    slots: {
      BrandMark: NeonBrand,
      ShellDecoration: NeonDecoration,
      AuthDecoration: NeonAuthDecoration,
      Preview: NeonPreview
    }
  }
] satisfies AdminThemeDefinition[];

export function getAdminThemes() {
  return adminThemes;
}

export function resolveAdminTheme(id: string | null | undefined): ResolvedAdminTheme {
  const fallback = adminThemes[0];
  const requestedId = id?.trim() || fallback.meta.id;
  const selected = adminThemes.find((theme) => theme.meta.id === requestedId);
  return {
    requestedId,
    theme: selected ?? fallback,
    isFallback: !selected
  };
}
