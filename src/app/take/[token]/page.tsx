import { redirect } from "next/navigation";

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
  const { attemptId } = await getOrCreateTakerAttempt(token, user);
  redirect(`/attempt/${attemptId}`);
}
