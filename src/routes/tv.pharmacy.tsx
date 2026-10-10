import { createFileRoute } from "@tanstack/react-router";
import { TvPharmacyScreen } from "@/components/mc/tv-boards";

export const Route = createFileRoute("/tv/pharmacy")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({ token: typeof s["token"] === "string" ? s["token"] : "" }),
  head: () => ({
    meta: [
      { title: "Pharmacy pickup screen — MediCore HMS" },
      { name: "description", content: "Tokens being prepared and ready for collection at the pharmacy." },
      { property: "og:title", content: "Pharmacy pickup screen — MediCore HMS" },
      { property: "og:description", content: "Tokens being prepared and ready for collection at the pharmacy." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Page,
});

function Page() {
  const { token } = Route.useSearch();
  return <TvPharmacyScreen token={token} />;
}
