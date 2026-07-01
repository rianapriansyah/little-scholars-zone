/** Each whitespace-separated token must appear in `blobLower` (already lowercased). */
export function matchesSearchTokens(blobLower: string, raw: string): boolean {
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed) return true
  return trimmed.split(/\s+/).every((tok) => blobLower.includes(tok))
}
