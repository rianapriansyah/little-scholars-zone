/**
 * The parent registration wizard's state, and every rule about when a step is complete.
 *
 * Pure on purpose: the wizard is five screens over one object, and the interesting part is
 * which combinations are allowed to advance. Keeping that here means it can be tested without
 * rendering anything or mocking Supabase.
 *
 * These limits are the client-side half of a pair — submit-registration re-checks all of them
 * under the service role, because this file runs on a stranger's machine. Change one, change
 * both.
 */

export const MAX_CHILDREN = 10
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024
export const ALLOWED_RECEIPT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
] as const

/** Minimum digits in a phone number: 08xx numbers are 10-13, this is a floor, not a format. */
const MIN_PHONE_DIGITS = 8

export type DraftChild = {
  /** React list key. Stable across re-orders, never sent to the server. */
  key: string
  fullName: string
  birthPlace: string
  /** ISO yyyy-mm-dd, or null when not filled in. */
  birthdate: string | null
  notes: string
  classroomId: string
}

export type RegistrationDraft = {
  familyName: string
  contactPhone: string
  fatherName: string
  fatherOccupation: string
  fatherPhone: string
  motherName: string
  motherOccupation: string
  motherPhone: string
  address: string
  paymentNote: string
  children: DraftChild[]
}

/** One row of list_active_programs(). A classroom IS the billable program. */
export type ProgramOption = {
  id: string
  label: string
  timeStart: string
  timeEnd: string
  price: number
  guaranteedDays: number
}

/** Only the parts of a File the rules care about — so tests need no File object. */
export type ReceiptMeta = {
  name: string
  size: number
  type: string
}

export const REGISTRATION_STEPS = [
  'Data Orang Tua',
  'Data Anak',
  'Pilih Program',
  'Bukti Pembayaran',
  'Tinjau & Kirim',
] as const

export function emptyChild(key: string): DraftChild {
  return { key, fullName: '', birthPlace: '', birthdate: null, notes: '', classroomId: '' }
}

export function emptyDraft(firstChildKey: string): RegistrationDraft {
  return {
    familyName: '',
    contactPhone: '',
    fatherName: '',
    fatherOccupation: '',
    fatherPhone: '',
    motherName: '',
    motherOccupation: '',
    motherPhone: '',
    address: '',
    paymentNote: '',
    children: [emptyChild(firstChildKey)],
  }
}

export function phoneDigits(value: string): string {
  return value.replace(/\D/g, '')
}

/**
 * Step 1. Name and phone only — no email field anywhere in this wizard: the sole email in the
 * flow is the ...@lsz.id login, generated at approval and sent over WhatsApp.
 */
export function validateParentsStep(draft: RegistrationDraft): string | null {
  if (!draft.familyName.trim()) return 'Masukkan nama keluarga.'
  if (phoneDigits(draft.contactPhone).length < MIN_PHONE_DIGITS) {
    return 'Masukkan nomor telepon kontak yang valid — info login dikirim ke nomor ini.'
  }
  return null
}

/** Step 2. A birthdate is optional, but a nonsense one is not. */
export function validateChildrenStep(draft: RegistrationDraft, today: string): string | null {
  if (draft.children.length === 0) return 'Tambahkan minimal satu anak.'
  if (draft.children.length > MAX_CHILDREN) return `Maksimal ${MAX_CHILDREN} anak per pendaftaran.`

  for (const [index, child] of draft.children.entries()) {
    if (!child.fullName.trim()) return `Masukkan nama lengkap anak ke-${index + 1}.`
    if (child.birthdate !== null && child.birthdate > today) {
      return `Tanggal lahir anak ke-${index + 1} tidak boleh di masa depan.`
    }
  }
  return null
}

/** Step 3. Every child needs a program, and it has to be one still on offer. */
export function validateProgramsStep(
  draft: RegistrationDraft,
  programs: ProgramOption[],
): string | null {
  const available = new Set(programs.map((program) => program.id))
  for (const [index, child] of draft.children.entries()) {
    if (!child.classroomId) {
      return `Pilih program untuk ${child.fullName.trim() || `anak ke-${index + 1}`}.`
    }
    if (!available.has(child.classroomId)) {
      return `Program untuk ${child.fullName.trim() || `anak ke-${index + 1}`} sudah tidak tersedia. Muat ulang halaman.`
    }
  }
  return null
}

/** Step 4. */
export function validatePaymentStep(receipt: ReceiptMeta | null): string | null {
  if (!receipt) return 'Unggah bukti pembayaran.'
  if (!(ALLOWED_RECEIPT_TYPES as readonly string[]).includes(receipt.type)) {
    return 'Format bukti pembayaran harus JPG, PNG, WEBP, HEIC, atau PDF.'
  }
  if (receipt.size <= 0) return 'Berkas bukti pembayaran kosong.'
  if (receipt.size > MAX_RECEIPT_BYTES) return 'Ukuran bukti pembayaran maksimal 5 MB.'
  return null
}

/**
 * What the parent is told they owe. The server recomputes this from classrooms.price and
 * stores its own answer — this one is display only, so a stale price list cannot become the
 * amount on record.
 */
export function registrationTotal(draft: RegistrationDraft, programs: ProgramOption[]): number {
  const priceById = new Map(programs.map((program) => [program.id, program.price]))
  return draft.children.reduce((sum, child) => sum + (priceById.get(child.classroomId) ?? 0), 0)
}

/** Validation for one step, by index into REGISTRATION_STEPS. */
export function validateStep(
  step: number,
  draft: RegistrationDraft,
  programs: ProgramOption[],
  receipt: ReceiptMeta | null,
  today: string,
): string | null {
  switch (step) {
    case 0:
      return validateParentsStep(draft)
    case 1:
      return validateChildrenStep(draft, today)
    case 2:
      return validateProgramsStep(draft, programs)
    case 3:
      return validatePaymentStep(receipt)
    case 4:
      return (
        validateParentsStep(draft) ??
        validateChildrenStep(draft, today) ??
        validateProgramsStep(draft, programs) ??
        validatePaymentStep(receipt)
      )
    default:
      return null
  }
}

export type SubmitPayload = {
  familyName: string
  contactPhone: string
  fatherName: string | null
  fatherOccupation: string | null
  fatherPhone: string | null
  motherName: string | null
  motherOccupation: string | null
  motherPhone: string | null
  address: string | null
  paymentNote: string | null
  children: {
    fullName: string
    birthPlace: string | null
    birthdate: string | null
    notes: string | null
    classroomId: string
  }[]
}

function orNull(value: string): string | null {
  return value.trim() || null
}

/** Draft → request body. Prices are deliberately absent: the server sets them. */
export function toSubmitPayload(draft: RegistrationDraft): SubmitPayload {
  return {
    familyName: draft.familyName.trim(),
    contactPhone: draft.contactPhone.trim(),
    fatherName: orNull(draft.fatherName),
    fatherOccupation: orNull(draft.fatherOccupation),
    fatherPhone: orNull(draft.fatherPhone),
    motherName: orNull(draft.motherName),
    motherOccupation: orNull(draft.motherOccupation),
    motherPhone: orNull(draft.motherPhone),
    address: orNull(draft.address),
    paymentNote: orNull(draft.paymentNote),
    children: draft.children.map((child) => ({
      fullName: child.fullName.trim(),
      birthPlace: orNull(child.birthPlace),
      birthdate: child.birthdate,
      notes: orNull(child.notes),
      classroomId: child.classroomId,
    })),
  }
}
