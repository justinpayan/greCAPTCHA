import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { attemptAnswers } from "@/db/schema";
import { AttemptClosedError, requireOpenAttempt } from "@/lib/attempt-access";
import { getCurrentAnswer, loadAttemptContext } from "@/lib/attempts";

export const runtime = "nodejs";

/**
 * Records the moment the participant first engaged with the current question.
 *
 * The browser reports *that* an interaction happened; the server stamps *when*, so the
 * recorded latency stays server-authoritative. A client can only delay this timestamp,
 * never move it earlier. The write is conditional on the column still being null, so
 * repeat pings, retries, and refreshes are all no-ops.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    await requireOpenAttempt(id);
    const quiz = await loadAttemptContext(id);
    if (quiz.attempt.status !== "active") {
      return NextResponse.json({ recorded: false });
    }

    const answerRow = await getCurrentAnswer(id, quiz.currentQuestion.id);
    if (!answerRow || answerRow.submittedAt) {
      return NextResponse.json({ recorded: false });
    }

    const now = new Date();
    const update = await db
      .update(attemptAnswers)
      .set({
        firstInteractionAt: now.toISOString(),
        firstInteractionMs: Math.max(
          0,
          now.getTime() - new Date(answerRow.startedAt).getTime(),
        ),
      })
      .where(
        and(
          eq(attemptAnswers.id, answerRow.id),
          isNull(attemptAnswers.firstInteractionAt),
          isNull(attemptAnswers.submittedAt),
        ),
      )
      .run();

    return NextResponse.json({ recorded: update.changes === 1 });
  } catch (error) {
    // Telemetry, so a closed link is a silent no-op rather than an error the client shows.
    if (error instanceof AttemptClosedError) {
      return NextResponse.json({ recorded: false });
    }
    const message =
      error instanceof Error ? error.message : "Unable to record interaction.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
