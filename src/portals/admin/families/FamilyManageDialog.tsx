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

export function FamilyManageDialog({ open, family, onClose, onSaved }: Props) {
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
  const [credentials, setCredentials] = useState<{ email: string; password: string; reused: boolean } | null>(null)

  useEffect(() => {
    if (!open || !family) return
    setName(family.name ?? '')
    setEmail(family.contact_email ?? '')
    setPhone(family.contact_phone ?? '')
    setFatherName(family.father_name ?? '')
    setFatherOccupation(family.father_occupation ?? '')
    setFatherPhone(family.father_phone ?? '')
    setMotherName(family.mother_name ?? '')
    setMotherOccupation(family.mother_occupation ?? '')
    setMotherPhone(family.mother_phone ?? '')
    setAddress(family.address ?? '')
    setError(null)
  }, [open, family])

  const handleClose = () => {
    if (saving || generating) return
    onClose()
  }

  async function handleSave() {
    if (!family) return
    setSaving(true)
    setError(null)
    const { error: uErr } = await supabase
      .from('families')
      .update({
        name: name.trim(),
        contact_email: email.trim() || null,
        contact_phone: phone.trim() || null,
        father_name: fatherName.trim() || null,
        father_occupation: fatherOccupation.trim() || null,
        father_phone: fatherPhone.trim() || null,
        mother_name: motherName.trim() || null,
        mother_occupation: motherOccupation.trim() || null,
        mother_phone: motherPhone.trim() || null,
        address: address.trim() || null,
      })
      .eq('id', family.id)
    setSaving(false)
    if (uErr) {
      setError(uErr.message)
      return
    }
    onSaved()
    onClose()
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
  }

  if (!family) return null

  const canGenerateCredentials = !!(email.trim() || family.contact_email)

  return (
    <>
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>Edit family</DialogTitle>
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
            fullWidth
          />
          <TextField
            size="small"
            label="Contact phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            fullWidth
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

          <Button
            variant="outlined"
            disabled={generating || saving || !canGenerateCredentials}
            onClick={() => void handleGenerateCredentials()}
          >
            {generating ? 'Generating…' : family.auth_user_id ? 'Reset password' : 'Generate login credentials'}
          </Button>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={saving || generating}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void handleSave()} disabled={saving || generating}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
    <CredentialsRevealDialog
      open={credentials !== null}
      email={credentials?.email ?? ''}
      password={credentials?.password ?? ''}
      reused={credentials?.reused}
      onClose={handleCredentialsDone}
    />
    </>
  )
}
