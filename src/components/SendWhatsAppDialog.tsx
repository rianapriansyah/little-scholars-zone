import { useEffect, useState } from 'react'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material'
import { buildWhatsAppMeUrlWithMessage } from '../lib/whatsappLink'

type Props = {
  open: boolean
  name: string
  phone: string | null
  onClose: () => void
}

export function SendWhatsAppDialog({ open, name, phone, onClose }: Props) {
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (open) setMessage('')
  }, [open])

  const waUrl = buildWhatsAppMeUrlWithMessage(phone, message)

  function handleSend() {
    if (waUrl) window.open(waUrl, '_blank', 'noopener,noreferrer')
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Kirim WhatsApp — {name}</DialogTitle>
      <DialogContent dividers>
        {phone ? (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {phone}
            </Typography>
            <TextField
              size="small"
              label="Pesan (opsional)"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              multiline
              minRows={3}
              fullWidth
            />
          </>
        ) : (
          <Alert severity="info">Tidak ada nomor telepon tercatat.</Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>Batal</Button>
        <Button variant="contained" color="success" startIcon={<WhatsAppIcon />} disabled={!waUrl} onClick={handleSend}>
          Kirim
        </Button>
      </DialogActions>
    </Dialog>
  )
}
