import { ParticipantSession } from "@/components/quiz/participant-session";

/**
 * The participant's entry point. Deliberately outside the password gate: the attempt ID in
 * the URL is the capability. It never renders the setup screen or the researcher plan.
 */
export default async function AttemptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ParticipantSession attemptId={id} />;
}
