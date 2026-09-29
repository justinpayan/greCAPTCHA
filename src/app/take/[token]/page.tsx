import { redirect } from "next/navigation";

import { AssessmentNotAllowed } from "@/components/quiz/assessment-not-allowed";
import { isAssessmentNotAllowedError } from "@/lib/allowlist";
import { getOrCreateTakerAttempt } from "@/lib/attempts";
import { currentUser } from "@/lib/session";

export default async function TakeAssessmentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const user = await currentUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/take/${token}`)}`);
  }
  let attemptId: string;
  try {
    ({ attemptId } = await getOrCreateTakerAttempt(token, user));
  } catch (error) {
    if (isAssessmentNotAllowedError(error)) {
      return <AssessmentNotAllowed username={error.username || user.username} />;
    }
    throw error;
  }
  redirect(`/attempt/${attemptId}`);
}
