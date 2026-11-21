import type { QuestionSetOverview } from "@/lib/quiz";

export const QUESTION_PDF_ZIP_NAME = "question-sets.zip";

type QuestionPdfSource = Pick<QuestionSetOverview, "paperName" | "materialKind">;

export function questionPdfSourceName({ paperName, materialKind }: QuestionPdfSource): string {
  return materialKind === "pdf" ? paperName.replace(/\.pdf$/i, "") : paperName;
}

export function questionPdfFilenames(
  sets: QuestionPdfSource[],
  withKey: boolean,
): string[] {
  const used = new Set<string>();
  const suffix = withKey ? "_answer_key.pdf" : "_questions.pdf";
  return sets.map((set) => {
    const source = questionPdfSourceName(set);
    const stem =
      source.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "_").trim().replace(/[. ]+$/, "") ||
      "question-set";
    let name = stem + suffix;
    let number = 2;
    while (used.has(name.normalize("NFC").toLowerCase())) {
      name = `${stem} (${number})${suffix}`;
      number += 1;
    }
    used.add(name.normalize("NFC").toLowerCase());
    return name;
  });
}
