import { createFileRoute } from "@tanstack/react-router";
import { TvScreen } from "@/components/mc/tv-screen";

export const Route = createFileRoute("/tv/department/$departmentId")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({ token: typeof s["token"] === "string" ? s["token"] : "" }),
  head: () => ({
    meta: [
      { title: "Department waiting screen — MediCore HMS" },
      { name: "description", content: "Live token display for all doctors in a department." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Page,
});

function Page() {
  const { departmentId } = Route.useParams();
  const { token } = Route.useSearch();
  return <TvScreen departmentId={departmentId} token={token} />;
}
