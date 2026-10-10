import { createFileRoute } from "@tanstack/react-router";
import { TvBillingScreen } from "@/components/mc/tv-boards";

export const Route = createFileRoute("/tv/billing/$counterId")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({ token: typeof s["token"] === "string" ? s["token"] : "" }),
  head: () => ({
    meta: [
      { title: "Cash counter screen — MediCore HMS" },
      { name: "description", content: "Customer-facing bill and change display for a cash counter." },
      { property: "og:title", content: "Cash counter screen — MediCore HMS" },
      { property: "og:description", content: "Customer-facing bill and change display for a cash counter." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Page,
});

function Page() {
  const { counterId } = Route.useParams();
  const { token } = Route.useSearch();
  return <TvBillingScreen counterId={counterId} token={token} />;
}
