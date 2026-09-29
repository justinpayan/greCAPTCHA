import {
  GET as handleInvitationGet,
  POST as handleInvitationPost,
} from "@/app/api/conference/[token]/route";

export const runtime = "nodejs";
export const maxDuration = 300;

type RouteContext = { params: Promise<{ token: string }> };

export async function GET(request: Request, context: RouteContext) {
  return handleInvitationGet(request, context);
}

export async function POST(request: Request, context: RouteContext) {
  return handleInvitationPost(request, context);
}
