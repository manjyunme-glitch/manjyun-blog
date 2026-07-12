import type { Metadata } from "next";
import "./admin.css";

export const metadata: Metadata = {
  title: "管理后台",
  robots: { index: false, follow: false }
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div data-admin-root>{children}</div>;
}
