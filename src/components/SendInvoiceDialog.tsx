import { useState } from 'react'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import { formatIdr } from '../lib/formatIdr'
import { buildInvoiceMessage, generateInvoicePdf, type InvoiceData } from '../lib/invoicePdf'
import { buildWhatsAppMeUrlWithMessage } from '../lib/whatsappLink'

type Props = {
  open: boolean
  invoice: InvoiceData
  phone: string | null
  onClose: () => void
}

/**
 * "Sending" an invoice is two client-side actions, one click: download the PDF, then open
 * WhatsApp with the amount/due-date/bank details prefilled. wa.me links cannot attach a file,
 * so the admin drags the just-downloaded PDF into the chat by hand — nothing about either step
 * is tracked server-side (see 20260812010000_payment_periods.sql).
 */
export function SendInvoiceDialog({ open, invoice, phone, onClose }: Props) {
  const [sent, setSent] = useState(false)
  const waUrl = buildWhatsAppMeUrlWithMessage(phone, buildInvoiceMessage(invoice))

  function handleDownloadAndSend() {
    generateInvoicePdf(invoice)
    if (waUrl) window.open(waUrl, '_blank', 'noopener,noreferrer')
    setSent(true)
  }

  function handleClose() {
    setSent(false)
    onClose()
  }

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="xs">
      <DialogTitle>Kirim Invoice — {invoice.childName}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary">
          {invoice.classroomLabel} · Periode #{invoice.periodNo}
        </Typography>
        <Typography variant="h6" sx={{ my: 1 }}>
          {formatIdr(invoice.amount)}
        </Typography>

        {phone ? (
          <Typography variant="body2" color="text.secondary">
            Dikirim ke {phone}
          </Typography>
        ) : (
          <Alert severity="info" sx={{ mt: 1 }}>
            Tidak ada nomor telepon tercatat pada keluarga ini — PDF tetap bisa diunduh untuk dibagikan manual.
          </Alert>
        )}

        {sent ? (
          <Alert severity="success" sx={{ mt: 2 }}>
            PDF terunduh{waUrl ? ' dan WhatsApp terbuka' : ''}. Lampirkan berkas PDF tersebut secara manual di chat.
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Box sx={{ flex: 1 }} />
        <Button onClick={handleClose}>{sent ? 'Selesai' : 'Nanti Saja'}</Button>
        <Button variant="contained" color="success" startIcon={<WhatsAppIcon />} onClick={handleDownloadAndSend}>
          Unduh &amp; Kirim
        </Button>
      </DialogActions>
    </Dialog>
  )
}
