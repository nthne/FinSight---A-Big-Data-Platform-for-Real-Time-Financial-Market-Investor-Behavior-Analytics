import type { FinSightEvent } from "../../ingestion/producers/app_event_producer";
import { publishAppEvent } from "../../ingestion/producers/app_event_producer";

export function analyticsUserSalt(): string | null {
  return process.env.ANALYTICS_USER_SALT || null;
}

export async function emitAnalyticsEvent(event: FinSightEvent): Promise<boolean> {
  try {
    await publishAppEvent(event, { timeoutMs: 3000 });
    return true;
  } catch (error) {
    console.warn("Analytics event delivery failed", {
      eventId: event.event_id,
      eventType: event.event_type,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
