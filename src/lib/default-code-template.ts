import type { FixedRubric, QuestionBlockConfig } from "@/lib/quiz";

/**
 * The standard template for assessments generated from a codebase: five question families that
 * test whether a student understands code they claim to have written, rather than whether they can
 * find things in it. The student answers with the code open, so every family is built to resist
 * lookup: the answer must come from tracing, reasoning about, or knowing the code, not from
 * searching it.
 */

const EXECUTION_TRACING_PROMPT = `Generate execution-tracing items. Each item names one function, method, or short call chain the student wrote, supplies a concrete input or starting state, and asks what it returns, prints, raises, or leaves in a named variable, field, or data structure.

Choose inputs that exercise a non-obvious path: a boundary, an empty or single-element collection, a branch taken only under a specific condition, an early return, a default argument, a mutation shared between calls, or an interaction between two pieces of state. A path a reader can follow at a glance tests reading speed, not understanding; discard it.

The correct answer must follow deterministically from the code as written, not from what the code was evidently meant to do. If the code has a bug on the chosen path, the correct answer is the buggy behaviour. Trace the path yourself, step by step, before writing the options, and discard the item if any step depends on something not in the codebase, such as external input, the current time, randomness, or a library's undocumented behaviour.

Name the function by its file and identifier rather than pasting its body. Give the input in a short fenced code block when it is more than a few characters. Distractors must be the outcomes a reader would reach by misreading one specific step, such as an off-by-one, the other branch, a missed mutation, a misread default, or integer versus float division; never random values. Each distractor must be wrong for exactly one identifiable reason.

Discard any item whose answer appears in a comment, docstring, test, or example in the codebase.`;

const FLOW_RECONSTRUCTION_PROMPT = `Generate flow-reconstruction fill-in-the-blank items. Each item describes one path through the student's system in three to five connected steps, such as how an incoming request, user action, message, or input record travels from its entry point to its final effect, with two or three substantive steps replaced by blanks.

Build each item around one coherent path that crosses at least two functions or modules. Use short connected sentences that make the relationships clear, such as "When [given entry point] receives a request, it [blank 1]. The result is passed to [given component], which [blank 2] before [given final effect]." Adapt the structure to the actual flow in the code; do not force every item into the same template.

Blank out what happens and why: the transformation applied, the check performed, the component that takes over, or the state that changes. Never blank out a function, class, variable, or file name, which a search would find. Each blank should require a short phrase, and its answer must be stated in terms of behaviour rather than identifiers.

Every step must be supported by the code as it is, not as the README or comments describe it; where they disagree, follow the code. Keep the whole path within the code the student declared as theirs. Paraphrase; never paste code into the item. Discard any candidate answerable from the README, from the names of the functions involved, or from grammatical cues in the surrounding text.`;

const CHANGE_IMPACT_PROMPT = `Generate change-impact items. Each item proposes one small, concrete modification to the student's code and asks what would change in the program's behaviour, and why. Suitable modifications include changing a condition or comparison, reordering two calls or statements, removing a guard, check, or lock, swapping a data structure, changing a default value, or dropping an await, a copy, or a cache invalidation.

Choose modifications whose consequences reach beyond the edited line: another module, a caller's assumption, a test, persisted or shared state, an ordering or concurrency property, or what a user sees. A modification whose only effect is local and obvious from reading that line is a lookup; discard it. So is one whose effect the code's comments or tests already describe.

State the modification precisely, by file, function, and the exact change, quoting at most the one or two lines affected. Word it neutrally, as a hypothetical edit, not as a bug the student introduced. Ask one question only; do not ask for a fix.

The expected answer names the observable consequence, traces the mechanism from the edited line to that consequence through this code, and says where the change would first become visible. Before keeping an item, trace that mechanism yourself and confirm the consequence actually occurs.`;

const DESIGN_RATIONALE_PROMPT = `Generate unstated design-rationale items. Each item asks the student to justify one design or implementation choice in their code whose reason is not written anywhere in the repository.

Locate a choice the code makes but does not explain, such as a data structure chosen over an obvious alternative, a library or framework, a caching, batching, or retry strategy, an ordering of operations, an error-handling strategy, a module or class boundary, a concurrency mechanism, or a configuration value. Ask why that choice is appropriate here. Alternatively, where it sharpens the item, ask why it would not suit a specific other part of the code. Ask one question only.

The reason must be genuinely absent from the repository, so that no amount of searching produces it. If a comment, docstring, commit message, README, design document, or issue text in the codebase explains the choice, discard the item.

Ground every item in a specific named element of this code, such as this function, this class, this configuration value, or this module boundary. A question that could be asked of any project using the same language or framework tests general knowledge rather than authorship of this code, and must be discarded.`;

const FAILURE_CONDITIONS_PROMPT = `Generate failure-condition items. Each item asks the student to name a realistic input, environment, or usage pattern under which a specific component of their code would fail, misbehave, or degrade, and to explain how.

Point the question at one named component, by file and function, class, or module. The failure must follow from how this code is built, such as an unchecked assumption about input, an unhandled case in a branch or match, a race between concurrent operations, unbounded growth of memory or work, an encoding, locale, time-zone, or precision issue, or a dependency on ordering. Generic advice such as "add more validation" or "handle errors" is not a failure condition; design items whose good answers cannot be generic.

Word the question neutrally, as a condition the code was not designed for, not as a flaw in it. Ask one question only; do not ask for a fix.

Do not use anything the repository already flags: TODO or FIXME comments, known-issue notes, skipped or expected-failure tests, or limitations stated in the README. The student reads with the code open, so those are lookups. Before keeping an item, confirm from the code that at least one realistic condition of this kind exists for the named component.`;

const FULL_HALF_NONE = [
  { label: "Full", percent: 100 },
  { label: "Half", percent: 50 },
  { label: "None", percent: 0 },
];

// The three free-response rubrics share one shape: what (30), why through this code (50), and
// where it shows (20). The middle criterion carries the most weight because it is the one a
// student who did not write or understand the code cannot fake, and the shared shape makes it
// comparable across families.

const CHANGE_IMPACT_RUBRIC: FixedRubric = {
  summary: "Say what would change in the program's behaviour (30). Explain the mechanism: trace how the edit propagates through your code to that behaviour (50). Say where the change would first become visible, such as a test, a caller, user-facing output, or stored data (20).",
  levels: FULL_HALF_NONE,
  criteria: [
    {
      criterion: "Consequence. What behaviour changes as a result of the edit.",
      description: "",
      points: 30,
      descriptions: [
        "States a behaviour change that really follows from the edit in this code.",
        "States a change that only partly follows, or is vague, such as \"it might break things downstream\".",
        "States no change, or one that would not occur.",
      ],
    },
    {
      criterion: "Mechanism through this code. How the edit propagates from the changed line to the consequence.",
      description: "",
      points: 50,
      descriptions: [
        "Traces the path from the edited line to the effect through named parts of this code, such as callers, state, data flow, or ordering.",
        "Points at the right area but skips a step, or explains only in general language-level terms.",
        "Gives no mechanism, or one that does not match how this code works.",
      ],
    },
    {
      criterion: "Where it surfaces. Where the change would first become observable.",
      description: "",
      points: 20,
      descriptions: [
        "Names a specific test, caller, output, or stored state where it shows, or argues correctly that nothing would catch it.",
        "Names a plausible place without tying it to this code.",
        "Names no place, or a wrong one.",
      ],
    },
  ],
  gradingNote: "Credit any consequence that genuinely follows from the code, even if it differs from the one this question's notes expect. If the answer lists several possible consequences, grade the one it develops furthest; wrong claims alongside it cap Consequence at Half. If the stated consequence would not occur in this code, Mechanism and Where it surfaces earn at most Half.",
};

const DESIGN_RATIONALE_RUBRIC: FixedRubric = {
  summary: "Explain what this choice achieves in your code (30). Connect that purpose to a concrete feature of this code, such as its data, its callers, its constraints, or how it is used (50). Explain what would go wrong with an obvious alternative, or without the choice (20). Be specific: a correct but general justification that could apply to any project will earn less credit.",
  levels: FULL_HALF_NONE,
  criteria: [
    {
      criterion: "Identifies what the choice achieves. States the problem the choice solves or the property it secures.",
      description: "",
      points: 30,
      descriptions: [
        "Names the specific purpose the choice serves in this code.",
        "Names a plausible purpose, but it is vague or only partly fits the choice.",
        "Names no purpose, or one that does not apply to this choice.",
      ],
    },
    {
      criterion: "Links it to this code. Connects the purpose to a concrete feature of this code's data, callers, constraints, or use.",
      description: "",
      points: 50,
      descriptions: [
        "Ties the purpose to a named feature of this code and explains why that feature makes the choice appropriate.",
        "Mentions a feature of the code, but the link to the choice is asserted rather than explained.",
        "Gives only a textbook justification that never touches this code.",
      ],
    },
    {
      criterion: "Explains what the alternative would cost. Says what would go wrong with an obvious alternative, or without the choice.",
      description: "",
      points: 20,
      descriptions: [
        "States a specific consequence of the alternative for this code.",
        "States a generic downside of the alternative.",
        "Gives no alternative or consequence.",
      ],
    },
  ],
  gradingNote: "",
};

const FAILURE_CONDITIONS_RUBRIC: FixedRubric = {
  summary: "Name one realistic input, environment, or usage pattern your code was not designed for (30). Explain how that condition leads to failure through how your code is built (50). Say what would be observed: the crash, wrong output, corruption, or slowdown, and where (20). Do not use an issue the repository already flags.",
  levels: FULL_HALF_NONE,
  criteria: [
    {
      criterion: "Realistic, code-specific condition. A condition plausible in actual use and specific to this code's assumptions.",
      description: "",
      points: 30,
      descriptions: [
        "A condition plausible in actual use, specific to this code, and not one the repository already flags.",
        "A plausible but generic condition, such as \"malformed input\" or \"lots of users\", or a contrived one the code's callers could never produce.",
        "An implausible condition, none at all, or one the repository already flags.",
      ],
    },
    {
      criterion: "Mechanism through this code. How the condition leads to failure.",
      description: "",
      points: 50,
      descriptions: [
        "Names the specific unchecked assumption, race, unbounded growth, or missing case, and the path from the condition to the failure.",
        "Identifies the right component, but the mechanism is generic or skips a step.",
        "Gives no mechanism, or one that does not match the code.",
      ],
    },
    {
      criterion: "Observable symptom. What would be seen, and where.",
      description: "",
      points: 20,
      descriptions: [
        "States a specific symptom and where it appears.",
        "States a vague symptom, such as \"it would break\".",
        "States no symptom, or one that does not follow from the mechanism.",
      ],
    },
  ],
  gradingNote: "If the condition is one the repository already flags (a TODO, FIXME, known-issues note, skipped test, or README limitation), award no points for the mechanism or the symptom either, so the whole answer scores 0. Credit any genuine failure condition, not only the one this question's notes anticipate.",
};

/** Applied to every free-response grading request of the default code template. */
export const DEFAULT_CODE_GRADING_INSTRUCTIONS = `- **Content only:** no points for fluency, length, hedging, confidence, command of English, or restating the question.
- **Any valid wording:** accept references to code by name, by paraphrase, or as a short snippet. Exact identifiers, line numbers, and the code's own terms are not required.
- **Check against the code:** verify every technical claim against the submitted code. Credit what is true of the code even where it differs from the question's notes or sample answers, and give no credit for claims the code contradicts.
- **This code, not code in general:** give no credit for general programming knowledge that is not connected to this code.
- **Minimum is enough:** full credit means the minimum sufficient answer. Extra examples, alternatives, or fixes are never required unless the question asks for them.
- **Implied steps count:** credit a step that the answer clearly entails, even if it is not stated separately, but do not infer reasoning the answer does not support.`;

export function createDefaultCodeBlocks(): QuestionBlockConfig[] {
  return [
    {
      id: "code-execution-tracing",
      type: "multiple_choice",
      name: "Execution tracing",
      count: 2,
      candidatePoolSize: 6,
      optionsPerQuestion: 4,
      warmup: false,
      prompt: EXECUTION_TRACING_PROMPT,
    },
    {
      id: "code-flow-reconstruction",
      type: "fill_blank",
      name: "Flow reconstruction",
      count: 2,
      candidatePoolSize: 6,
      distractorsPerBlank: 2,
      warmup: false,
      prompt: FLOW_RECONSTRUCTION_PROMPT,
    },
    {
      id: "code-change-impact",
      type: "free_response",
      name: "Change impact",
      count: 2,
      candidatePoolSize: 6,
      warmup: false,
      prompt: CHANGE_IMPACT_PROMPT,
      rubricPrompt: "",
      fixedRubric: CHANGE_IMPACT_RUBRIC,
    },
    {
      id: "code-design-rationale",
      type: "free_response",
      name: "Unstated design rationale",
      count: 2,
      candidatePoolSize: 6,
      warmup: false,
      prompt: DESIGN_RATIONALE_PROMPT,
      rubricPrompt: "",
      fixedRubric: DESIGN_RATIONALE_RUBRIC,
    },
    {
      id: "code-failure-conditions",
      type: "free_response",
      name: "Failure conditions",
      count: 2,
      candidatePoolSize: 6,
      warmup: false,
      prompt: FAILURE_CONDITIONS_PROMPT,
      rubricPrompt: "",
      fixedRubric: FAILURE_CONDITIONS_RUBRIC,
    },
  ];
}
