import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MediCore HMS — Hospital management for Pakistan" },
      { name: "description", content: "MediCore hospital management system for Pakistani hospitals." },
      { property: "og:title", content: "MediCore HMS" },
      { property: "og:description", content: "Hospital management system for Pakistani hospitals." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/auth" });
  },
});
