import { createFileRoute } from "@tanstack/react-router";
import { TvScreen } from "@/components/mc/tv-screen";

export const Route = createFileRoute("/tv/$doctorId")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({ token: typeof s.token === "string" ? s.token : "" }),
  head: () => ({
    meta: [
      { title: "Waiting room screen — MediCore HMS" },
      { name: "description", content: "Live token display for the doctor's waiting room." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Page,
});

function Page() {
  const { doctorId } = Route.useParams();
  const { token } = Route.useSearch();
  return <TvScreen doctorId={doctorId} token={token} />;
}
