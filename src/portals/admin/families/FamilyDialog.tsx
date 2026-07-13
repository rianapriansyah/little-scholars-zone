import { useEffect, useState } from 'react'
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
import type { FamilyRow } from '../../../types/family'

type Props = {
  open: boolean
  family: FamilyRow | null
  onClose: () => void
  onSaved: () => void
}

export function FamilyDialog({ open, family, onClose, onSaved }: Props) {
  const isEdit = family !== null

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
  const [generating, setGenerating] = useState(false)
  const [credentials, setCredentials] = useState<{ email: string; password: string; reused?: boolean } | null>(null)

  const phoneDigits = phone.replace(/\D/g, '')

  useEffect(() => {
    if (!open) return
    setName(family?.name ?? '')
    setEmail(family?.contact_email ?? '')
    setPhone(family?.contact_phone ?? '')
    setFatherName(family?.father_name ?? '')
    setFatherOccupation(family?.father_occupation ?? '')
    setFatherPhone(family?.father_phone ?? '')
    setMotherName(family?.mother_name ?? '')
    setMotherOccupation(family?.mother_occupation ?? '')
    setMotherPhone(family?.mother_phone ?? '')
    setAddress(family?.address ?? '')
    setError(null)
  }, [open, family])

  const handleClose = () => {
    if (saving || generating) return
    onClose()
  }

  const extras = {
    father_name: fatherName.trim() || null,
    father_occupation: fatherOccupation.trim() || null,
    father_phone: fatherPhone.trim() || null,
    mother_name: motherName.trim() || null,
    mother_occupation: motherOccupation.trim() || null,
    mother_phone: motherPhone.trim() || null,
    address: address.trim() || null,
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
    if (isEdit) {
      const { error: uErr } = await supabase
        .from('families')
        .update({
          name: name.trim(),
          contact_email: email.trim() || null,
          contact_phone: phone.trim() || null,
          ...extras,
        })
        .eq('id', family.id)
      setSaving(false)
      if (uErr) {
        setError(uErr.message)
        return
      }
      onSaved()
      onClose()
    } else {
      const result = await createFamilyAccount({ name, email, phone })
      if (!result.ok) {
        setSaving(false)
        setError(result.message)
        return
      }

      // Patch the extra fields onto the newly created family row (looked up by email).
      const hasExtras = Object.values(extras).some((v) => v !== null)
      if (hasExtras) {
        await supabase.from('families').update(extras).eq('contact_email', email.trim().toLowerCase())
      }

      setSaving(false)
      setCredentials({ email: email.trim().toLowerCase(), password: result.password })
    }
  }

  async function handleGenerateCredentials() {
    if (!family) return
    const targetEmail = email.trim() || family.contact_email || ''
    if (!targetEmail) return
    setGenerating(true)
    setError(null)
    const result = await createFamilyAccount({
      name: name.trim() || family.name,
      email: targetEmail,
      phone: phone.trim() || family.contact_phone,
    })
    setGenerating(false)
    if (!result.ok) {
      setError(`Failed to generate login: ${result.message}`)
      return
    }
    setCredentials({ email: targetEmail, password: result.password, reused: !!family.auth_user_id })
  }

  function handleCredentialsDone() {
    setCredentials(null)
    onSaved()
    if (!isEdit) onClose()
  }

  const canGenerateCredentials = isEdit && !!(email.trim() || family.contact_email) && !!phoneDigits

  return (
    <>
      <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
        <DialogTitle>{isEdit ? 'Edit family' : 'Add family'}</DialogTitle>
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

            {isEdit ? (
              <Button
                variant="outlined"
                disabled={generating || saving || !canGenerateCredentials}
                onClick={() => void handleGenerateCredentials()}
              >
                {generating ? 'Generating…' : family.auth_user_id ? 'Reset password' : 'Generate login credentials'}
              </Button>
            ) : null}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleClose} disabled={saving || generating}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleSave()}
            disabled={saving || generating || !name.trim() || !email.trim() || !phoneDigits}
          >
            {isEdit ? (saving ? 'Saving…' : 'Save') : saving ? 'Creating…' : 'Save & create login'}
          </Button>
        </DialogActions>
      </Dialog>
      <CredentialsRevealDialog
        open={credentials !== null}
        name={name.trim() || family?.name || ''}
        email={credentials?.email ?? ''}
        password={credentials?.password ?? ''}
        phone={phone}
        reused={credentials?.reused}
        onClose={handleCredentialsDone}
      />
    </>
  )
}
