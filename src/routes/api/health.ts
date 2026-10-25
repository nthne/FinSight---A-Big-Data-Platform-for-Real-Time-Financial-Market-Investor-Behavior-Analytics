import "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () =>
        Response.json(
          { status: "ok", service: "finsight-app", checked_at: new Date().toISOString() },
          { headers: { "cache-control": "no-store" } },
        ),
    },
  },
});
