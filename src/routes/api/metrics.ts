import "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/metrics")({
  server: {
    handlers: {
      GET: async () => {
        const { renderApplicationMetrics } = await import("@/lib/app-metrics.server");
        const [{ renderPlatformMetrics, renderPlatformUnavailable }, { analyticsDatabase }] =
          await Promise.all([
            import("@/lib/platform-metrics.server"),
            import("@/lib/mongo.server"),
          ]);
        let platform: string;
        try {
          platform = await renderPlatformMetrics(await analyticsDatabase());
        } catch (error) {
          console.error("metrics: serving store unavailable", error);
          platform = renderPlatformUnavailable();
        }
        return new Response(`${renderApplicationMetrics()}${platform}`, {
          headers: {
            "content-type": "text/plain; version=0.0.4; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
