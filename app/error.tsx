"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/states";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="page">
      <section className="card">
        <ErrorState retry={reset} />
      </section>
    </div>
  );
}
