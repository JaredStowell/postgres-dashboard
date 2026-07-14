import type { CSSProperties, ReactNode } from "react";

export function Card({
  children,
  className = "",
  style,
  id,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  id?: string;
}) {
  return (
    <section className={`card ${className}`.trim()} style={style} id={id}>
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card-header">
      <h2 className="card-title">{title}</h2>
      {subtitle ? <span className="card-subtitle">{subtitle}</span> : null}
      {action ? <div className="card-header-action">{action}</div> : null}
    </div>
  );
}

export function CardBody({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`card-body ${className}`.trim()}>{children}</div>;
}
