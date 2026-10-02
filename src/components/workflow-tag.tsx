import type { ApiKeyPayer, MaterialUploader } from "@/lib/quiz";
import { workflowFor } from "@/lib/workflows";

/** A test's workflow as a coloured tag, the same colour it had when it was created. */
export function WorkflowTag({
  apiKeyPayer,
  materialUploader,
}: {
  apiKeyPayer: ApiKeyPayer;
  materialUploader: MaterialUploader;
}) {
  const workflow = workflowFor(apiKeyPayer, materialUploader);
  return (
    <span className={`workflow-tag workflow-${workflow.key}`} title={workflow.description}>
      {workflow.label}
    </span>
  );
}
