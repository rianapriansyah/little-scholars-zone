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
  Typography,
} from '@mui/material'
import { supabase } from '../../../lib/supabase'
import { createFamilyAccount } from '../../../lib/createFamilyAccount'
import { CredentialsRevealDialog } from '../../../components/CredentialsRevealDialog'

type Props = {
  open: boolean
  onClose: () => void
  onSaved: () => void
}

export function FamilyFormDialog({ open, onClose, onSaved }: Props) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [fatherName, setFatherName] = useState('')
  const [fatherOccupation, setFatherOccupation] = useState('')
  const [fatherPhone, setFatherPhone] = useState('')
  const [motherName, setMotherName] = useState('')
  const [motherOccupation, setMotherOccupation] = useState('')
  const [motherPhone, setMotherPhone] = useState('')
  const [address, setAddress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null)

  const phoneDigits = phone.replace(/\D/g, '')

  function reset() {
    setName('')
    setEmail('')
    setPhone('')
    setFatherName('')
    setFatherOccupation('')
    setFatherPhone('')
    setMotherName('')
    setMotherOccupation('')
    setMotherPhone('')
    setAddress('')
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
      setError('Enter a contact phone number — used to send login details via WhatsApp.')
      return
    }

    setSaving(true)
    const result = await createFamilyAccount({ name, email, phone })
    if (!result.ok) {
      setSaving(false)
      setError(result.message)
      return
    }

    // Patch the extra fields onto the newly created family row (looked up by email).
    const extras = {
      father_name: fatherName.trim() || null,
      father_occupation: fatherOccupation.trim() || null,
      father_phone: fatherPhone.trim() || null,
      mother_name: motherName.trim() || null,
      mother_occupation: motherOccupation.trim() || null,
      mother_phone: motherPhone.trim() || null,
      address: address.trim() || null,
    }
    const hasExtras = Object.values(extras).some((v) => v !== null)
    if (hasExtras) {
      await supabase
        .from('families')
        .update(extras)
        .eq('contact_email', email.trim().toLowerCase())
    }

    setSaving(false)
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
      <DialogTitle>Add family</DialogTitle>
      <DialogContent dividers>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            size="small"
            label="Family name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            fullWidth
          />
          <TextField
            size="small"
            label="Contact email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            fullWidth
            helperText="Used as the parent's login email."
          />
          <TextField
            size="small"
            label="Contact phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            fullWidth
            helperText="Login details are sent to this number via WhatsApp."
          />

          <Typography variant="subtitle2" sx={{ mt: 1 }}>Father</Typography>
          <TextField
            size="small"
            label="Father name"
            value={fatherName}
            onChange={(e) => setFatherName(e.target.value)}
            fullWidth
          />
          <TextField
            size="small"
            label="Father occupation"
            value={fatherOccupation}
            onChange={(e) => setFatherOccupation(e.target.value)}
            fullWidth
          />
          <TextField
            size="small"
            label="Father phone number"
            value={fatherPhone}
            onChange={(e) => setFatherPhone(e.target.value)}
            fullWidth
          />

          <Typography variant="subtitle2" sx={{ mt: 1 }}>Mother</Typography>
          <TextField
            size="small"
            label="Mother name"
            value={motherName}
            onChange={(e) => setMotherName(e.target.value)}
            fullWidth
          />
          <TextField
            size="small"
            label="Mother occupation"
            value={motherOccupation}
            onChange={(e) => setMotherOccupation(e.target.value)}
            fullWidth
          />
          <TextField
            size="small"
            label="Mother phone number"
            value={motherPhone}
            onChange={(e) => setMotherPhone(e.target.value)}
            fullWidth
          />

          <Typography variant="subtitle2" sx={{ mt: 1 }}>Address</Typography>
          <TextField
            size="small"
            label="Address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            fullWidth
            multiline
            rows={2}
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
          disabled={saving || !name.trim() || !email.trim() || !phoneDigits}
        >
          {saving ? 'Creating…' : 'Save & create login'}
        </Button>
      </DialogActions>
    </Dialog>
    <CredentialsRevealDialog
      open={credentials !== null}
      name={name.trim()}
      email={credentials?.email ?? ''}
      password={credentials?.password ?? ''}
      phone={phone}
      onClose={handleCredentialsDone}
    />
    </>
  )
}
