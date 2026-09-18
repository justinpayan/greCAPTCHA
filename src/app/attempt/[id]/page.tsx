import { redirect } from "next/navigation";

import { ParticipantSession } from "@/components/quiz/participant-session";
import { currentUser } from "@/lib/session";

/**
 * The participant's entry point. Authentication happens before this page loads, and the
 * one-time attempt is claimed by the account that starts it.
 */
export default async function AttemptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!(await currentUser())) {
    redirect(`/login?next=${encodeURIComponent(`/attempt/${id}`)}`);
  }
  return <ParticipantSession attemptId={id} />;
}
