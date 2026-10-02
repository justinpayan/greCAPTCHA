/**
 * How a printed question set is divided into pages.
 *
 * Multiple-choice questions are short and need no writing space, so a run of them flows across as
 * many pages as it needs, several to a page. Questions answered by hand get a fixed share of a
 * page instead: a free response shares its page with at most one other, the spare height becoming
 * writing space; a fill-in-the-blank question, with its word bank and a line per blank, has a page
 * to itself. A page holds one kind of question only, so those limits hold on every page.
 */

export type PrintPage<T> = {
  /** `flow`: multiple choice, as many per page as fit. `paired`: a fixed number, with answer space. */
  kind: "flow" | "paired";
  /** The question type the page holds. */
  type: string;
  items: T[];
};

/** The most questions of each hand-answered type on one page. */
export const WRITTEN_QUESTIONS_PER_PAGE: Record<string, number> = {
  fill_blank: 1,
  free_response: 2,
};
const DEFAULT_WRITTEN_PER_PAGE = 1;

export function paginateForPrint<T extends { type: string }>(items: T[]): PrintPage<T>[] {
  const pages: PrintPage<T>[] = [];
  for (const item of items) {
    const kind = item.type === "multiple_choice" ? "flow" : "paired";
    const capacity = WRITTEN_QUESTIONS_PER_PAGE[item.type] ?? DEFAULT_WRITTEN_PER_PAGE;
    const current = pages.at(-1);
    const fits =
      current?.type === item.type && (kind === "flow" || current.items.length < capacity);
    if (current && fits) current.items.push(item);
    else pages.push({ kind, type: item.type, items: [item] });
  }
  return pages;
}
