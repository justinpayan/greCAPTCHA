import { notFound, redirect } from "next/navigation";

import { AssessmentInvitation } from "@/components/conference-invitation";
import { currentUser } from "@/lib/session";
import { getTemplateByInvitationToken } from "@/lib/templates";

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);

  try {
    const template = await getTemplateByInvitationToken(token);
    return (
      <AssessmentInvitation
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
