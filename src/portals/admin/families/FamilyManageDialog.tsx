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
} from '@mui/material'
import { supabase } from '../../../lib/supabase'
import { inviteFamily } from '../../../lib/inviteFamily'
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
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [resending, setResending] = useState(false)

  useEffect(() => {
    if (!open || !family) return
    setName(family.name ?? '')
    setEmail(family.contact_email ?? '')
    setPhone(family.contact_phone ?? '')
    setError(null)
  }, [open, family])

  const handleClose = () => {
    if (saving || resending) return
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

  async function handleResend() {
    if (!family) return
    setResending(true)
    setError(null)
    const result = await inviteFamily({
      name: name.trim() || family.name,
      email: email.trim() || family.contact_email || '',
      phone: phone.trim() || family.contact_phone,
    })
    setResending(false)
    if (!result.ok) {
      setError(`Invite failed: ${result.message}`)
      return
    }
    onSaved()
    onClose()
  }

  if (!family) return null

  return (
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
          {!family.auth_user_id ? (
            <Button variant="outlined" disabled={resending || saving} onClick={() => void handleResend()}>
              {resending ? 'Sending…' : 'Send parent portal invite'}
            </Button>
          ) : null}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={saving || resending}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void handleSave()} disabled={saving || resending}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
