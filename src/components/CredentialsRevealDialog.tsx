import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  TextField,
  Typography,
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import CheckIcon from '@mui/icons-material/Check'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import { buildWhatsAppMeUrlWithMessage } from '../lib/whatsappLink'
import { buildLoginCredentialsMessage } from '../lib/loginCredentialsMessage'

type Props = {
  open: boolean
  name: string
  email: string
  password: string
  phone?: string | null
  reused?: boolean
  onClose: () => void
}

export function CredentialsRevealDialog({ open, name, email, password, phone, reused, onClose }: Props) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(password)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function handleSendWhatsApp() {
    const message = buildLoginCredentialsMessage(name, email, password)
    const waUrl = buildWhatsAppMeUrlWithMessage(phone, message)
    if (waUrl) window.open(waUrl, '_blank', 'noopener,noreferrer')
  }

  const waUrl = buildWhatsAppMeUrlWithMessage(phone, '')

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{reused ? 'Password reset' : 'Account created'}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {email}
        </Typography>
        <TextField
          size="small"
          label="Password"
          value={password}
          fullWidth
          InputProps={{
            readOnly: true,
            sx: { fontFamily: 'monospace' },
            endAdornment: (
              <InputAdornment position="end">
                <IconButton onClick={() => void handleCopy()} size="small" aria-label="Copy password">
                  {copied ? <CheckIcon fontSize="small" color="success" /> : <ContentCopyIcon fontSize="small" />}
                </IconButton>
              </InputAdornment>
            ),
          }}
        />
        <Alert severity="warning" sx={{ mt: 2 }}>
          This password will not be shown again.
        </Alert>
        {waUrl ? (
          <Button
            variant="outlined"
            color="success"
            startIcon={<WhatsAppIcon />}
            fullWidth
            sx={{ mt: 2 }}
            onClick={handleSendWhatsApp}
          >
            Send via WhatsApp
          </Button>
        ) : (
          <Alert severity="info" sx={{ mt: 2 }}>
            No phone number on file — share this password with the account holder directly.
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  )
}
