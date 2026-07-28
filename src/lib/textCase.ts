/** Capitalizes the first letter of every word in place; leaves whitespace, digits, and punctuation untouched. */
export function toTitleCase(value: string): string {
  return value.replace(/\p{L}[\p{L}'-]*/gu, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
}
