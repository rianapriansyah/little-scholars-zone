import { useEffect, useState } from 'react'
import { Alert, Box, Button, Paper, TextField, Typography } from '@mui/material'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import { formatIdr } from '../../lib/formatIdr'
import { validatePaymentStep, type DraftChild, type ProgramOption } from '../../lib/registrationDraft'

type Props = {
  children: DraftChild[]
  programs: ProgramOption[]
  paymentNote: string
  receipt: File | null
  onReceiptChange: (file: File | null) => void
  onPaymentNoteChange: (value: string) => void
}

const TRANSFER_INSTRUCTIONS = [
  'Transfer ke rekening berikut, lalu unggah bukti pembayarannya di bawah:',
  'Bank: Mandiri',
  'No. Rekening: 1330030611560',
  'Atas Nama: Dewi Cahyanti Wahyu Ningsih',
]

export function PaymentStep({
  children,
  programs,
  paymentNote,
  receipt,
  onReceiptChange,
  onPaymentNoteChange,
}: Props) {
  const byId = new Map(programs.map((program) => [program.id, program]))
  const total = children.reduce((sum, child) => sum + (byId.get(child.classroomId)?.price ?? 0), 0)
  const receiptError = validatePaymentStep(
    receipt ? { name: receipt.name, size: receipt.size, type: receipt.type } : null,
  )

  // One object URL per selected file, revoked when replaced or unmounted — createObjectURL in
  // the render body would mint a new (leaked) URL on every re-render instead.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!receipt || !receipt.type.startsWith('image/')) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(receipt)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [receipt])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    onReceiptChange(e.target.files?.[0] ?? null)
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Alert severity="info">
        Total Pembayaran: <strong>{formatIdr(total)}</strong>
      </Alert>

      <Paper variant="outlined" sx={{ p: 2 }}>
        {TRANSFER_INSTRUCTIONS.map((line) => (
          <Typography key={line} variant="body2" color="text.secondary">
            {line}
          </Typography>
        ))}
      </Paper>

      <Button variant="outlined" component="label" startIcon={<UploadFileIcon />} sx={{ alignSelf: 'flex-start' }}>
        {receipt ? 'Ganti Berkas' : 'Unggah Bukti Pembayaran'}
        <input type="file" accept="image/*,application/pdf" hidden onChange={handleFileChange} />
      </Button>

      {receipt ? (
        <Paper variant="outlined" sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
          {previewUrl ? (
            <Box
              component="img"
              src={previewUrl}
              alt="Pratinjau bukti pembayaran"
              sx={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 1 }}
            />
          ) : null}
          <Typography variant="body2">{receipt.name}</Typography>
        </Paper>
      ) : null}

      {receipt && receiptError ? <Alert severity="error">{receiptError}</Alert> : null}

      <TextField
        size="small"
        label="Catatan Pembayaran (opsional)"
        value={paymentNote}
        onChange={(e) => onPaymentNoteChange(e.target.value)}
        multiline
        minRows={2}
        fullWidth
      />
    </Box>
  )
}
