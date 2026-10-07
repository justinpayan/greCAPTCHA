import {
  DEFAULT_FILL_PROMPT,
  type QuestionBlockConfig,
  type StudyTemplateConfig,
} from "@/lib/quiz";

const PROCESS_MATCHING_PROMPT = `Generate process-matching fill-in-the-blank questions. Each item presents a specific chain of reasoning from this manuscript with numbered blanks that the participant must complete. Test whether the participant understands how the parts of the work connect, such as what question motivated a method, what that method established, and how the resulting evidence supports a conclusion.

Build each item around one coherent chain of three to five connected steps, with two or three substantive steps replaced by blanks. Leave enough context to identify the intended chain and constrain each missing step. Use short connected sentences that make the relationships clear, such as “To determine [given objective], the authors [blank 1]. This comparison showed [blank 2], supporting [given interpretation].” Adapt the structure to the actual reasoning in the paper; do not force every item into the same template.

When generation is restricted to particular sections or contributions, keep the entire assessed chain within that scope. Do not require a research question, result, or conclusion found only elsewhere in the manuscript. Choose a local chain instead, such as a methodological requirement leading to a procedure and its output, an assumption leading through an argument to a claim, or a comparison leading to a finding and its interpretation. If the permitted material does not support a coherent chain, discard the candidate rather than inventing connections or expanding the scope.

Every step and connection must be supported by the manuscript. Reconstruct the argument as reported, without inventing the authors’ private motivations or the historical order in which they conducted the research. Preserve the strength of the evidence: an association must not become a causal claim, and a qualified finding must not become an unconditional conclusion.

Blank out meaningful content, such as the comparison performed, the pattern observed, or the inference drawn. Do not remove isolated words, exact numerical values, or names whose recovery tests recall without testing the chain. Each blank should require a short phrase or short sentence. Identify its expected role—method, finding, interpretation, or another appropriate role—without revealing its content.

Paraphrase and combine the relevant material rather than deleting words from a copied passage. Never name a section, table, figure, or page in the question text. Discard any candidate answerable from the title and abstract alone, from generic field knowledge, or from grammatical cues in the surrounding text.`;

const UNSTATED_RATIONALE_PROMPT = `Generate unstated-rationale items. Each item asks the participant to justify a methodological or design choice whose reason is not stated in the manuscript.

Locate a choice the paper makes but does not explain, such as a test or estimator selected over an obvious alternative, a threshold or cut-off, an excluded condition, an ordering of stages, a control that is present or conspicuously absent, etc. Ask why that choice is appropriate here. Alternatively, where it sharpens the item, ask why it would not be appropriate for a specific other part of the paper. Ensure that only one question is asked. Do not ask questions with multiple connected or unrelated parts.

The reason must be genuinely absent from the manuscript, so that no amount of searching the PDF produces it. If the paper explains the choice anywhere, including a footnote, an appendix, or a limitations paragraph, discard the item.

Ground every item in a specific named element of this paper, such as this comparison, this table, this preprocessing step, etc. A question that could be asked of any paper in the field is testing field knowledge rather than authorship of this artifact, and must be discarded.

Build the rubric to award credit for reasoning that connects the choice to the specific properties of this study's data or design, and to withhold credit for a generically correct textbook justification that never touches this paper. Accept substantively equivalent reasoning and multiple valid explanations. Award no credit for fluency, length, confidence, or command of English; score only the content of the reasoning.

For each item of the rubric, the question should explicitly name it without giving away the answer. To do this, say something like "To receive full points, you should cover these N points: (1) … (2) … (N) …" Avoid telegraphing the answer. Someone who understands the paper shouldn't have to guess that you want them to cover those components, it should be made crystal clear what topics need to be covered ahead of time.`;

const BACKGROUND_CONCEPT_PROMPT = `Generate background-concept items. Each item asks the participant to define or explain, in their own words, one concept the paper depends on but does not itself define — the presupposed background a competent member of this field carries into reading it, not the paper's own contribution.

Choose concepts that are relevant to the understanding of the paper. If the participant misunderstood the concept, the paper's design, its choice of method, or its interpretation of its results would no longer make sense. A term mentioned once in passing is not relevant; the standard is that you could name a specific design decision or claim that depends on it.

The most important filter is that the paper must not define the concept. The participant answers with the paper in front of them, so a concept the paper explains in its own words is a lookup rather than a question. Prefer concepts the paper names and uses as though they need no introduction. Where the paper's own topic is a concept it does define, choose an adjacent concept it presupposes instead.

Never name a section, table, figure, or page in the question text, and never reuse the paper's own phrasing of the concept. Both point the participant at a passage to copy. Discard any candidate concept whose definition appears anywhere in the paper, any answerable from the title alone, and any that duplicates a concept an earlier card already covers.

Build the rubric as an enumeration of the elements a correct definition must contain, each its own criterion with its own points. For each item of the rubric, the question should explicitly name it without giving away the answer. To do this, say something like "To receive full points, you should cover these N points: (1) … (2) … (N) …" Avoid telegraphing the answer. Someone who understands the paper shouldn't have to guess that you want them to cover those components, it should be made crystal clear what topics need to be covered ahead of time.

Award nothing for fluency, length, hedging, confidence, or restating the question. Accept any wording that carries the required elements, including informal phrasing, an example that entails the definition, and notation in place of prose. Do not require the participant's terminology to match the paper's.`;

const COUNTERFACTUAL_PROMPT = `Generate counterfactual items asking the participant to name a realistic condition under which this work's main argument, method, or central finding would degrade, and to say why it would.

Word the question neutrally, such as a condition the work was not built for, not a flaw in it. A scored item that reads as an attack on the participant's own paper invites a defensive answer rather than an informative one. Ensure that only one question is asked.

The condition must be specific to the paper and plausible in its domain — such as, a property of the data, a regime, a scale, a population, a counterexample, or an interaction its pipeline would mishandle. Its mechanism must follow from how this work is built, not from general methodological caution.

Do not use anything the paper names itself: its limitations, its future work, its statements about what it did not test, or anything in the abstract. The participant reads with the paper open, so those are lookups. Never name a section, table, or figure in the question text.

In the rubric, list qualifying conditions for this paper, each with the mechanism that makes it fail. Any one of them earns the naming points, since reasonable people will pick different edges. Then list the answers that earn nothing: that the sample is small, that the results may not generalise, that more data or more baselines are needed, that the method is untested in other settings, and anything else that could be written without having read this paper. Weight the mechanism above the condition.

For each item of the rubric, the question should explicitly name it without giving away the answer. To do this, say something like "To receive full points, you should cover these N points: (1) … (2) … (N) …" Avoid telegraphing the answer. Someone who understands the paper shouldn't have to guess that you want them to cover those components, it should be made crystal clear what topics need to be covered ahead of time.

Award nothing for fluency, length, hedging, confidence, or restating the question. Accept any wording that carries the required elements, including informal phrasing, an example that entails the definition, and notation in place of prose. Do not require the participant's terminology to match the paper's.`;

export function createDefaultStudyBlocks(): QuestionBlockConfig[] {
  return [
    {
      id: "default-process-matching",
      type: "fill_blank",
      name: "Process matching",
      count: 2,
      distractorsPerBlank: 2,
      warmup: false,
      prompt: PROCESS_MATCHING_PROMPT,
    },
    {
      id: "default-unstated-rationale",
      type: "free_response",
      name: "Unstated rationale",
      count: 2,
      warmup: false,
      prompt: UNSTATED_RATIONALE_PROMPT,
    },
    {
      id: "default-background-concept",
      type: "free_response",
      name: "Background concept",
      count: 2,
      warmup: false,
      prompt: BACKGROUND_CONCEPT_PROMPT,
    },
    {
      id: "default-counterfactual",
      type: "free_response",
      name: "Counterfactual",
      count: 2,
      warmup: false,
      prompt: COUNTERFACTUAL_PROMPT,
    },
  ];
}

export function createDefaultStudyTemplate(modelId: string): StudyTemplateConfig {
  return {
    modelId,
    pdfEngine: "native",
    blocks: createDefaultStudyBlocks(),
    randomize: false,
    overallTimeLimitSeconds: 30 * 60,
  };
}

/** Recognizes the untouched one-card starter that predates the public default template. */
export function isLegacyStarterTemplate(config: StudyTemplateConfig) {
  if (
    config.blocks.length !== 1 ||
    config.randomize ||
    config.overallTimeLimitSeconds !== null
  ) {
    return false;
  }

  const block = config.blocks[0];
  return (
    block.id === "initial-fill-block" &&
    block.type === "fill_blank" &&
    block.name === "" &&
    block.count === 5 &&
    block.distractorsPerBlank === 3 &&
    block.warmup === false &&
    block.prompt === DEFAULT_FILL_PROMPT
  );
}
