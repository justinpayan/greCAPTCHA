import Link from "next/link";

import { Brand } from "@/components/brand";

const PAPER_URL = "https://arxiv.org/abs/2609.20481";
const CODE_URL = "https://github.com/justinpayan/greCAPTCHA";

const STAGES = [
  {
    name: "Structure your workflow",
    text: "Test creators can upload source material, or allow test takers to upload their own. Test creators can pay all API costs, or have test takers pay.",
  },
  {
    name: "Create question prompts",
    text: "Create prompts to generate personalized questions about source material.",
  },
  {
    name: "Share the link",
    text: "Share a public link with your test takers.",
  },
  {
    name: "Take the assessment",
    text: "Test takers upload their source material and provide an API key (if the test creator hasn't already), and take their personalized test.",
  },
  {
    name: "Review the report",
    text: "Test creators and takers both receive a graded report immediately upon test completion.",
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

// Signed-in visitors (who reach this page at /about) go straight to their dashboard instead.
function TryIt({ large = false, signedIn }: { large?: boolean; signedIn: boolean }) {
  return (
    <Link
      className={`primary button-link landing-try${large ? " landing-try-large" : ""}`}
      href={signedIn ? "/" : "/signup"}
    >
      Sign up
    </Link>
  );
}

export function LandingPage({ signedIn = false }: { signedIn?: boolean }) {
  const account = signedIn ? { href: "/", label: "Dashboard" } : { href: "/login", label: "Sign in" };
  return (
    <>
      <div className="landing-screen">
        <div className="landing-screen-inner">
          <header className="landing-header">
            <div className="landing-brand">
              <Brand />
            </div>
            <nav className="landing-nav" aria-label="Site">
              <ExternalLink href={PAPER_URL}>Paper</ExternalLink>
              <ExternalLink href={CODE_URL}>Code &amp; data</ExternalLink>
              <Link className="landing-account" href={account.href}>
                {account.label}
              </Link>
              <TryIt signedIn={signedIn} />
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
              <TryIt large signedIn={signedIn} />
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
        <section className="landing-section" id="overview">
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

            <p>
              As a proof of concept, greCAPTCHA co-author Nihar B. Shah, in his capacity as an Editor-in-Chief of the Transactions 
              on Machine Learning Research (TMLR), interviewed the authors of 10 papers submitted to TMLR and which were slated for desk rejection.
              He reported the results in a{" "}
              <a
                className="landing-inline-link"
                href="https://blog.tmlr.org/2026/asking-authors-about-their-own-papers/"
                target="_blank"
                rel="noopener noreferrer"
              >
                post on TMLR
              </a>.
              Only 1 of the 10 papers' authors was able to answer substantial questions about their own paper! 
              greCAPTCHA aims to scale these interviews, allowing anyone to reliably assess authors' understanding of their own work.
            </p>
          </div>
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
              This capacity is a prerequisite for verification, though it does not establish
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
          <h2>Create question prompts, then share a link with your test takers</h2>
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
              conceptual, and procedural knowledge through tasks that ask test takers to identify errors,
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
          <p className="landing-caption">
            You can also customize and create your own question families to best suit your needs.
          </p>
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

        <section className="card landing-cta">
          <div>
            <h2>Try the prototype</h2>
            <p>
              First choose your workflow. The test creator can upload source material or have test takers upload their own. The test creator can pay all API costs, or have test takers pay. Example use cases include:
            </p>
            <ul className="landing-list">
              <li>
                <strong>Conference or journal.</strong> The venue creates question prompts; authors upload their
                own manuscripts and pay with their own OpenRouter keys.
              </li>
              <li>
                <strong>Class assignment.</strong> The instructor uploads shared
                course material, and pays for generation and grading.
              </li>
              <li>
                <strong>Class project.</strong> Each student uploads their
                own project report as source material, but the instructor pays for generation and grading.
              </li>
            </ul>
            <p>
              You can use our default set of question prompts, or create your own.
            </p>
          </div>
          <div className="landing-cta-actions">
            <TryIt large signedIn={signedIn} />
            <Link className="secondary button-link" href={account.href}>
              {account.label}
            </Link>
          </div>
        </section>

        <section className="landing-section">
          <p className="eyebrow">Cite</p>
          <h2>The preferred bibtex citation for greCAPTCHA is:</h2>
          <pre className="landing-cite">{CITATION}</pre>
        </section>

        <footer className="landing-footer">
          <ExternalLink href={PAPER_URL}>Paper (arXiv:2609.20481)</ExternalLink>
          <ExternalLink href={CODE_URL}>Code and anonymized study data</ExternalLink>
          <Link className="landing-account" href={account.href}>
                {account.label}
              </Link>
        </footer>
      </main>
    </>
  );
}
