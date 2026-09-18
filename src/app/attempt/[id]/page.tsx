import { redirect } from "next/navigation";

import { ParticipantSession } from "@/components/quiz/participant-session";
import { currentUser } from "@/lib/session";

/**
 * The participant's attempt page. Reusable links assign the attempt before redirecting here.
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
