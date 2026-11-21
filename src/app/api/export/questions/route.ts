import { zipSync } from "fflate";
import { cookies } from "next/headers";
import { z } from "zod";

import { SESSION_COOKIE } from "@/lib/auth";
import { getQuestionSetOverview } from "@/lib/catalog";
import { QUESTION_PDF_ZIP_NAME, questionPdfFilenames } from "@/lib/question-pdf-filenames";
import { renderQuestionPdfs } from "@/lib/question-pdf-renderer";
import { assertSameOrigin } from "@/lib/security";
import { requireTestAdministrator } from "@/lib/session";
import { publicErrorMessage } from "@/lib/user-facing-error";

export const runtime = "nodejs";
export const maxDuration = 300;

const setId = z.string().regex(/^[\w-]+$/).max(128);
const exportRequest = z.discriminatedUnion("format", [
  z.object({ format: z.literal("zip"), ids: z.array(setId).min(1).max(1_000) }),
  z.object({ format: z.literal("pdf"), ids: z.tuple([setId]), withKey: z.boolean() }),
]);

export async function POST(request: Request) {
  let user;
  let sessionCookie;
  try {
    assertSameOrigin(request);
    user = await requireTestAdministrator();
    sessionCookie = (await cookies()).get(SESSION_COOKIE);
    if (!sessionCookie) throw new Error("Not authorised.");
  } catch (error) {
    return Response.json(
      { error: publicErrorMessage(error, "Not authorised.") },
      { status: 403 },
    );
  }

  const input = exportRequest.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return Response.json(
      { error: "The selection could not be downloaded. Choose the tests again." },
      { status: 400 },
    );
  }

  const ids = [...new Set(input.data.ids)];
  const asZip = input.data.format === "zip";
  const withKey = input.data.format === "pdf" && input.data.withKey;
  try {
    const overviews = await Promise.all(ids.map((id) => getQuestionSetOverview(id, user.id)));
    if (overviews.some((overview) => overview.items.length === 0)) {
      return Response.json({ error: "A selected test has no questions to download." }, { status: 400 });
    }

    const filenames = questionPdfFilenames(overviews, withKey);
    const pdfs = await renderQuestionPdfs(
      ids,
      withKey,
      SESSION_COOKIE + "=" + encodeURIComponent(sessionCookie.value),
      request.signal,
    );
    const filename = asZip ? QUESTION_PDF_ZIP_NAME : filenames[0];
    const fallbackFilename = asZip ? QUESTION_PDF_ZIP_NAME : withKey ? "answer-key.pdf" : "questions.pdf";
    const encodedFilename = encodeURIComponent(filename).replace(/['()*]/g, (character) =>
      "%" + character.charCodeAt(0).toString(16).toUpperCase(),
    );
    const bytes = asZip
      ? zipSync(Object.fromEntries(filenames.map((name, index) => [name, pdfs[index]])), { level: 0 })
      : pdfs[0];
    return new Response(Uint8Array.from(bytes), {
      headers: {
        "Content-Type": asZip ? "application/zip" : "application/pdf",
        "Content-Disposition":
          `attachment; filename="${fallbackFilename}"; filename*=UTF-8''${encodedFilename}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Question set not found.") {
      return Response.json({ error: error.message }, { status: 404 });
    }
    if (!request.signal.aborted) console.error("Question PDF export failed.", error);
    return Response.json({ error: "Unable to prepare the question PDFs." }, { status: 500 });
  }
}
