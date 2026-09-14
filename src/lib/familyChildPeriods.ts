export type ChildPeriodDraft = {
  fullName: string
  classroomId: string
  /** ISO yyyy-mm-dd, or '' when not picked. */
  startDate: string
}

/**
 * Tambah Keluarga: every named child must arrive with a first learning period, so both its class
 * and its start date are required. Blank cards are ignored — they're dropped on save anyway.
 * Returns the message for the first problem found, naming the child, or null when all is well.
 */
export function findChildPeriodError(children: ChildPeriodDraft[]): string | null {
  for (const child of children) {
    const name = child.fullName.trim()
    if (!name) continue
    if (!child.classroomId) return `Pilih kelas periode belajar untuk ${name}.`
    if (!child.startDate) return `Isi tanggal mulai periode belajar untuk ${name}.`
  }
  return null
}
