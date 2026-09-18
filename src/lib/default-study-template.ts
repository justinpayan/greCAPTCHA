import {
  DEFAULT_FILL_PROMPT,
  type QuestionBlockConfig,
  type StudyTemplateConfig,
} from "@/lib/quiz";

const PLANTED_ERROR_PROMPT = `Generate planted-error detection items. Each item states a specific claim about this manuscript, and the participant must identify which version of the claim is what the paper actually reports.

Build each item from a single atomic, verifiable fact that appears exactly once in the paper: a numeric result, an ablation delta, a dataset or baseline name, a hyperparameter, a section or table attribution. Anchor the item to where that fact lives, such as "the ablation in Section 5.2" or "Table 3", so the key is checkable against a specific passage. Never include Section or Table names in the question text to avoid easily looking up the information.

Perturb a value or a referent, never a qualitative direction. Reassigning which component an effect belongs to, or which condition a number describes, is the target. Flipping "improves" to "degrades" is too easy and must not be used. Every incorrect option must be plausible enough that a reader who does not know the work has to locate and read the relevant passage to rule it out.

Never build an item on a fact the paper restates elsewhere, including in the abstract, a figure caption, or the conclusion. A restatement gives a non-author a cheap second place to check. Never build an item whose correct option can be identified by keyword overlap with the prompt, by grammar, by option length, or by being the most specific or most hedged option. Options must be mutually exclusive and comparable in length, specificity, and technical register.

Discard any candidate answerable from the title and abstract alone, and any candidate that someone who knows this field but has never read this paper would get right.`;

const UNSTATED_RATIONALE_PROMPT = `Generate unstated-rationale items. Each item asks the participant to justify a methodological or design choice whose reason is not stated in the manuscript.

Locate a choice the paper makes but does not explain: a test or estimator selected over an obvious alternative, a threshold or cut-off, an excluded condition, an ordering of stages, a control that is present or conspicuously absent. Ask why that choice is appropriate here and, where it sharpens the item, why it would not be appropriate for a specific other part of the paper.

The reason must be genuinely absent from the manuscript, so that no amount of searching the PDF produces it. If the paper explains the choice anywhere, including a footnote, an appendix, or a limitations paragraph, discard the item.

Ground every item in a specific named element of this paper: this comparison, this table, this preprocessing step. A question that could be asked of any paper in the field is testing field knowledge rather than authorship of this artifact, and must be discarded.

Build the rubric to award credit for reasoning that connects the choice to the specific properties of this study's data or design, and to withhold credit for a generically correct textbook justification that never touches this paper. Accept substantively equivalent reasoning and multiple valid explanations. Award no credit for fluency, length, confidence, or command of English; score only the content of the reasoning.`;

const BACKGROUND_CONCEPT_PROMPT = `Generate background-concept items. Each item asks the participant to define or explain, in their own words, one concept the paper depends on but does not itself define — the presupposed background a competent member of this field carries into reading it, not the paper's own contribution.

Choose concepts that are load-bearing. If the participant misunderstood the concept, the paper's design, its choice of method, or its interpretation of its results would no longer make sense. A term mentioned once in passing is not load-bearing; the standard is that you could name a specific design decision or claim that depends on it.

The most important filter is that the paper must not define the concept. The participant answers with the paper in front of them, so a concept the paper explains in its own words is a lookup rather than a question. Prefer concepts the paper names and uses as though they need no introduction. Where the paper's own topic is a concept it does define, choose an adjacent concept it presupposes instead: for a paper about p-hacking that defines p-hacking, ask what a p-value means under the null hypothesis, what the familywise error rate is, or what pre-registration is for.

Never name a section, table, figure, or page in the question text, and never reuse the paper's own phrasing of the concept. Both point the participant at a passage to copy.

Ask for two things in each item, in this order: the definition or explanation itself, and one sentence on why the concept matters for the work reported here. The first half is what the item is for. The second half is what someone who does not understand the work cannot supply, and it is where an answer assembled from general knowledge alone reads as generic.

Build the rubric as an enumeration of the elements a correct definition must contain, each its own criterion with its own points, totalling 70, plus one criterion worth 30 for the connection to this paper. Name the required elements explicitly in the guidance, so grading is a check against a list rather than a judgement of quality. For at least one criterion, state a specific plausible-but-wrong answer that earns nothing — the near-miss someone with topic-adjacent familiarity would give — so an answer that circles the concept without stating it cannot collect points.

Award nothing for fluency, length, hedging, confidence, or restating the question. Accept any wording that carries the required elements, including informal phrasing, an example that entails the definition, and notation in place of prose. Do not require the participant's terminology to match the paper's.

Discard any candidate concept whose definition appears anywhere in the paper, any answerable from the title alone, and any that duplicates a concept an earlier card already covers.`;

const FAILURE_MODE_PROMPT = `Generate failure-mode items asking the participant to name a realistic condition under which this work's method or central finding would degrade, and to say why it would.

Keep the question to one or two sentences, and ask for a short answer of two or three sentences. Word it neutrally: a condition the work was not built for, not a flaw in it. A scored item that reads as an attack on the participant's own paper invites a defensive answer rather than an informative one.

The condition must be specific to this setup and plausible in this domain — a property of the data, a regime, a scale, a population, or an interaction this pipeline would mishandle. Its mechanism must follow from how this work is built, not from general methodological caution.

Do not use anything the paper names itself: its limitations, its future work, its statements about what it did not test, or anything in the abstract. The participant reads with the paper open, so those are lookups. Never name a section, table, or figure in the question text.

In the guidance, list the qualifying conditions for this paper, each with the mechanism that makes it fail. Any one of them earns the naming points, since reasonable people will pick different edges.

Then list the answers that earn nothing: that the sample is small, that the results may not generalise, that more data or more baselines are needed, that the method is untested in other settings, and anything else that could be written without having read this paper. A fluent, confident answer of exactly that kind is the most likely wrong answer here, and it must score zero.

Weight the mechanism above the condition. Award nothing for fluency, length, hedging, or for restating what the paper already says about its own scope.`;

export function createDefaultStudyBlocks(): QuestionBlockConfig[] {
  return [
    {
      id: "default-planted-error",
      type: "multiple_choice",
      name: "F1 planted error",
      count: 2,
      optionsPerQuestion: 2,
      timeLimitSeconds: 45,
      warmup: false,
      prompt: PLANTED_ERROR_PROMPT,
    },
    {
      id: "default-unstated-rationale",
      type: "free_response",
      name: "F3 unstated rationale",
      count: 2,
      timeLimitSeconds: 150,
      warmup: false,
      prompt: UNSTATED_RATIONALE_PROMPT,
    },
    {
      id: "default-background-concept",
      type: "free_response",
      name: "F7 background concept",
      count: 2,
      timeLimitSeconds: 120,
      warmup: false,
      prompt: BACKGROUND_CONCEPT_PROMPT,
    },
    {
      id: "default-failure-mode",
      type: "free_response",
      name: "F9 failure mode",
      count: 2,
      timeLimitSeconds: 120,
      warmup: false,
      prompt: FAILURE_MODE_PROMPT,
    },
  ];
}

export function createDefaultStudyTemplate(modelId: string): StudyTemplateConfig {
  return {
    modelId,
    pdfEngine: "native",
    blocks: createDefaultStudyBlocks(),
    randomize: false,
    countdownHidden: false,
    overallTimeLimitSeconds: null,
  };
}

/** Recognizes the untouched one-card starter that predates the public default template. */
export function isLegacyStarterTemplate(config: StudyTemplateConfig) {
  if (
    config.blocks.length !== 1 ||
    config.randomize ||
    config.countdownHidden ||
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
    block.timeLimitSeconds === null &&
    block.warmup === false &&
    block.prompt === DEFAULT_FILL_PROMPT
  );
}
