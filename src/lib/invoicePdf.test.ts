import { describe, expect, it } from 'vitest'
import { buildInvoiceMessage, type InvoiceData } from './invoicePdf'

const base: InvoiceData = {
  familyName: 'Keluarga Test',
  childName: 'Budi',
  classroomLabel: 'TK A',
  periodNo: 2,
  startDate: '2026-08-12',
  amount: 350000,
  dueDate: null,
}

describe('buildInvoiceMessage', () => {
  it('includes the family, child, program, period and amount', () => {
    const message = buildInvoiceMessage(base)
    expect(message).toContain('Keluarga Test')
    expect(message).toContain('Budi')
    expect(message).toContain('TK A')
    expect(message).toContain('#2')
    expect(message).toContain('Rp 350.000')
  })

  it('omits the due date line when there is none', () => {
    expect(buildInvoiceMessage(base)).not.toContain('Jatuh Tempo')
  })

  it('includes the due date line when set', () => {
    const message = buildInvoiceMessage({ ...base, dueDate: '2026-08-20' })
    expect(message).toContain('Jatuh Tempo: 2026-08-20')
  })

  it('includes the bank transfer details', () => {
    const message = buildInvoiceMessage(base)
    expect(message).toContain('Bank: Mandiri')
    expect(message).toContain('1330030611560')
  })
})
