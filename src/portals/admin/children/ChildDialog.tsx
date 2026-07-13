import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { supabase } from '../../../lib/supabase'
import type { ChildRow } from '../../../types/child'
import type { FamilyRow } from '../../../types/family'
import type { ClassroomRow } from '../../../types/classroom'

type CurrentEnrollment = { enrollmentId: string; classroomId: string; classroomLabel: string }

type Props = {
  open: boolean
  child: ChildRow | null
  onClose: () => void
  onSaved: () => void
}

export function ChildDialog({ open, child, onClose, onSaved }: Props) {
  const isEdit = child !== null

  const [families, setFamilies] = useState<FamilyRow[]>([])
  const [familyId, setFamilyId] = useState('')
  const [fullName, setFullName] = useState('')
  const [birthdate, setBirthdate] = useState('')
  const [notes, setNotes] = useState('')
  const [active, setActive] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [classrooms, setClassrooms] = useState<ClassroomRow[]>([])
  const [current, setCurrent] = useState<CurrentEnrollment | null>(null)
  const [selectedClassroomId, setSelectedClassroomId] = useState('')
  const [endReason, setEndReason] = useState('')
  const [enrolling, setEnrolling] = useState(false)

  const loadEnrollment = async (childId: string) => {
    const { data } = await supabase
      .from('children_classrooms')
      .select('id, classroom_id, classrooms(label)')
      .eq('child_id', childId)
      .is('ended_at', null)
      .maybeSingle()
    if (!data) {
      setCurrent(null)
      return
    }
    const classroom = data.classrooms as unknown as { label: string } | null
    setCurrent({ enrollmentId: data.id, classroomId: data.classroom_id, classroomLabel: classroom?.label ?? '—' })
  }

  useEffect(() => {
    if (!open) return
    setFullName(child?.full_name ?? '')
    setBirthdate(child?.birthdate ?? '')
    setNotes(child?.notes ?? '')
    setActive(child?.active ?? true)
    setFamilyId('')
    setError(null)
    setSelectedClassroomId('')
    setEndReason('')
    setCurrent(null)

    if (!child) {
      void supabase.from('families').select('*').order('name').then(({ data }) => setFamilies(data ?? []))
      return
    }

    void supabase.from('classrooms').select('*').eq('active', true).order('label').then(({ data }) => setClassrooms(data ?? []))
    void loadEnrollment(child.id)
  }, [open, child])

  const handleClose = () => {
    if (saving || enrolling) return
    onClose()
  }

  async function handleSave() {
    setError(null)
    if (!isEdit && !familyId) {
      setError('Choose a family.')
      return
    }
    if (!fullName.trim()) {
      setError('Enter the child’s full name.')
      return
    }

    setSaving(true)
    if (isEdit) {
      const { error: uErr } = await supabase
        .from('children')
        .update({
          full_name: fullName.trim(),
          birthdate: birthdate || null,
          notes: notes.trim() || null,
          active,
        })
        .eq('id', child.id)
      setSaving(false)
      if (uErr) {
        setError(uErr.message)
        return
      }
      onSaved()
    } else {
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
      onClose()
    }
  }

  async function handleEnroll() {
    if (!child || !selectedClassroomId) return
    setEnrolling(true)
    setError(null)
    const { error: rpcErr } = await supabase.rpc('enroll_child_in_classroom', {
      p_child_id: child.id,
      p_classroom_id: selectedClassroomId,
    })
    setEnrolling(false)
    if (rpcErr) {
      setError(rpcErr.message)
      return
    }
    setSelectedClassroomId('')
    await loadEnrollment(child.id)
    onSaved()
  }

  async function handleSwitch() {
    if (!child || !selectedClassroomId) return
    setEnrolling(true)
    setError(null)
    const { error: rpcErr } = await supabase.rpc('switch_classroom', {
      p_child_id: child.id,
      p_new_classroom_id: selectedClassroomId,
      p_end_reason: endReason.trim() || null,
    })
    setEnrolling(false)
    if (rpcErr) {
      setError(rpcErr.message)
      return
    }
    setSelectedClassroomId('')
    setEndReason('')
    await loadEnrollment(child.id)
    onSaved()
  }

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>{isEdit ? 'Edit child' : 'Add child'}</DialogTitle>
      <DialogContent dividers>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {!isEdit ? (
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
          ) : null}
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

          {isEdit ? (
            <>
              <FormControlLabel control={<Switch checked={active} onChange={(e) => setActive(e.target.checked)} />} label="Currently enrolled at center" />

              <Divider />
              <Typography variant="subtitle2">Classroom</Typography>
              <Typography variant="body2" color="text.secondary">
                {current ? `Currently in: ${current.classroomLabel}` : 'Not enrolled in a classroom.'}
              </Typography>
              <TextField
                size="small"
                select
                label={current ? 'Switch to classroom' : 'Enroll in classroom'}
                value={selectedClassroomId}
                onChange={(e) => setSelectedClassroomId(e.target.value)}
                fullWidth
              >
                {classrooms
                  .filter((c) => c.id !== current?.classroomId)
                  .map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.label}
                    </MenuItem>
                  ))}
              </TextField>
              {current ? (
                <TextField
                  size="small"
                  label="Reason for switching (optional)"
                  value={endReason}
                  onChange={(e) => setEndReason(e.target.value)}
                  fullWidth
                />
              ) : null}
              <Button
                variant="outlined"
                disabled={!selectedClassroomId || enrolling}
                onClick={() => void (current ? handleSwitch() : handleEnroll())}
              >
                {enrolling ? 'Saving…' : current ? 'Switch classroom' : 'Enroll'}
              </Button>
            </>
          ) : null}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={saving || enrolling}>
          {isEdit ? 'Close' : 'Cancel'}
        </Button>
        <Button variant="contained" onClick={() => void handleSave()} disabled={saving || enrolling}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
