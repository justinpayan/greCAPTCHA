import { ExperimentSession } from "@/components/quiz/experiment-session";

/**
 * The chained participant link: one URL that runs both blocks of an experiment in order.
 *
 * Outside the password gate, like `/attempt/<id>` — the experiment ID in the URL is the
 * capability. It never renders the researcher's plan or the block conditions.
 */
export default async function ExperimentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ExperimentSession experimentId={id} />;
}
