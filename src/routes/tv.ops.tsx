import { createFileRoute } from "@tanstack/react-router";
import { TvOpsScreen } from "@/components/mc/tv-boards";

export const Route = createFileRoute("/tv/ops")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({ token: typeof s["token"] === "string" ? s["token"] : "" }),
  head: () => ({
    meta: [
      { title: "Operations wallboard — MediCore HMS" },
      { name: "description", content: "Live bed occupancy, emergency triage, OPD and lab counts." },
      { property: "og:title", content: "Operations wallboard — MediCore HMS" },
      { property: "og:description", content: "Live bed occupancy, emergency triage, OPD and lab counts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Page,
});

function Page() {
  const { token } = Route.useSearch();
  return <TvOpsScreen token={token} />;
}
