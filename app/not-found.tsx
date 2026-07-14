import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="page">
      <section className="card empty-state">
        <div>
          <span className="empty-state-icon">
            <Compass />
          </span>
          <h2>That database view doesn’t exist</h2>
          <p>
            The link may reference a query or plan that has aged out of
            retention.
          </p>
          <a className="button primary" href="/">
            Return to fleet
          </a>
        </div>
      </section>
    </div>
  );
}
