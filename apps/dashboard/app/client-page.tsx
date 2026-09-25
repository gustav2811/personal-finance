"use client";

import dynamic from "next/dynamic";

const DashboardShell = dynamic(
  () =>
    import("../components/dashboard-shell").then(
      (module) => module.DashboardShell,
    ),
  {
    loading: () => <div className="loading-state">Loading observatory…</div>,
    ssr: false,
  },
);

export function ClientPage() {
  return <DashboardShell />;
}
