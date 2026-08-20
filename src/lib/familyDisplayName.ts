/**
 * Families aren't identified by a "family name" (surname) the way Western households commonly
 * are — Indonesian families are referred to by a parent's own name instead. Everywhere a family
 * needs a human-readable label (lists, dropdowns, headers, credentials messages), it's derived
 * from father_name, falling back to mother_name.
 */
export function familyDisplayName(family: { father_name: string | null; mother_name: string | null }): string {
  return family.father_name?.trim() || family.mother_name?.trim() || '—'
}
