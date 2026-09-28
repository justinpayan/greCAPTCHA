import { NextResponse } from "next/server";
import { z } from "zod";

import { setGetStartedHidden } from "@/lib/preferences";
import { assertSameOrigin } from "@/lib/security";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

const preferencesSchema = z.object({ getStartedHidden: z.boolean() });

/** Saves the signed-in account's dashboard display preferences. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { getStartedHidden } = preferencesSchema.parse(await request.json());
    await setGetStartedHidden(user.id, getStartedHidden);
    return NextResponse.json({ getStartedHidden });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save the preference.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
