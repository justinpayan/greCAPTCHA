import Image from "next/image";
import Link from "next/link";

import { Brand } from "@/components/brand";

const PAPER_URL = "https://arxiv.org/abs/2609.20481";
const CODE_URL = "https://github.com/justinpayan/greCAPTCHA";

// The four stages of Figure 1 / Section 3.1 of the paper.
const STAGES = [
  {
    name: "Submission",
    text: "The examinee submits their manuscript and a statement describing their specific contributions.",
  },
  {
    name: "Generation",
    text: "The system parses the manuscript and generates questions and grading rubrics, guided by the contribution statement and the administrator's configuration.",
  },
  {
    name: "Examination",
    text: "The examinee answers the questions under proctored conditions: in a testing center, at a conference, or through a certified at-home exam.",
  },
  {
    name: "Reporting",
    text: "Responses are graded against the rubrics. The report gives overall and per-question scores, the responses, how they matched the rubric, any partial credit, and feedback.",
  },
];

// Table 2 of the paper; examples are quoted verbatim.
const FAMILIES = [
  {
    name: "Planted-error detection",
    format: "Multiple choice",
    text: "Identify which version of a specific, verifiable claim accurately reflects the manuscript.",
    example:
      "In validating the three-item ethical-concern scales, which construct had a Cronbach's α of 0.82? A) Autonomy; B) Privacy; C) Fairness; D) Transparency.",
  },
  {
    name: "Unstated rationale",
    format: "Free response",
    text: "Explain why a methodological or design choice is appropriate, where the reason for that choice is not explicitly stated in the paper.",
    example:
      "Table 1 places both sensing-not-in-use scenarios before all four sensing-in-use scenarios, while randomising only within those blocks. What supports this fixed ordering rather than randomising all six scenarios, and what interpretive cost does that choice create?",
  },
  {
    name: "Background knowledge",
    format: "Free response",
    text: "Define an important concept that the manuscript presupposes but does not define, and explain why that concept matters for understanding the reported work.",
    example:
      "In your own words, explain the Mann–Whitney rank-sum procedure, including what it tests and the observation-level assumption it ordinarily makes. Then explain why this procedure matters for the condition comparisons reported.",
  },
  {
    name: "Failure mode",
    format: "Free response",
    text: "Name a realistic, manuscript-specific condition under which the proposed method or central finding would degrade, and explain the mechanism producing that degradation.",
    example:
      "Name one realistic learning condition for which the reported preference for system-generated hints over teacher assistance might weaken or reverse, and explain why.",
  },
];

const CITATION = `@misc{payan2026grecaptcha,
  title         = {{greCAPTCHA}: Assessing Understanding as Evidence of Research Authorship Under Generative {AI}},
  author        = {Payan, Justin and Gyevn{\\'a}r, B{\\'a}lint and Kasirzadeh, Atoosa and Shah, Nihar B.},
  year          = {2026},
  eprint        = {2609.20481},
  archivePrefix = {arXiv},
  primaryClass  = {cs.DL},
  url           = {https://arxiv.org/abs/2609.20481},
  note          = {Justin Payan and B{\\'a}lint Gyevn{\\'a}r contributed equally.}
}`;

// Off-site links open in a new tab so visitors keep their place on this page.
function ExternalLink(props: React.ComponentProps<"a">) {
  return <a {...props} target="_blank" rel="noopener noreferrer" />;
}

function TryIt({ large = false }: { large?: boolean }) {
  return (
    <Link className={`primary button-link landing-try${large ? " landing-try-large" : ""}`} href="/signup">
      Try it
    </Link>
  );
}

export function LandingPage() {
  return (
    <>
      <div className="landing-screen">
        <div className="landing-screen-inner">
          <header className="landing-header">
            <div className="landing-brand">
              <Brand />
              <span className="landing-badge">Public demo</span>
            </div>
            <nav className="landing-nav" aria-label="Site">
              <ExternalLink href={PAPER_URL}>Paper</ExternalLink>
              <ExternalLink href={CODE_URL}>Code &amp; data</ExternalLink>
              <Link href="/login">Sign in</Link>
              <TryIt />
            </nav>
          </header>

          <section className="landing-hero">
            <h1>Assessing understanding as evidence of research authorship.</h1>
            <p className="lede">
              greCAPTCHA is envisioned as a proctored assessment that measures how well authors
              understand their own research manuscripts. It generates questions tailored to a
              manuscript and to each author&apos;s stated contributions, then produces an evaluative
              report based on their answers.
            </p>
            <div className="landing-actions">
              <TryIt large />
              <ExternalLink className="secondary button-link" href={PAPER_URL}>
                Read the paper
              </ExternalLink>
            </div>
            <p className="landing-note">
              Free account. Generating questions requires an{" "}
              <ExternalLink href="https://openrouter.ai/">OpenRouter</ExternalLink> API key.
            </p>
          </section>
        </div>
        <a className="landing-scroll" href="#overview" aria-label="Scroll to read more">
          ↓
        </a>
      </div>

      <main className="app-shell landing">
        <figure className="landing-figure" id="overview">
          <div className="landing-figure-scroll">
            <Image
              src="/figures/workflow.png"
              alt="The greCAPTCHA process: submit a manuscript and contribution statement, generate an exam from the submission, take the exam at a proctored testing center, and generate a report based on rubrics. The report can then be used for peer review, job screening, admissions, or course projects."
              width={2325}
              height={567}
              sizes="(max-width: 720px) 720px, 1080px"
              priority
            />
          </div>
        </figure>

        <section className="landing-section" id="problem">
          <p className="eyebrow">The problem</p>
          <h2>Authorship no longer guarantees understanding</h2>
          <div className="landing-prose">
            <p>
              Conferences, journals, funders, schools, and universities are struggling with a surge of
              potentially AI-generated submissions from ostensibly human authors, who may not have
              exercised sufficient human oversight for their manuscripts. Institutions evaluating
              submissions can no longer reliably credit expertise based solely on authors&apos; names
              on submitted work.
            </p>
            <p>
              Generative AI has legitimate uses in research, including language assistance,
              accessibility, and exploring the literature. But responsibility for a paper&apos;s claims
              must remain with its human authors. Existing responses, such as restrictions on
              submissions, sanctions for policy violations, and detectors of machine-generated text, do
              not directly establish whether authors understand and can evaluate their contributions.
            </p>
          </div>
          <blockquote className="landing-quote">
            How can institutions assess whether the people submitting a manuscript understand their
            contributions well enough to evaluate and take responsibility for them?
          </blockquote>
        </section>

        <section className="landing-section">
          <p className="eyebrow">What it measures</p>
          <h2>Capacity to verify</h2>
          <div className="landing-prose">
            <p>
              greCAPTCHA measures <em>capacity to verify</em>: the knowledge and reasoning required to
              critically assess the claims, methods, and evidence underlying one&apos;s specific
              contributions to a manuscript. It has two dimensions:
            </p>
          </div>
          <div className="landing-grid landing-grid-2">
            <div className="card landing-card">
              <h3>Comprehension</h3>
              <p>Understanding the relevant content and its basis.</p>
            </div>
            <div className="card landing-card">
              <h3>Justification</h3>
              <p>Explaining and evaluating the choices underlying the work.</p>
            </div>
          </div>
          <div className="landing-prose">
            <p>
              This capacity is a prerequisite for verification. Demonstrating it does not establish
              that verification occurred or that the work is correct.
            </p>
            <p>
              The name borrows from the Graduate Record Examinations (GRE) used in university
              admissions, and alludes to CAPTCHAs, which tell human users apart from bots. Here the
              aim is to distinguish authors who present AI-generated research as their own with no
              human contribution or oversight from those who contributed to, or at least oversaw, the
              research.
            </p>
          </div>
        </section>

        <section className="landing-section">
          <p className="eyebrow">How it works</p>
          <h2>From manuscript to report</h2>
          <ol className="landing-stages">
            {STAGES.map((stage, index) => (
              <li className="card landing-card" key={stage.name}>
                <span className="landing-step">{index + 1}</span>
                <h3>{stage.name}</h3>
                <p>{stage.text}</p>
              </li>
            ))}
          </ol>
          <p className="landing-uses">
            The report can inform peer review, job screening, admissions, grant proposals, and
            course projects.
          </p>
        </section>

        <section className="landing-section">
          <p className="eyebrow">The questions</p>
          <h2>Four question families</h2>
          <div className="landing-prose">
            <p>
              Informed by the revised Bloom&apos;s taxonomy, the prototype asks about factual,
              conceptual, and procedural knowledge through tasks that ask examinees to identify errors,
              explain choices, demonstrate background understanding, and assess limitations. The
              examples below come from the study.
            </p>
          </div>
          <div className="landing-grid landing-grid-2">
            {FAMILIES.map((family) => (
              <article className="card landing-card" key={family.name}>
                <div className="landing-family-head">
                  <h3>{family.name}</h3>
                  <span className="landing-tag">{family.format}</span>
                </div>
                <p>{family.text}</p>
                <p className="landing-example">&ldquo;{family.example}&rdquo;</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section">
          <p className="eyebrow">Evaluation</p>
          <h2>What the study found</h2>
          <div className="landing-prose">
            <p>
              In a one-hour in-person session, 31 researchers answered eight questions (two per
              family, with 15 minutes per paper) about one of their own papers and about an unfamiliar
              paper chosen by the research team. The unfamiliar paper was either in or outside their
              field. A semi-structured interview followed.
            </p>
          </div>
          <div className="landing-grid landing-grid-2">
            <div className="card landing-card">
              <h3>Scores</h3>
              <div className="landing-paragraphs">
                <p>
                  <strong>High authorship separation.</strong> Scores separate own papers from
                  unfamiliar papers with an AUC of 0.90 (1.0 is perfect separation, 0.5 is chance).
                  Excluding the multiple-choice questions raises it to 0.934.
                </p>
                <p>
                  <strong>Multiple-choice questions are too easy.</strong> The multiple-choice family
                  barely separated the two (AUC 0.595): its answers can be found by searching the
                  manuscript, so it mostly measures attention.
                </p>
                <p>
                  <strong>No statistically detectable field effect.</strong> There was no
                  statistically significant difference between in-field and out-of-field unfamiliar
                  papers (p = 0.437), suggesting greCAPTCHA is more than a &ldquo;field
                  detector&rdquo;.
                </p>
              </div>
            </div>
            <div className="card landing-card">
              <h3>Participants&apos; views</h3>
              <div className="landing-paragraphs">
                <p>
                  <strong>Assesses capacity to verify.</strong> Most saw it as a valid way to assess
                  capacity to verify, and 12 noted it would be hard to prepare for without having
                  written the paper.
                </p>
                <p>
                  <strong>Effective questions target less consequential knowledge.</strong> Deep
                  questions about specific details gave the best evidence, more than questions about
                  overall motivation or significance.
                </p>
                <p>
                  <strong>Assessment can promote learning and preparation.</strong> Questions
                  prompted reflection and new insights; some suggested it as preparation for
                  presentations.
                </p>
                <p>
                  <strong>Grading requires careful calibration.</strong> The expected level of detail
                  should be clear, and equally correct alternative answers should get credit.
                </p>
                <p>
                  <strong>Support for deployment, but not agreement on its role.</strong> Most
                  supported deployment; human oversight and ways to contest results were broadly
                  requested.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-section">
          <p className="eyebrow">Limits</p>
          <h2>What a score does and does not show</h2>
          <ul className="landing-list landing-prose">
            <li>
              Responses may reflect manuscript-specific understanding, but also domain expertise,
              question ambiguity, assessment conditions, or grading errors. An expert non-author may
              answer correctly, while a contributing author may struggle with questions outside their
              role.
            </li>
            <li>
              A low score does not by itself show a lack of capacity to verify, and should not be used
              on its own to decide that a submission policy was violated.
            </li>
            <li>
              It cannot authenticate data or establish reproducibility. A knowledgeable author can
              still fabricate evidence.
            </li>
            <li>
              The prototype&apos;s best false-positive rate was around 20%, mainly because of rigid
              grading rubrics rather than question quality. Consequential use would need human
              oversight, accommodations, and meaningful ways to contest questions, grades, and
              decisions.
            </li>
          </ul>
        </section>

        <section className="card landing-cta">
          <div>
            <p className="eyebrow">Public demo</p>
            <h2>Try the prototype</h2>
            <p>
              This demo runs the prototype used in the study, without proctoring. It supports two
              workflows:
            </p>
            <ul className="landing-list">
              <li>
                <strong>Course.</strong> An instructor uploads a PDF, generates a question set, and
                shares a link. Students&apos; answers are graded automatically with the
                instructor&apos;s OpenRouter key.
              </li>
              <li>
                <strong>Conference.</strong> An organiser creates a reusable invitation. Each examinee
                uploads their own manuscript and contribution statement and uses their own OpenRouter
                key.
              </li>
            </ul>
          </div>
          <div className="landing-cta-actions">
            <TryIt large />
            <Link className="secondary button-link" href="/login">
              Sign in
            </Link>
          </div>
        </section>

        <section className="landing-section">
          <p className="eyebrow">Cite</p>
          <h2>Please cite our work</h2>
          <pre className="landing-cite">{CITATION}</pre>
        </section>

        <footer className="landing-footer">
          <ExternalLink href={PAPER_URL}>Paper (arXiv:2609.20481)</ExternalLink>
          <ExternalLink href={CODE_URL}>Code and anonymized study data</ExternalLink>
          <Link href="/login">Sign in</Link>
        </footer>
      </main>
    </>
  );
}
