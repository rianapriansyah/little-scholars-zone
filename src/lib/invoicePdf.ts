import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { formatIdr } from './formatIdr'
import { BANK_ACCOUNT_LINES } from './paymentInstructions'

/** Matches the app's identity everywhere else — index.html's title and every PortalLayout header. */
const BUSINESS_NAME = 'Little Schoolars Zone'
const MARGIN_LEFT = 14

export type InvoiceData = {
  familyName: string
  childName: string
  classroomLabel: string
  periodNo: number
  startDate: string
  amount: number
  dueDate: string | null
}

/**
 * Builds the invoice PDF and triggers a browser download. Deliberately does not touch
 * payment_periods — sending an invoice is a client-side action only, nothing is stamped
 * server-side (see 20260812010000_payment_periods.sql).
 */
export function generateInvoicePdf(data: InvoiceData): void {
  const doc = new jsPDF()

  doc.setFontSize(14)
  doc.text(BUSINESS_NAME, MARGIN_LEFT, 16)
  doc.setFontSize(11)
  doc.text('Invoice Pembayaran Periode Belajar', MARGIN_LEFT, 24)

  autoTable(doc, {
    startY: 32,
    margin: { left: MARGIN_LEFT },
    body: [
      ['Keluarga', data.familyName],
      ['Anak', data.childName],
      ['Program', data.classroomLabel],
      ['Periode', `#${data.periodNo}`],
      ['Mulai', data.startDate],
      ['Jatuh Tempo', data.dueDate ?? '—'],
      [{ content: 'Total Tagihan', styles: { fontStyle: 'bold' } }, { content: formatIdr(data.amount), styles: { fontStyle: 'bold' } }],
    ],
    styles: { fontSize: 10 },
    theme: 'plain',
  })

  const afterTableY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10
  doc.setFontSize(10)
  doc.text('Silakan transfer ke rekening berikut:', MARGIN_LEFT, afterTableY)
  BANK_ACCOUNT_LINES.forEach((line, index) => {
    doc.text(line, MARGIN_LEFT, afterTableY + 6 + index * 6)
  })

  const fileSafeName = data.childName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'anak'
  doc.save(`invoice-${fileSafeName}-periode-${data.periodNo}.pdf`)
}

/** Prefilled WhatsApp text — the PDF itself has to be attached by hand, wa.me links can't do it. */
export function buildInvoiceMessage(data: InvoiceData): string {
  return [
    `Halo ${data.familyName},`,
    ``,
    `Berikut tagihan periode belajar ${data.childName} — ${data.classroomLabel} periode #${data.periodNo}:`,
    ``,
    `Total: ${formatIdr(data.amount)}`,
    data.dueDate ? `Jatuh Tempo: ${data.dueDate}` : null,
    ``,
    `Silakan transfer ke rekening berikut:`,
    ...BANK_ACCOUNT_LINES,
    ``,
    `Invoice (PDF) terlampir. Mohon konfirmasi setelah transfer. Terima kasih.`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

/**
 * Prefilled WhatsApp text for a period already marked paid — the counterpart to
 * buildInvoiceMessage. Whoever calls this opens the receipt (if any) in a separate tab first;
 * this text has no file of its own to reference, same "attach by hand" limitation as the
 * invoice.
 */
export function buildPaymentConfirmationMessage(data: InvoiceData): string {
  return [
    `Halo ${data.familyName},`,
    ``,
    `Pembayaran periode belajar ${data.childName} — ${data.classroomLabel} periode #${data.periodNo} sebesar ` +
      `${formatIdr(data.amount)} telah kami terima. Terima kasih!`,
  ].join('\n')
}
