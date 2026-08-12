/**
 * The one bank account the center accepts transfers into. Shared by the registration wizard's
 * PaymentStep and the admin's invoice PDF/WhatsApp text so the two can never drift apart on
 * the account number. Just the account lines — each caller supplies its own lead-in sentence,
 * since "unggah bukti pembayarannya di bawah" only makes sense inside the wizard's own upload
 * step.
 */
export const BANK_ACCOUNT_LINES = [
  'Bank: Mandiri',
  'No. Rekening: 1330030611560',
  'Atas Nama: Dewi Cahyanti Wahyu Ningsih',
]
