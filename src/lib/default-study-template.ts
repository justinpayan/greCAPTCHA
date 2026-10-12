import {
  DEFAULT_FILL_PROMPT,
  type FixedRubric,
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

Ground every item in a specific named element of this paper, such as this comparison, this table, this preprocessing step, etc. A question that could be asked of any paper in the field is testing field knowledge rather than authorship of this artifact, and must be discarded.`;

const BACKGROUND_CONCEPT_PROMPT = `Generate background-concept items. Each item asks the participant to define or explain, in their own words, one concept the paper depends on but does not itself define — the presupposed background a competent member of this field carries into reading it, not the paper's own contribution.

Choose concepts that are relevant to the understanding of the paper. If the participant misunderstood the concept, the paper's design, its choice of method, or its interpretation of its results would no longer make sense. A term mentioned once in passing is not relevant; the standard is that you could name a specific design decision or claim that depends on it.

The most important filter is that the paper must not define the concept. The participant answers with the paper in front of them, so a concept the paper explains in its own words is a lookup rather than a question. Prefer concepts the paper names and uses as though they need no introduction. Where the paper's own topic is a concept it does define, choose an adjacent concept it presupposes instead.

Never name a section, table, figure, or page in the question text, and never reuse the paper's own phrasing of the concept. Both point the participant at a passage to copy. Discard any candidate concept whose definition appears anywhere in the paper, any answerable from the title alone, and any that duplicates a concept an earlier card already covers.`;

const COUNTERFACTUAL_PROMPT = `Generate counterfactual items asking the participant to name a realistic condition under which this work's main argument, method, or central finding would degrade, and to say why it would.

Word the question neutrally, such as a condition the work was not built for, not a flaw in it. A scored item that reads as an attack on the participant's own paper invites a defensive answer rather than an informative one. Ensure that only one question is asked.

The condition must be specific to the paper and plausible in its domain — such as, a property of the data, a regime, a scale, a population, a counterexample, or an interaction its pipeline would mishandle. Its mechanism must follow from how this work is built, not from general methodological caution.

Do not use anything the paper names itself: its limitations, its future work, its statements about what it did not test, or anything in the abstract. The participant reads with the paper open, so those are lookups. Never name a section, table, or figure in the question text.`;

// Fixed rubrics for the default free-response cards: every question a card generates is graded on
// these criteria and points, with only a per-question note added by the generator.
const UNSTATED_RATIONALE_RUBRIC: FixedRubric = {
  summary: "Explain what this choice achieves for this study (30). Make sure to connect the purpose of the choice to a concrete feature of this study's data, design, setting, etc. (50). Explain what would go wrong with an obvious alternative, or with omitting the choice (20). Be specific: a correct but general justification that could apply to any study will earn less credit.",
  levels: [
    { label: "Full", percent: 100 },
    { label: "Half", percent: 50 },
    { label: "None", percent: 0 },
  ],
  criteria: [
    {
      criterion: "Identifies what the choice achieves. States the problem the choice solves or the property it secures.",
      description: "",
      points: 30,
      descriptions: [
        "Names the specific purpose the choice serves in this study.",
        "Names a plausible purpose, but it is vague or only partly fits the choice.",
        "Names no purpose, or one that doesn't apply to this choice.",
      ],
    },
    {
      criterion: "Links it to this study. Connects the purpose to a concrete feature of this study's data, design or setting.",
      description: "",
      points: 50,
      descriptions: [
        "Ties the purpose to a named feature of this study and explains why that feature makes the choice appropriate.",
        "Mentions a feature of the study, but the link to the choice is asserted rather than explained.",
        "Gives only a textbook justification that never touches this paper.",
      ],
    },
    {
      criterion: "Explains what the alternative would cost. Says what would go wrong with an obvious alternative, or with omitting the choice.",
      description: "",
      points: 20,
      descriptions: [
        "States a specific consequence of the alternative for this study.",
        "States a generic downside of the alternative.",
        "No alternative or consequence given.",
      ],
    },
  ],
  gradingNote: "",
};

const BACKGROUND_CONCEPT_RUBRIC: FixedRubric = {
  summary: "Define the concept in your own words, and set the concept apart from any closely related ones (40). Explain the conditions, assumptions, or components essential to the definition (30). Name a specific design decision, method, or claim in the paper that depends on the concept, and explain why it depends on the concept (30).",
  levels: [
    { label: "Full", percent: 100 },
    { label: "Half", percent: 50 },
    { label: "None", percent: 0 },
  ],
  criteria: [
    {
      criterion: "Correct core definition. States what the concept is.",
      description: "",
      points: 40,
      descriptions: [
        "A correct definition that sets the concept apart from closely related ones, if any.",
        "Broadly right, but imprecise or mixes it up with a neighbouring concept.",
        "Incorrect, circular, or missing.",
      ],
    },
    {
      criterion: "Essential elements. Covers the conditions, assumptions or components the definition can't do without.",
      description: "",
      points: 30,
      descriptions: [
        "Gives the elements essential to the definition, each correct.",
        "Gives some of the required elements, or all with an error.",
        "Gives none correctly.",
      ],
    },
    {
      criterion: "Role in this work. Names a specific design decision, method or claim in the paper that depends on the concept, and why it depends on it.",
      description: "",
      points: 30,
      descriptions: [
        "Names a specific dependency and explains why it depends on the concept.",
        "Names a relevant part of the paper but doesn't explain the dependency.",
        "Gives no paper-specific connection, or only a generic statement of importance.",
      ],
    },
  ],
  gradingNote: "",
};

const COUNTERFACTUAL_RUBRIC: FixedRubric = {
  summary: "Name one realistic, paper-specific condition or counterfactual this work was not designed for (30). Explain how the condition interacts with the work's design, method or evidence, outlining its causal path through the specific features of the work (40). State the resulting consequence (degraded performance, a limit on what can be concluded, or both) and what it means for the work's conclusions (30). Do not use a limitation the paper already states.",
  levels: [
    { label: "Full", percent: 100 },
    { label: "Half", percent: 50 },
    { label: "None", percent: 0 },
  ],
  criteria: [
    {
      criterion: "Realistic, paper-specific condition. A realistic condition or counterfactual this work was not designed for, specific to how the work is designed and plausible in its domain.",
      description: "",
      points: 30,
      descriptions: [
        "A plausible condition or counterfactual in this domain, specific to how this work is designed, and not one the paper itself lists as a limitation.",
        "A plausible condition or counterfactual, but generic to the field or loosely tied to this work.",
        "Implausible, missing, or taken from the paper's own limitations.",
      ],
    },
    {
      criterion: "Mechanism. How the condition interacts with the work's design, method or evidence.",
      description: "",
      points: 40,
      descriptions: [
        "Explains the causal path through a specific feature of the work.",
        "Gives a mechanism that is generic or skips a step the answer doesn't support.",
        "No mechanism, or one that doesn't follow from how the work is designed.",
      ],
    },
    {
      criterion: "Consequence. The resulting degraded performance or limit on what can be concluded, and what it means for the work's conclusions.",
      description: "",
      points: 30,
      descriptions: [
        "States a specific consequence and what it means for the work's conclusions.",
        "States a consequence, but it is vague, does not say what it means for the conclusions, or confuses degraded performance with a weaker conclusion.",
        "No consequence, or one that doesn't follow from the mechanism.",
      ],
    },
  ],
  gradingNote: "If the condition is one the paper already lists as a limitation, award no points for the mechanism or the consequence either, so the whole answer scores 0.",
};

/** Applied to every free-response grading request of the default template. */
export const DEFAULT_GRADING_INSTRUCTIONS = `- **Content only:** no points for fluency, length, hedging, confidence, command of English, or restating the question.
- **Any valid wording:** accept equivalent wording, informal phrasing and notation, and do not require the paper's own terms.
- **Minimum is enough:** full credit means the minimum sufficient answer. Extra examples, comparisons or caveats are never required unless the question asks for them.
- **Other valid answers count:** an answer that differs from the sample but is valid and specific to the paper earns full credit.
- **Implied steps count:** credit a step that the answer clearly entails, even if it is not stated separately, but do not infer reasoning the answer does not support.`;

export function createDefaultStudyBlocks(): QuestionBlockConfig[] {
  return [
    {
      id: "default-process-matching",
      type: "fill_blank",
      name: "Process matching",
      count: 2,
      candidatePoolSize: 6,
      distractorsPerBlank: 2,
      warmup: false,
      prompt: PROCESS_MATCHING_PROMPT,
    },
    {
      id: "default-unstated-rationale",
      type: "free_response",
      name: "Unstated rationale",
      count: 2,
      candidatePoolSize: 6,
      warmup: false,
      prompt: UNSTATED_RATIONALE_PROMPT,
      rubricPrompt: "",
      fixedRubric: UNSTATED_RATIONALE_RUBRIC,
    },
    {
      id: "default-background-concept",
      type: "free_response",
      name: "Background concept",
      count: 2,
      candidatePoolSize: 6,
      warmup: false,
      prompt: BACKGROUND_CONCEPT_PROMPT,
      rubricPrompt: "",
      fixedRubric: BACKGROUND_CONCEPT_RUBRIC,
    },
    {
      id: "default-counterfactual",
      type: "free_response",
      name: "Counterfactual",
      count: 2,
      candidatePoolSize: 6,
      warmup: false,
      prompt: COUNTERFACTUAL_PROMPT,
      rubricPrompt: "",
      fixedRubric: COUNTERFACTUAL_RUBRIC,
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
    gradingInstructions: DEFAULT_GRADING_INSTRUCTIONS,
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
