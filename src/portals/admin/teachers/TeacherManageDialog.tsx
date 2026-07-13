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
import { createTeacherAccount } from '../../../lib/createTeacherAccount'
import { CredentialsRevealDialog } from '../../../components/CredentialsRevealDialog'
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
  const [generating, setGenerating] = useState(false)
  const [credentials, setCredentials] = useState<{ email: string; password: string; reused: boolean } | null>(null)

  const phoneDigits = phone.replace(/\D/g, '')

  useEffect(() => {
    if (!open || !teacher) return
    setFullName(teacher.full_name ?? '')
    setPhone(teacher.contact_phone ?? '')
    setActive(teacher.active)
    setError(null)
  }, [open, teacher])

  const handleClose = () => {
    if (saving || generating) return
    onClose()
  }

  async function handleSave() {
    if (!teacher) return
    if (!phoneDigits) {
      setError('Enter a phone number — used to send login details via WhatsApp.')
      return
    }
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

  async function handleGenerateCredentials() {
    if (!teacher) return
    setGenerating(true)
    setError(null)
    const result = await createTeacherAccount({
      fullName: fullName.trim() || teacher.full_name,
      email: teacher.email,
      phone: phone.trim() || teacher.contact_phone,
    })
    setGenerating(false)
    if (!result.ok) {
      setError(`Failed to generate login: ${result.message}`)
      return
    }
    setCredentials({ email: teacher.email, password: result.password, reused: !!teacher.auth_user_id })
  }

  function handleCredentialsDone() {
    setCredentials(null)
    onSaved()
  }

  if (!teacher) return null

  return (
    <>
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
              required
              fullWidth
              helperText="Login details are sent to this number via WhatsApp."
            />
            <FormControlLabel
              control={<Switch checked={active} onChange={(e) => setActive(e.target.checked)} />}
              label="Active"
            />
            <Button
              variant="outlined"
              disabled={generating || saving || !phoneDigits}
              onClick={() => void handleGenerateCredentials()}
            >
              {generating ? 'Generating…' : teacher.auth_user_id ? 'Reset password' : 'Generate login credentials'}
            </Button>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleClose} disabled={saving || generating}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleSave()}
            disabled={saving || generating || !phoneDigits}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
      <CredentialsRevealDialog
        open={credentials !== null}
        name={fullName.trim() || teacher.full_name}
        email={credentials?.email ?? ''}
        password={credentials?.password ?? ''}
        phone={phone}
        reused={credentials?.reused}
        onClose={handleCredentialsDone}
      />
    </>
  )
}
