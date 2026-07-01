import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Switch,
  TextField,
} from '@mui/material'
import { supabase } from '../../../lib/supabase'
import { inviteTeacher } from '../../../lib/inviteTeacher'
import type { TeacherRow } from '../../../types/teacher'

type Props = {
  open: boolean
  teacher: TeacherRow | null
  onClose: () => void
  onSaved: () => void
}

export function TeacherManageDialog({ open, teacher, onClose, onSaved }: Props) {
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [active, setActive] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [resending, setResending] = useState(false)

  useEffect(() => {
    if (!open || !teacher) return
    setFullName(teacher.full_name ?? '')
    setPhone(teacher.contact_phone ?? '')
    setActive(teacher.active)
    setError(null)
  }, [open, teacher])

  const handleClose = () => {
    if (saving || resending) return
    onClose()
  }

  async function handleSave() {
    if (!teacher) return
    setSaving(true)
    setError(null)
    const { error: uErr } = await supabase
      .from('teachers')
      .update({
        full_name: fullName.trim(),
        contact_phone: phone.trim() || null,
        active,
      })
      .eq('id', teacher.id)
    setSaving(false)
    if (uErr) {
      setError(uErr.message)
      return
    }
    onSaved()
    onClose()
  }

  async function handleResend() {
    if (!teacher) return
    setResending(true)
    setError(null)
    const result = await inviteTeacher({
      fullName: fullName.trim() || teacher.full_name,
      email: teacher.email,
      phone: phone.trim() || teacher.contact_phone,
    })
    setResending(false)
    if (!result.ok) {
      setError(`Invite failed: ${result.message}`)
      return
    }
    onSaved()
    onClose()
  }

  if (!teacher) return null

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>Edit teacher</DialogTitle>
      <DialogContent dividers>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField size="small" label="Email" value={teacher.email} disabled fullWidth />
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
            label="Phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            fullWidth
          />
          <FormControlLabel
            control={<Switch checked={active} onChange={(e) => setActive(e.target.checked)} />}
            label="Active"
          />
          {!teacher.auth_user_id ? (
            <Button variant="outlined" disabled={resending || saving} onClick={() => void handleResend()}>
              {resending ? 'Sending…' : 'Send teacher portal invite'}
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
