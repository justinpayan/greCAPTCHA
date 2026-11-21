import { notFound } from "next/navigation";

import { PrintableQuestionSet } from "@/components/printable-question-set";
import { getQuestionSetOverview } from "@/lib/catalog";
import { requireTestAdministrator } from "@/lib/session";

export const metadata = { title: "Question set" };

export default async function QuestionSetPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ key?: string | string[] }>;
}) {
  const [{ id }, { key }] = await Promise.all([params, searchParams]);
  const user = await requireTestAdministrator().catch(() => notFound());
  const overview = await getQuestionSetOverview(id, user.id).catch((error: unknown) => {
    if (error instanceof Error && error.message === "Question set not found.") notFound();
    throw error;
  });
  if (overview.items.length === 0) notFound();

  return <PrintableQuestionSet items={overview.items} title={overview.label} withKey={key === "1"} />;
}
