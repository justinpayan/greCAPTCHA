import { notFound, redirect } from "next/navigation";

import { ConferenceInvitation } from "@/components/conference-invitation";
import { AssessmentNotAllowed } from "@/components/quiz/assessment-not-allowed";
import { isUsernameAllowed } from "@/lib/allowlist";
import { currentUser } from "@/lib/session";
import { getTemplateByInvitationToken } from "@/lib/templates";

export default async function ConferenceInvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/conference/${token}`)}`);

  try {
    const template = await getTemplateByInvitationToken(token);
    if (
      template.ownerUserId !== user.id &&
      !isUsernameAllowed(user.username, template.takerAllowlist)
    ) {
      return <AssessmentNotAllowed username={user.username} />;
    }
    return (
      <ConferenceInvitation
        token={token}
        template={{
          name: template.name,
          modelId: template.config.modelId,
          pdfEngine: template.config.pdfEngine,
          questionCount: template.config.blocks.reduce((sum, block) => sum + block.count, 0),
          apiKeyPayer: template.apiKeyPayer,
          materialUploader: template.materialUploader,
          materialFileName: template.materialFileName,
        }}
      />
    );
  } catch {
    notFound();
  }
}
