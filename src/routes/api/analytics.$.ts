import "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";

// GET /api/analytics/* — see serving/api_contract.md section 4.
export const Route = createFileRoute("/api/analytics/$")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const [{ handleAnalyticsRequest }, { authenticateSupabase }, { analyticsDatabase }] =
          await Promise.all([
            import("@/lib/analytics.server"),
            import("@/lib/analytics-auth.server"),
            import("@/lib/mongo.server"),
          ]);
        return handleAnalyticsRequest(request, {
          authenticate: authenticateSupabase,
          database: analyticsDatabase,
          userSalt: process.env.ANALYTICS_USER_SALT || null,
        });
      },
    },
  },
});
