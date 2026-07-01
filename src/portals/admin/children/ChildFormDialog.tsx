import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
} from '@mui/material'
import { supabase } from '../../../lib/supabase'
import type { FamilyRow } from '../../../types/family'

type Props = {
  open: boolean
  onClose: () => void
  onSaved: () => void
}

export function ChildFormDialog({ open, onClose, onSaved }: Props) {
  const [families, setFamilies] = useState<FamilyRow[]>([])
  const [familyId, setFamilyId] = useState('')
  const [fullName, setFullName] = useState('')
  const [birthdate, setBirthdate] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    void supabase.from('families').select('*').order('name').then(({ data }) => setFamilies(data ?? []))
  }, [open])

  function reset() {
    setFamilyId('')
    setFullName('')
    setBirthdate('')
    setNotes('')
    setError(null)
  }

  const handleClose = () => {
    if (saving) return
    reset()
    onClose()
  }

  async function handleSave() {
    setError(null)
    if (!familyId) {
      setError('Choose a family.')
      return
    }
    if (!fullName.trim()) {
      setError('Enter the child’s full name.')
      return
    }

    setSaving(true)
    const { error: iErr } = await supabase.from('children').insert({
      family_id: familyId,
      full_name: fullName.trim(),
      birthdate: birthdate || null,
      notes: notes.trim() || null,
    })
    setSaving(false)
    if (iErr) {
      setError(iErr.message)
      return
    }

    onSaved()
    handleClose()
  }

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>Add child</DialogTitle>
      <DialogContent dividers>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            size="small"
            select
            label="Family"
            value={familyId}
            onChange={(e) => setFamilyId(e.target.value)}
            required
            fullWidth
          >
            {families.map((f) => (
              <MenuItem key={f.id} value={f.id}>
                {f.name}
              </MenuItem>
            ))}
          </TextField>
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
            label="Birthdate"
            type="date"
            value={birthdate}
            onChange={(e) => setBirthdate(e.target.value)}
            fullWidth
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            size="small"
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            multiline
            minRows={3}
            fullWidth
          />
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void handleSave()} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
