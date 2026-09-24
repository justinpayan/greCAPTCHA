import { notFound, redirect } from "next/navigation";

import { ConferenceInvitation } from "@/components/conference-invitation";
import { currentUser } from "@/lib/session";
import { getConferenceTemplateByToken } from "@/lib/templates";

export default async function ConferenceInvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/conference/${token}`)}`);

  try {
    const template = await getConferenceTemplateByToken(token);
    return (
      <ConferenceInvitation
        token={token}
        template={{
          name: template.name,
          modelId: template.config.modelId,
          pdfEngine: template.config.pdfEngine,
          questionCount: template.config.blocks.reduce((sum, block) => sum + block.count, 0),
        }}
      />
    );
  } catch {
    notFound();
  }
}
