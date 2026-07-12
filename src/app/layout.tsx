import type { Metadata, Viewport } from "next";
import { StructuredData } from "@/components/seo/StructuredData";
import { getSiteSettings } from "@/lib/db/queries";
import {
  createSiteMetadata,
  createWebsiteStructuredData
} from "@/lib/seo/metadata";
import "./globals.css";
import "@/themes/manjyun-console/theme.css";
import "@/themes/paper-atlas/theme.css";

export function generateMetadata(): Metadata {
  return createSiteMetadata(getSiteSettings());
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const settings = getSiteSettings();
  return (
    <html lang="zh-CN">
      <body>
        <StructuredData data={createWebsiteStructuredData(settings)} />
        {children}
      </body>
    </html>
  );
}
