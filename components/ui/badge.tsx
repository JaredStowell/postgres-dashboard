import type { ReactNode } from "react";

export function Badge({
  tone = "",
  children,
}: {
  tone?: string;
  children: ReactNode;
}) {
  return <span className={`badge ${tone}`.trim()}>{children}</span>;
}
