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

// Answers restate what the rest of this page says; keep them in sync when it changes.
const FAQS = [
  {
    question: "Who is greCAPTCHA for?",
    answer:
      "Anyone who needs evidence that people understand work submitted in their name. The report can inform peer review, job screening, admissions, grant proposals, and course projects. For example, a conference or journal can create question prompts and have authors take a test on their own manuscripts, or an instructor can test students on shared course material or on their own project reports.",
  },
  {
    question: "Who provides the source material?",
    answer:
      "Both the test creator or taker can. The test creator can upload source material that every test taker is asked about, such as course readings, or allow each test taker to upload their own, such as a manuscript or project report.",
  },
  {
    question: "What does it cost, and who pays?",
    answer:
      "Accounts are free. Generating and grading questions calls language models through OpenRouter, so it requires an OpenRouter API key. The test creator can pay all API costs with their own key, or have each test taker provide a key and pay for their own test.",
  },
  {
    question: "Do I have to write my own questions?",
    answer:
      "No. You can use the default set of question prompts, or customize them and create your own to suit your needs.",
  },
  {
    question: "When are results available?",
    answer:
      "Immediately. Both the test creator and the test taker receive a graded report as soon as the test is completed.",
  },
  {
    question: "Does a high score prove that the work is correct, or that no AI was used?",
    answer:
      "No. greCAPTCHA measures capacity to verify: the knowledge and reasoning needed to critically assess one's own contributions. That capacity is a prerequisite for verification, but it does not establish that verification occurred or that the work is correct.",
  },
  {
    question: "How well does it work?",
    answer:
      "In a study with 31 researchers, scores separated their own papers from unfamiliar papers with an AUC of 0.90 (0.934 without the multiple-choice questions, which proved too easy).",
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
        <div className="landing-topbar">
          <header className="landing-header">
            <div className="landing-brand">
              <Brand />
            </div>
            <nav className="landing-nav" aria-label="Site">
              <a href="#faq">FAQ</a>
              <ExternalLink href={PAPER_URL}>Paper</ExternalLink>
              <ExternalLink href={CODE_URL}>Code &amp; data</ExternalLink>
              <Link className="landing-account" href={account.href}>
                {account.label}
              </Link>
              <TryIt signedIn={signedIn} />
            </nav>
          </header>
        </div>
        <div className="landing-screen-inner">
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
          <h2>What is greCAPTCHA?</h2>
          <div className="landing-prose">
            <p>
              greCAPTCHA is an{" "}
              <a className="landing-inline-link" href="#evaluation">
                empirically-validated
              </a>{" "}
              and open-source platform to automatically create
              and evaluate assessments about claimed authors&apos; manuscripts. It supports four
              workflows depending who uploads the manuscript (the test creator or taker) and who pays
              for LLM inference costs. It is also highly customizable, supports the printing of
              question sets, and batch processing of multiple manuscripts.
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
          <h2>Why use greCAPTCHA?</h2>
          <div className="landing-prose">
            <p>
              Conferences, journals, funders, schools, and universities are struggling with a surge of
              potentially AI-generated submissions from ostensibly human authors, who may not have
              exercised sufficient human oversight for their manuscripts. Institutions evaluating
              submissions can no longer reliably credit expertise based solely on authors&apos; names
              on submitted work.
            </p>
            <p>
              greCAPTCHA was empirically validated with 31 academic participants. It measures the{" "}
              <em>capacity to verify</em>: the knowledge and reasoning required to critically assess
              the claims, methods, and evidence underlying one&apos;s specific contributions to a
              manuscript. It has two dimensions:
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
              The name borrows from the Graduate Record Examinations (GRE) used in university
              admissions, and alludes to CAPTCHAs, which tell human users apart from bots. Here the
              aim is to distinguish authors who present AI-generated research as their own with no
              human contribution or oversight from those who contributed to, or at least oversaw, the
              research.
            </p>
          </div>
        </section>

        <section className="landing-section">
          <h2>How does greCAPTCHA work?</h2>
          <ol className="landing-stages">
            {STAGES.map((stage, index) => (
              <li className="card landing-card" key={stage.name}>
                <span className="landing-step">{index + 1}</span>
                <h3>{stage.name}</h3>
                <p>{stage.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="landing-section" id="evaluation">
          <h2>How was greCAPTCHA evaluated?</h2>
          <div className="landing-prose">
            <p>
              In a one-hour in-person session, 31 researchers answered eight questions (15 minutes
              per paper) about one of their own papers and about an unfamiliar
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
                  <strong>Multiple-choice questions are too easy.</strong> The multiple-choice questions
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

        <section className="landing-section" id="faq">
          <h2>Frequently asked questions</h2>
          <div className="landing-faq">
            {FAQS.map((faq) => (
              <details className="card landing-card" key={faq.question}>
                <summary>{faq.question}</summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="landing-section">
          <h2>Bibtex citation</h2>
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
