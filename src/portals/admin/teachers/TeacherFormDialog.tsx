import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from '@mui/material'
import { createTeacherAccount } from '../../../lib/createTeacherAccount'
import { CredentialsRevealDialog } from '../../../components/CredentialsRevealDialog'

type Props = {
  open: boolean
  onClose: () => void
  onSaved: () => void
}

export function TeacherFormDialog({ open, onClose, onSaved }: Props) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null)

  const phoneDigits = phone.replace(/\D/g, '')

  function reset() {
    setFullName('')
    setEmail('')
    setPhone('')
    setError(null)
  }

  const handleClose = () => {
    if (saving) return
    reset()
    onClose()
  }

  async function handleSave() {
    setError(null)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.')
      return
    }
    if (!phoneDigits) {
      setError('Enter a phone number — used to send login details via WhatsApp.')
      return
    }

    setSaving(true)
    const result = await createTeacherAccount({ fullName, email, phone })
    setSaving(false)
    if (!result.ok) {
      setError(result.message)
      return
    }

    setCredentials({ email: email.trim().toLowerCase(), password: result.password })
  }

  function handleCredentialsDone() {
    setCredentials(null)
    onSaved()
    handleClose()
  }

  return (
    <>
      <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
        <DialogTitle>Add teacher</DialogTitle>
        <DialogContent dividers>
          {error ? (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          ) : null}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              size="small"
              label="Full name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              fullWidth
            />
            <TextField
              size="small"
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              fullWidth
              helperText="Used as the teacher's login email."
            />
            <TextField
              size="small"
              label="Phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              fullWidth
              helperText="Login details are sent to this number via WhatsApp."
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleSave()}
            disabled={saving || !fullName.trim() || !email.trim() || !phoneDigits}
          >
            {saving ? 'Creating…' : 'Save & create login'}
          </Button>
        </DialogActions>
      </Dialog>
      <CredentialsRevealDialog
        open={credentials !== null}
        name={fullName.trim()}
        email={credentials?.email ?? ''}
        password={credentials?.password ?? ''}
        phone={phone}
        onClose={handleCredentialsDone}
      />
    </>
  )
}
