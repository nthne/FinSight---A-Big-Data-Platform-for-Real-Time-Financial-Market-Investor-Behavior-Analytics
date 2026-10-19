# Evidence: Analytics API and Authorization (Task 9, Person C)

**Owner:** Person C · **Status:** passing locally (2026-10-19). Dashboard integration (React/Recharts) belongs to Person D.

## Integration tests (`tests/integration/test_analytics_api.py`)

The app runs through `vite dev` (TanStack Start server routes) against MongoDB 8.0; Supabase Auth is replaced by an in-process fake of `GET /auth/v1/user` and `POST /rest/v1/rpc/has_role`, the two endpoints the API calls. Result: **14 passed** (Windows 11, Node.js 22.23.3, Python 3.12, MongoDB 8.0.32 in WSL).

| Requirement | Observed |
| --- | --- |
| Missing, malformed, unregistered, forged (`sub` changed) and expired tokens | 401 `UNAUTHORIZED`; unknown routes return 401 anonymously and 404 with a valid token |
| Users only read their own analytics | `me/activity`, `me/sessions`, `me/risk` return the caller's documents only; a `user_id` query parameter is ignored and no pseudonym or Supabase id appears in another user's response |
| Admin-only health view | 403 `FORBIDDEN` for a normal user, 200 with gate totals and Lambda cutoffs for an admin |
| Lambda reconciliation | `market/series` serves batch windows up to the published cutoff and speed windows after it, one document per window; an uncommitted batch window after the cutoff is ignored |
| Parameter validation | 400 `INVALID_PARAMETER` for missing/lower-case symbols, unknown granularities, limits out of range and bad timestamps |
| Freshness and labelling | stale flags per quote (120 s budget), `meta.disclaimer`, `cache-control: private, no-store` |

## Live Supabase check

The app was run locally (`vite dev`, `127.0.0.1:5173`) with the team's Supabase project configuration and a temporary MongoDB; the user signed in through the app and called the API from the browser console with that session.

| Request | Status | Meaning |
| --- | --- | --- |
| `GET /api/analytics/me/activity` with the session token | 200 (empty points) | `getClaims` accepted a real Supabase access token; the `usr_` pseudonym was derived from it |
| `GET /api/analytics/market/latest` | 200 (empty) | serving store reachable; no data had been loaded |
| `GET /api/analytics/pipeline/health` | 403 | `public.has_role` ran on the real database without error and returned false for this non-admin account (no `has_role check failed` warning in the server log) |
| `GET /api/analytics/me/activity` without a token | 401 | anonymous access rejected |

## Not covered yet

- An admin account calling `pipeline/health` against the real project.
- The API on the Kubernetes Node runtime (and whether the MongoDB driver works on Cloudflare Workers).
- Request latency and error-rate metrics for monitoring (Task 11).
