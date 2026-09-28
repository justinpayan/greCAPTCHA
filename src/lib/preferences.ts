import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { appState } from "@/db/schema";

/**
 * Small per-account display preferences, kept in `app_state` beside the template draft so they
 * follow the account across browsers and sessions rather than living in one browser's storage.
 */
const GET_STARTED_HIDDEN_KEY = "dashboard.getStartedHidden";

export async function getStartedHidden(ownerUserId: string): Promise<boolean> {
  const row = await db
    .select({ value: appState.value })
    .from(appState)
    .where(and(eq(appState.ownerUserId, ownerUserId), eq(appState.key, GET_STARTED_HIDDEN_KEY)))
    .get();
  return row?.value === "true";
}

export async function setGetStartedHidden(ownerUserId: string, hidden: boolean) {
  const now = new Date().toISOString();
  const value = String(hidden);
  await db
    .insert(appState)
    .values({ ownerUserId, key: GET_STARTED_HIDDEN_KEY, value, updatedAt: now })
    .onConflictDoUpdate({
      target: [appState.ownerUserId, appState.key],
      set: { value, updatedAt: now },
    })
    .run();
}
