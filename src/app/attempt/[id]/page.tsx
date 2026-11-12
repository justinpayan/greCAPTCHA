import { redirect } from "next/navigation";

import { ParticipantSession } from "@/components/quiz/participant-session";
import { ProctoredSession, SebLaunch } from "@/components/quiz/proctored-session";
import { proctoredAttempt, sebPageSession, sebRequest, verifySeb } from "@/lib/seb";
import { currentUser } from "@/lib/session";
import { getAttemptIntro } from "@/lib/attempts";
import { db } from "@/db";
import { attemptFeedback, attempts } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * The participant's attempt page. Reusable links assign the attempt before redirecting here.
 */
export default async function AttemptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await currentUser();
  const proctored = proctoredAttempt(id);
  if (proctored) {
    if (await sebPageSession(id) && verifySeb(await sebRequest())) {
      return <ProctoredSession id={id} intro={await getAttemptIntro(id)} />;
    }
    if (user?.id === proctored.takerUserId) {
      const attempt = db.select({ status: attempts.status, score: attempts.score }).from(attempts)
        .where(eq(attempts.id, id)).get();
      if (attempt?.status === "graded") return <ParticipantSession attemptId={id} />;
      const feedback = db.select({ id: attemptFeedback.attemptId }).from(attemptFeedback)
        .where(eq(attemptFeedback.attemptId, id)).get();
      return <SebLaunch id={id} authorPays={proctored.apiKeyPayer === "taker" && attempt?.status !== "graded"}
        closed={attempt?.status !== "active"} score={attempt?.score ?? null}
        disqualification={proctored.disqualification} feedbackPending={!feedback} />;
    }
  }
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/attempt/${id}`)}`);
  }
  return <ParticipantSession attemptId={id} />;
}
