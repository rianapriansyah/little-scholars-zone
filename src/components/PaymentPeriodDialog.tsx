import { useCallback, useEffect, useState } from 'react'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  Typography,
} from '@mui/material'
import { formatIdr } from '../lib/formatIdr'
import { buildInvoiceMessage, buildPaymentConfirmationMessage, generateInvoicePdf, type InvoiceData } from '../lib/invoicePdf'
import { fetchPaymentPeriodForLearningPeriod, markPaymentPeriodPaid, uploadPaymentReceipt } from '../lib/paymentPeriods'
import { fetchReceiptSignedUrl } from '../lib/receiptStorage'
import { supabase } from '../lib/supabase'
import { buildWhatsAppMeUrlWithMessage } from '../lib/whatsappLink'
import type { PaymentPeriod } from '../types/payment'

type Props = {
  open: boolean
  learningPeriodId: string
  /** Everything the invoice/receipt text needs besides the amount — pulled from the period row
   *  the caller already has, so this dialog doesn't need its own copy of learning_period_status. */
  childName: string
  classroomLabel: string
  periodNo: number
  startDate: string
  onClose: () => void
  /** Fires after an upload or a "Tandai Lunas" — so the caller's list can refresh its own row. */
  onChanged: () => void
}

function isPdfPath(path: string): boolean {
  return path.toLowerCase().endsWith('.pdf')
}

/**
 * Everything about one period's payment, behind a click on the Pembayaran chip: view the
 * receipt when paid, upload one and mark paid when not, and one bottom button that sends
 * either the invoice or the payment confirmation depending on which state that is. Shared by
 * the admin's Periode Belajar datagrid and the family detail page's Periode Belajar tab, so the
 * two can never show different payment UI for the same table.
 */
export function PaymentPeriodDialog({
  open,
  learningPeriodId,
  childName,
  classroomLabel,
  periodNo,
  startDate,
  onClose,
  onChanged,
}: Props) {
  const [payment, setPayment] = useState<PaymentPeriod | null>(null)
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null)
  const [familyName, setFamilyName] = useState('')
  const [phone, setPhone] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [marking, setMarking] = useState(false)
  // A file picked but not yet uploaded — staged locally so the admin can see what they're
  // about to attach and back out before it actually goes to Storage.
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setReceiptUrl(null)

    const paymentResult = await fetchPaymentPeriodForLearningPeriod(learningPeriodId)
    if (!paymentResult.ok) {
      setLoading(false)
      setError(paymentResult.error)
      return
    }
    if (!paymentResult.data) {
      setLoading(false)
      setError('Data pembayaran tidak ditemukan.')
      return
    }
    setPayment(paymentResult.data)

    // Neither the datagrid nor the family tab's row carries family contact info — payment_periods
    // does carry child_id, so that's the one hop needed to reach it.
    const { data: childRow } = await supabase
      .from('children')
      .select('families(name, contact_phone)')
      .eq('id', paymentResult.data.childId)
      .maybeSingle()
    const family = (childRow?.families as unknown as { name: string; contact_phone: string | null } | null) ?? null
    setFamilyName(family?.name ?? '')
    setPhone(family?.contact_phone ?? null)

    if (paymentResult.data.receiptPath) {
      const urlResult = await fetchReceiptSignedUrl(paymentResult.data.receiptPath)
      if (urlResult.ok) setReceiptUrl(urlResult.data)
    }
    setLoading(false)
  }, [learningPeriodId])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  // Revokes the *previous* preview URL whenever it changes (a new file staged, the selection
  // cleared, or the dialog unmounting) — one place, so a staged file can never leak its blob URL.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  /** Stages a picked file for preview — nothing is uploaded until "Unggah" is pressed. */
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setSelectedFile(file)
    // Only an image can be shown inline; a staged PDF just shows its file name until uploaded,
    // same "no inline preview" treatment the already-uploaded receipt gets below.
    setPreviewUrl(file.type.startsWith('image/') ? URL.createObjectURL(file) : null)
  }

  function handleDiscardSelection() {
    setSelectedFile(null)
    setPreviewUrl(null)
  }

  async function handleConfirmUpload() {
    if (!selectedFile || !payment) return
    setUploading(true)
    setError(null)
    const result = await uploadPaymentReceipt(payment.id, selectedFile)
    setUploading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    handleDiscardSelection()
    await load()
    onChanged()
  }

  async function handleMarkPaid() {
    if (!payment) return
    setMarking(true)
    setError(null)
    const result = await markPaymentPeriodPaid(payment.id)
    setMarking(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await load()
    onChanged()
  }

  function handleSend() {
    if (!payment) return
    const data: InvoiceData = { familyName, childName, classroomLabel, periodNo, startDate, amount: payment.amount, dueDate: payment.dueDate }

    if (payment.status === 'paid') {
      // The receipt has no download of its own to trigger — opening it is the closest
      // equivalent to the invoice PDF's doc.save(), same "attach by hand" limitation.
      if (receiptUrl) window.open(receiptUrl, '_blank', 'noopener,noreferrer')
      const waUrl = buildWhatsAppMeUrlWithMessage(phone, buildPaymentConfirmationMessage(data))
      if (waUrl) window.open(waUrl, '_blank', 'noopener,noreferrer')
    } else {
      generateInvoicePdf(data)
      const waUrl = buildWhatsAppMeUrlWithMessage(phone, buildInvoiceMessage(data))
      if (waUrl) window.open(waUrl, '_blank', 'noopener,noreferrer')
    }
  }

  const isPaid = payment?.status === 'paid'

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Pembayaran — {childName}</DialogTitle>
      <DialogContent dividers>
        {loading ? (
          <Box display="flex" justifyContent="center" py={3}>
            <CircularProgress size={28} />
          </Box>
        ) : !payment ? (
          <Alert severity="error">{error ?? 'Data pembayaran tidak tersedia.'}</Alert>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {error ? (
              <Alert severity="error" onClose={() => setError(null)}>
                {error}
              </Alert>
            ) : null}

            <Typography variant="body2" color="text.secondary">
              {classroomLabel} · Periode #{periodNo}
            </Typography>
            <Typography variant="h6">{formatIdr(payment.amount)}</Typography>

            {/* The already-attached receipt, if any — shown whenever there is one and nothing
                new is staged, regardless of paid/unpaid status. */}
            {!selectedFile && receiptUrl ? (
              isPdfPath(payment.receiptPath ?? '') ? (
                <Link href={receiptUrl} target="_blank" rel="noopener noreferrer">
                  Buka Bukti Pembayaran (PDF)
                </Link>
              ) : (
                <Box
                  component="img"
                  src={receiptUrl}
                  alt="Bukti pembayaran"
                  sx={{ maxWidth: '100%', maxHeight: 320, borderRadius: 1, border: 1, borderColor: 'divider' }}
                />
              )
            ) : null}
            {!selectedFile && !receiptUrl && isPaid ? (
              <Alert severity="info">Tidak ada bukti pembayaran diunggah.</Alert>
            ) : null}

            {selectedFile ? (
              // Staged, not yet uploaded — a preview plus the choice to actually send it or
              // back out, instead of uploading the moment a file is picked.
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {previewUrl ? (
                  <Box
                    component="img"
                    src={previewUrl}
                    alt="Pratinjau bukti pembayaran"
                    sx={{ maxWidth: '100%', maxHeight: 320, borderRadius: 1, border: 1, borderColor: 'divider' }}
                  />
                ) : (
                  <Alert severity="info">{selectedFile.name}</Alert>
                )}
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button variant="contained" size="small" onClick={() => void handleConfirmUpload()} disabled={uploading}>
                    {uploading ? 'Mengunggah…' : 'Unggah'}
                  </Button>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<DeleteIcon />}
                    onClick={handleDiscardSelection}
                    disabled={uploading}
                  >
                    Hapus
                  </Button>
                </Box>
              </Box>
            ) : !isPaid ? (
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Button variant="outlined" component="label" size="small" startIcon={<UploadFileIcon />}>
                  {receiptUrl ? 'Ganti Bukti Pembayaran' : 'Unggah Bukti Pembayaran'}
                  <input type="file" accept="image/*,application/pdf" hidden onChange={handleFileSelect} />
                </Button>
                <Button variant="contained" size="small" onClick={() => void handleMarkPaid()} disabled={marking}>
                  {marking ? 'Memproses…' : 'Tandai Lunas'}
                </Button>
              </Box>
            ) : null}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>Tutup</Button>
        <Button variant="contained" color="success" startIcon={<WhatsAppIcon />} onClick={handleSend} disabled={!payment}>
          {isPaid ? 'Kirim Bukti Pembayaran' : 'Kirim Tagihan'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
