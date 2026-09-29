import { GET as handleInvitationJobGet } from "@/app/api/conference/jobs/[id]/route";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleInvitationJobGet(request, context);
}
