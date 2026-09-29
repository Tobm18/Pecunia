const listFormatter = new Intl.ListFormat("fr", { style: "long", type: "conjunction" });

/** ["A", "B", "C"] → « A, B et C » ; ["A", "B"] → « A et B » ; ["A"] → « A ». */
export function formatList(items: string[]): string {
  return listFormatter.format(items);
}
