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

To create a rubric, first list the core concept(s) you are testing about the paper, and why it is important to understand the concept(s) to verify the examinee understands the paper.

Generate 1-4 observable criteria that assess understanding of the concept(s). For each criterion, provide descriptions for three performance levels (emerging, proficient, advanced) using parallel structure. Focus on describing cognitive skills rather than products. Avoid terms like 'good' or 'excellent.' Each description should be specific enough that two graders would agree on the rating.
Important: These criteria should assess thinking processes that require engagement with document-specific content, not generic skills.
Provide a summary of the rubric in the text of the question, so the participant knows how they will be evaluated. This means that the question and rubric should be designed so that you are not giving away the answer in the rubric, but rather providing clear guidelines on what an acceptable answer looks like.
You should also generate 2 sample answers, one which receives partial credit and one which receives full credit. Do not show these in the question, but please include them in the full rubric. When the participant sees the rubric after they finish the test, they will benefit from knowing what is required to receive full points.


Design the question and rubric around a minimum sufficient explanation.
Keep the question open to multiple valid counterfactuals. Do not silently restrict the rubric to the particular answer used in your sample answer. If a particular element is essential, request it explicitly in the question.
Make the assessment target clear. 
Define advanced performance as the minimum reasoning sufficient to answer the question fully. Do not reserve full credit for additional examples, comparisons, qualifications, or technical details unless the question explicitly requires them and they are necessary for the definitions.
Accept concise explanations. 
Treat sample answers as illustrations, not exhaustive answer keys. Accept alternative conditions that satisfy the same conceptual criteria through a valid paper-specific mechanism.
Before returning the item, perform these checks:
-Write a brief answer containing a fairly sparse answer that contains all the necessary details. Verify that it receives full credit.
-Construct a substantively different answer. Verify that the rubric can award it full credit. If it cannot, broaden the rubric or make the question's restriction explicit.
-Check that every requirement for full credit is signaled in the question.
-Check that partial credit reflects missing or incorrect reasoning, rather than missing elaboration.`;

const BACKGROUND_CONCEPT_PROMPT = `Generate background-concept items. Each item asks the participant to define or explain, in their own words, one concept the paper depends on but does not itself define — the presupposed background a competent member of this field carries into reading it, not the paper's own contribution.

Choose concepts that are relevant to the understanding of the paper. If the participant misunderstood the concept, the paper's design, its choice of method, or its interpretation of its results would no longer make sense. A term mentioned once in passing is not relevant; the standard is that you could name a specific design decision or claim that depends on it.

The most important filter is that the paper must not define the concept. The participant answers with the paper in front of them, so a concept the paper explains in its own words is a lookup rather than a question. Prefer concepts the paper names and uses as though they need no introduction. Where the paper's own topic is a concept it does define, choose an adjacent concept it presupposes instead.

Never name a section, table, figure, or page in the question text, and never reuse the paper's own phrasing of the concept. Both point the participant at a passage to copy. Discard any candidate concept whose definition appears anywhere in the paper, any answerable from the title alone, and any that duplicates a concept an earlier card already covers.
To create a rubric, first list the core concept(s) you are testing about the paper, and why it is important to understand the concept(s) to verify the examinee understands the paper.

Generate 1-4 observable criteria that assess understanding of the concept(s). For each criterion, provide descriptions for three performance levels (emerging, proficient, advanced) using parallel structure. Focus on describing cognitive skills rather than products. Avoid terms like 'good' or 'excellent.' Each description should be specific enough that two graders would agree on the rating.
Important: These criteria should assess thinking processes that require engagement with document-specific content, not generic skills.
Provide a summary of the rubric in the text of the question, so the participant knows how they will be evaluated. This means that the question and rubric should be designed so that you are not giving away the answer in the rubric, but rather providing clear guidelines on what an acceptable answer looks like.
You should also generate 2 sample answers, one which receives partial credit and one which receives full credit. Do not show these in the question, but please include them in the full rubric. When the participant sees the rubric after they finish the test, they will benefit from knowing what is required to receive full points.

Design the question and rubric around a minimum sufficient explanation.
Keep the question open to multiple valid counterfactuals. Do not silently restrict the rubric to the particular answer used in your sample answer. If a particular element is essential, request it explicitly in the question.
Make the assessment target clear. 
Define advanced performance as the minimum reasoning sufficient to answer the question fully. Do not reserve full credit for additional examples, comparisons, qualifications, or technical details unless the question explicitly requires them and they are necessary for the definitions.
Accept concise explanations. 
Treat sample answers as illustrations, not exhaustive answer keys. Accept alternative conditions that satisfy the same conceptual criteria through a valid paper-specific mechanism.
Before returning the item, perform these checks:
-Write a brief answer containing a fairly sparse answer that contains all the necessary details. Verify that it receives full credit.
-Construct a substantively different answer. Verify that the rubric can award it full credit. If it cannot, broaden the rubric or make the question's restriction explicit.
-Check that every requirement for full credit is signaled in the question.
-Check that partial credit reflects missing or incorrect reasoning, rather than missing elaboration.

Award nothing for fluency, length, hedging, confidence, or restating the question. Accept any wording that carries the required elements, including informal phrasing, an example that entails the definition, and notation in place of prose. Do not require the participant's terminology to match the paper's.`;

const COUNTERFACTUAL_PROMPT = `Generate counterfactual items asking the participant to name a realistic condition under which this work's main argument, method, or central finding would degrade, and to say why it would.

Word the question neutrally, such as a condition the work was not built for, not a flaw in it. A scored item that reads as an attack on the participant's own paper invites a defensive answer rather than an informative one. Ensure that only one question is asked.

The condition must be specific to the paper and plausible in its domain — such as, a property of the data, a regime, a scale, a population, a counterexample, or an interaction its pipeline would mishandle. Its mechanism must follow from how this work is built, not from general methodological caution.

Do not use anything the paper names itself: its limitations, its future work, its statements about what it did not test, or anything in the abstract. The participant reads with the paper open, so those are lookups. Never name a section, table, or figure in the question text.

To create a rubric, first list 1 or 2 core concepts you are testing about the paper, and why it is important to understand them to verify the examinee understands the paper.

Generate 1-4 observable criteria that assess understanding of these concepts. For each criterion, provide descriptions for three performance levels (emerging, proficient, advanced) using parallel structure. Focus on describing cognitive skills rather than products. Avoid terms like 'good' or 'excellent.' Each description should be specific enough that two graders would agree on the rating.
Important: These criteria should assess thinking processes that require engagement with document-specific content, not generic skills.
Provide a summary of the rubric in the text of the question, so the participant knows how they will be evaluated. This means that the question and rubric should be designed so that you are not giving away the answer in the rubric, but rather providing clear guidelines on what an acceptable answer looks like.
You should also generate 2 sample answers, one which receives partial credit and one which receives full credit. Do not show these in the question, but please include them in the full rubric. When the participant sees the rubric after they finish the test, they will benefit from knowing what is required to receive full points.


Design the question and rubric around a minimum sufficient explanation: one realistic condition, its interaction with a specific feature of the work, and the resulting degradation or interpretive limit.
Keep the question open to multiple valid counterfactuals. Do not silently restrict the rubric to the particular counterfactual used in your sample answer. If a particular comparison or mechanism is essential, request it explicitly in the question.
Make the assessment target clear. Distinguish degradation of the method's performance from weakening an inference drawn from its output. A condition can limit what an output establishes even when the method still performs its intended task. Do not treat an intentionally limited assessment scope as a failure to achieve a broader goal.
Use three rubric criteria by default:
Identify a realistic, paper-specific condition.
Explain how that condition interacts with the work's design, method, or evidence.
Explain the resulting consequence for performance or interpretation.
Define advanced performance as the minimum reasoning sufficient to answer the question fully. Do not reserve full credit for additional examples, comparisons, qualifications, technical details, or remedies unless the question explicitly requires them and they are necessary to establish the mechanism.
Accept concise causal explanations. Credit a relationship that is clearly entailed by the response, even if the participant does not separately state every intermediate step. Do not infer reasoning that the response does not support.
Treat sample answers as illustrations, not exhaustive answer keys. Accept alternative conditions that satisfy the same conceptual criteria through a valid paper-specific mechanism.
Before returning the item, perform these checks:
-Write a brief answer containing only a condition, a paper-specific mechanism, and a consequence. Verify that it receives full credit.
-Construct a substantively different valid counterfactual. Verify that the rubric can award it full credit. If it cannot, broaden the rubric or make the question's restriction explicit.
-Check that every requirement for full credit is signaled in the question.
-Check that partial credit reflects missing or incorrect reasoning, rather than missing elaboration.

Award nothing for fluency, length, hedging, confidence, or restating the question. Accept any wording that carries the required elements, including informal phrasing, an example that entails the definition, and notation in place of prose. Do not require the participant's terminology to match the paper's.`;

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
    },
    {
      id: "default-background-concept",
      type: "free_response",
      name: "Background concept",
      count: 2,
      candidatePoolSize: 6,
      warmup: false,
      prompt: BACKGROUND_CONCEPT_PROMPT,
    },
    {
      id: "default-counterfactual",
      type: "free_response",
      name: "Counterfactual",
      count: 2,
      candidatePoolSize: 6,
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
