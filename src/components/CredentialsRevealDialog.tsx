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

type Props = {
  open: boolean
  email: string
  password: string
  reused?: boolean
  onClose: () => void
}

export function CredentialsRevealDialog({ open, email, password, reused, onClose }: Props) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(password)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

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
          This password will not be shown again. Share it with the {reused ? 'account holder' : 'teacher/parent'}{' '}
          directly (e.g. WhatsApp or in person).
        </Alert>
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
