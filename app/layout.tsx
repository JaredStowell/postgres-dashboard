import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import "./globals.css";

export const metadata = {
  title: {
    default: "Index Analyzer",
    template: "%s · Index Analyzer",
  },
  description: "PostgreSQL observability and tuning workbench",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
