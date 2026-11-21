type QuestionPdfDownload =
  | { format: "zip"; ids: string[] }
  | { format: "pdf"; ids: [string]; withKey: boolean };

export async function downloadQuestionPdfs(selection: QuestionPdfDownload) {
  const response = await fetch("/api/export/questions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(selection),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? "Unable to prepare the question PDFs.");
  }

  const encodedFilename = response.headers
    .get("Content-Disposition")
    ?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (!encodedFilename) throw new Error("Unable to prepare the question PDFs.");

  const filename = decodeURIComponent(encodedFilename);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Let the browser take ownership of the download before releasing the object URL.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
