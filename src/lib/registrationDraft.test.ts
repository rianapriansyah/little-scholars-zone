import { describe, expect, it } from 'vitest'
import {
  emptyChild,
  emptyDraft,
  mandatoryFeeTotal,
  registrationTotal,
  toSubmitPayload,
  validateChildrenStep,
  validatePaymentStep,
  validateParentsStep,
  validateProgramsStep,
  validateStep,
  type FeeItemOption,
  type ProgramOption,
  type RegistrationDraft,
} from './registrationDraft'

const TODAY = '2026-08-10'

const PROGRAMS: ProgramOption[] = [
  { id: 'kelas-a', label: 'Kelas A', timeStart: '08:00', timeEnd: '10:00', price: 500000, guaranteedDays: 20 },
  { id: 'kelas-b', label: 'Kelas B', timeStart: '10:00', timeEnd: '12:00', price: 750000, guaranteedDays: 24 },
]

const FEE_ITEMS: FeeItemOption[] = [
  { id: 'seragam', label: 'Seragam', price: 450000, items: ['1 tas'], sortOrder: 1 },
  { id: 'alat-tulis', label: 'Alat Tulis', price: 250000, items: ['Buku gambar 4 pcs'], sortOrder: 2 },
]

function draftWith(overrides: Partial<RegistrationDraft> = {}): RegistrationDraft {
  return {
    ...emptyDraft('k1'),
    familyName: 'Rian Apriansyah',
    contactPhone: '081234567890',
    ...overrides,
  }
}

function childWith(overrides: Partial<ReturnType<typeof emptyChild>> = {}) {
  return { ...emptyChild('k1'), fullName: 'Budi', classroomId: 'kelas-a', ...overrides }
}

describe('validateParentsStep', () => {
  it('accepts a name and a plausible phone number', () => {
    expect(validateParentsStep(draftWith())).toBeNull()
  })

  it('rejects a blank family name', () => {
    expect(validateParentsStep(draftWith({ familyName: '   ' }))).toMatch(/nama keluarga/i)
  })

  it('rejects a phone number too short to be real, not just an empty one', () => {
    expect(validateParentsStep(draftWith({ contactPhone: '0812' }))).toMatch(/telepon/i)
  })

  it('ignores formatting characters when counting phone digits', () => {
    expect(validateParentsStep(draftWith({ contactPhone: '+62 812-3456-7890' }))).toBeNull()
  })
})

describe('validateChildrenStep', () => {
  it('accepts a named child', () => {
    expect(validateChildrenStep(draftWith({ children: [childWith()] }), TODAY)).toBeNull()
  })

  it('rejects an empty child list', () => {
    expect(validateChildrenStep(draftWith({ children: [] }), TODAY)).toMatch(/minimal satu anak/i)
  })

  it('names which child is missing a name, so the message is actionable', () => {
    const draft = draftWith({ children: [childWith(), childWith({ key: 'k2', fullName: '' })] })
    expect(validateChildrenStep(draft, TODAY)).toMatch(/anak ke-2/i)
  })

  it('allows a missing birthdate — it is optional on the admin form too', () => {
    const draft = draftWith({ children: [childWith({ birthdate: null })] })
    expect(validateChildrenStep(draft, TODAY)).toBeNull()
  })

  it('rejects a birthdate in the future', () => {
    const draft = draftWith({ children: [childWith({ birthdate: '2026-08-11' })] })
    expect(validateChildrenStep(draft, TODAY)).toMatch(/masa depan/i)
  })

  it('accepts a birthdate of today', () => {
    const draft = draftWith({ children: [childWith({ birthdate: TODAY })] })
    expect(validateChildrenStep(draft, TODAY)).toBeNull()
  })
})

describe('validateProgramsStep', () => {
  it('accepts one program per child', () => {
    const draft = draftWith({ children: [childWith(), childWith({ key: 'k2', classroomId: 'kelas-b' })] })
    expect(validateProgramsStep(draft, PROGRAMS)).toBeNull()
  })

  it('rejects a child with no program chosen', () => {
    const draft = draftWith({ children: [childWith({ classroomId: '' })] })
    expect(validateProgramsStep(draft, PROGRAMS)).toMatch(/Budi/)
  })

  it('rejects a program that has since been deactivated', () => {
    const draft = draftWith({ children: [childWith({ classroomId: 'kelas-lama' })] })
    expect(validateProgramsStep(draft, PROGRAMS)).toMatch(/tidak tersedia/i)
  })
})

describe('validatePaymentStep', () => {
  it('accepts a normal JPEG receipt', () => {
    expect(validatePaymentStep({ name: 'bukti.jpg', size: 200_000, type: 'image/jpeg' })).toBeNull()
  })

  it('accepts a PDF receipt', () => {
    expect(validatePaymentStep({ name: 'bukti.pdf', size: 200_000, type: 'application/pdf' })).toBeNull()
  })

  it('requires a file at all', () => {
    expect(validatePaymentStep(null)).toMatch(/unggah/i)
  })

  it('rejects an unsupported type', () => {
    expect(validatePaymentStep({ name: 'bukti.docx', size: 1000, type: 'application/msword' })).toMatch(/format/i)
  })

  it('rejects a file over 5 MB', () => {
    expect(validatePaymentStep({ name: 'bukti.jpg', size: 6 * 1024 * 1024, type: 'image/jpeg' })).toMatch(/5 MB/)
  })

  it('rejects a zero-byte file', () => {
    expect(validatePaymentStep({ name: 'bukti.jpg', size: 0, type: 'image/jpeg' })).toMatch(/kosong/i)
  })
})

describe('mandatoryFeeTotal', () => {
  it('sums every active fee item — the per-child equipment kit cost', () => {
    expect(mandatoryFeeTotal(FEE_ITEMS)).toBe(700_000)
  })

  it('is zero when there are no fee items', () => {
    expect(mandatoryFeeTotal([])).toBe(0)
  })
})

describe('registrationTotal', () => {
  it('sums the chosen program price per child, with no fee items', () => {
    const draft = draftWith({ children: [childWith(), childWith({ key: 'k2', classroomId: 'kelas-b' })] })
    expect(registrationTotal(draft.children, PROGRAMS, [])).toBe(1_250_000)
  })

  it('counts the same program twice for two siblings', () => {
    const draft = draftWith({ children: [childWith(), childWith({ key: 'k2' })] })
    expect(registrationTotal(draft.children, PROGRAMS, [])).toBe(1_000_000)
  })

  it('treats an unchosen or unknown program as zero rather than NaN', () => {
    const draft = draftWith({ children: [childWith({ classroomId: '' })] })
    expect(registrationTotal(draft.children, PROGRAMS, [])).toBe(0)
  })

  it('adds the mandatory equipment fee once per child, on top of their program', () => {
    const draft = draftWith({ children: [childWith()] })
    // 500,000 (Kelas A) + 700,000 (Seragam + Alat Tulis)
    expect(registrationTotal(draft.children, PROGRAMS, FEE_ITEMS)).toBe(1_200_000)
  })

  it('charges the equipment fee per sibling, not once per family', () => {
    const draft = draftWith({ children: [childWith(), childWith({ key: 'k2' })] })
    // 2 x (500,000 + 700,000)
    expect(registrationTotal(draft.children, PROGRAMS, FEE_ITEMS)).toBe(2_400_000)
  })

  it('still charges the equipment fee even for a child with no program chosen yet', () => {
    const draft = draftWith({ children: [childWith({ classroomId: '' })] })
    expect(registrationTotal(draft.children, PROGRAMS, FEE_ITEMS)).toBe(700_000)
  })
})

describe('validateStep', () => {
  const complete = draftWith({ children: [childWith()] })
  const receipt = { name: 'bukti.jpg', size: 1000, type: 'image/jpeg' }

  it('gates each step on its own rules', () => {
    expect(validateStep(0, complete, PROGRAMS, null, TODAY)).toBeNull()
    // Step 1 does not care that no receipt has been uploaded yet.
    expect(validateStep(1, complete, PROGRAMS, null, TODAY)).toBeNull()
    expect(validateStep(3, complete, PROGRAMS, null, TODAY)).toMatch(/unggah/i)
  })

  it('re-checks every earlier step on the review step', () => {
    const missingPhone = draftWith({ children: [childWith()], contactPhone: '' })
    expect(validateStep(4, missingPhone, PROGRAMS, receipt, TODAY)).toMatch(/telepon/i)
    expect(validateStep(4, complete, PROGRAMS, receipt, TODAY)).toBeNull()
  })
})

describe('toSubmitPayload', () => {
  it('trims text and drops blank optionals to null', () => {
    const draft = draftWith({
      familyName: '  Keluarga Rian  ',
      fatherName: '  Rian  ',
      motherName: '   ',
      children: [childWith({ fullName: '  Budi  ', birthPlace: '', notes: '  ramah  ' })],
    })
    const payload = toSubmitPayload(draft)

    expect(payload.familyName).toBe('Keluarga Rian')
    expect(payload.fatherName).toBe('Rian')
    expect(payload.motherName).toBeNull()
    expect(payload.children[0]).toEqual({
      fullName: 'Budi',
      birthPlace: null,
      birthdate: null,
      notes: 'ramah',
      classroomId: 'kelas-a',
    })
  })

  it('sends no prices — the server decides what this costs', () => {
    const payload = toSubmitPayload(draftWith({ children: [childWith()] }))
    expect(JSON.stringify(payload)).not.toContain('price')
  })

  it('drops the React list key', () => {
    const payload = toSubmitPayload(draftWith({ children: [childWith()] }))
    expect(payload.children[0]).not.toHaveProperty('key')
  })
})
