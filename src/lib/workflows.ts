import type { ApiKeyPayer, MaterialUploader } from "@/lib/quiz";

/**
 * The four test workflows: who pays OpenRouter costs, crossed with who uploads the source
 * material. Each has its own colour (the `workflow-<key>` classes in globals.css), so the choice
 * made while creating a test is recognisable again wherever the test appears afterwards.
 */
export type WorkflowKey =
  | "creator-creator"
  | "creator-taker"
  | "taker-creator"
  | "taker-taker";

export type WorkflowInfo = {
  key: WorkflowKey;
  label: string;
  /** One line on what the combination means in practice. */
  description: string;
};

const WORKFLOWS: Record<WorkflowKey, WorkflowInfo> = {
  "creator-creator": {
    key: "creator-creator",
    label: "Creator pays & uploads",
    description: "You provide the material and pay; everyone takes the same test from one link.",
  },
  "creator-taker": {
    key: "creator-taker",
    label: "Creator pays, taker uploads",
    description: "You pay; each test taker uploads their own paper and gets their own test.",
  },
  "taker-creator": {
    key: "taker-creator",
    label: "Taker pays, creator uploads",
    description: "You provide the material; each test taker pays with their own OpenRouter key.",
  },
  "taker-taker": {
    key: "taker-taker",
    label: "Taker pays & uploads",
    description: "Each test taker uploads their own paper and pays with their own OpenRouter key.",
  },
};

export function workflowFor(apiKeyPayer: ApiKeyPayer, materialUploader: MaterialUploader) {
  return WORKFLOWS[`${apiKeyPayer}-${materialUploader}`];
}
