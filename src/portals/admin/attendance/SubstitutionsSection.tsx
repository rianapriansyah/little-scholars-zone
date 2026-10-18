import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  MenuItem,
  Paper,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { supabase } from '../../../lib/supabase'
import { formatDate } from '../../../lib/formatDate'
import { teacherDisplayName } from '../../../lib/teacherName'
import { assignSubstitution, cancelSubstitution, fetchDefaultCountsForPay } from '../../../lib/substitutions'
import { SUBSTITUTION_SOURCE_LABELS } from '../../../types/substitution'
import type { SubstitutionListEntry } from '../../../types/substitution'
import type { TeacherRow } from '../../../types/teacher'
import type { ClassroomTeacherAttendanceListEntry } from '../../../types/classroomTeacherAttendance'

/**
 * Guru Pengganti for the date picked above: who covered whose class, and whether the day is
 * payable. Lives on Kehadiran Guru because coverage is a per-date fact about a class, which is
 * exactly what this screen already is — the alternative, the classroom detail page, has no date
 * axis and is about permanent assignment, the thing coverage exists to avoid.
 *
 * Payroll stays manual, as the page header says: this list is what an admin pays coverage from.
 */
export function SubstitutionsSection({
  sessionDate,
  entries,
  substitutions,
  loading,
  onChanged,
}: {
  sessionDate: string
  /** Every active group for this date — the roster this screen already loaded. */
  entries: ClassroomTeacherAttendanceListEntry[]
  /** Owned by the page, which also hands it to TeacherAttendanceDialog — one source of truth. */
  substitutions: SubstitutionListEntry[]
  loading: boolean
  onChanged: () => void
}) {
  const [teachers, setTeachers] = useState<TeacherRow[]>([])
  const [error, setError] = useState<string | null>(null)

  const [adding, setAdding] = useState(false)
  const [groupId, setGroupId] = useState('')
  const [substituteId, setSubstituteId] = useState('')
  const [reason, setReason] = useState('')
  const [countsForPay, setCountsForPay] = useState(false)
  /** Set once the server has answered for this pairing, so the switch isn't a guess. */
  const [payDerived, setPayDerived] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState<SubstitutionListEntry | null>(null)

  useEffect(() => {
    void supabase
      .from('teachers')
      .select('*')
      .eq('active', true)
      .order('full_name')
      .then(({ data }) => setTeachers(data ?? []))
  }, [])

  // The pay default is the server's rule (default_counts_for_pay), asked for as soon as there is a
  // pairing to ask about — the admin overrides it by flipping the switch, never the other way
  // round, so the two can't quietly disagree.
  useEffect(() => {
    if (!groupId || !substituteId) {
      setPayDerived(false)
      return
    }
    let cancelled = false
    setPayDerived(false)
    void fetchDefaultCountsForPay({
      classroomTeacherId: groupId,
      substituteTeacherId: substituteId,
    }).then((result) => {
      if (cancelled || !result.ok) return
      setCountsForPay(result.data)
      setPayDerived(true)
    })
    return () => {
      cancelled = true
    }
  }, [groupId, substituteId])

  const coveredGroupIds = useMemo(
    () => new Set(substitutions.map((entry) => entry.classroomTeacherId)),
    [substitutions],
  )

  /** Groups still available to cover on this date, with the assigned teacher named. */
  const groupOptions = useMemo(
    () => entries.filter((entry) => !coveredGroupIds.has(entry.classroomTeacherId)),
    [entries, coveredGroupIds],
  )

  const selectedGroup = entries.find((entry) => entry.classroomTeacherId === groupId) ?? null
  /** The class's own teacher can't stand in for herself — the DB trigger refuses it too. */
  const substituteOptions = teachers.filter((teacher) => teacher.id !== selectedGroup?.teacherId)

  function resetForm() {
    setAdding(false)
    setGroupId('')
    setSubstituteId('')
    setReason('')
    setCountsForPay(false)
    setPayDerived(false)
  }

  async function handleSave() {
    if (!groupId || !substituteId) return
    setSaving(true)
    setError(null)
    const result = await assignSubstitution({
      classroomTeacherId: groupId,
      substituteTeacherId: substituteId,
      sessionDate,
      countsForPay,
      reason,
    })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    resetForm()
    onChanged()
  }

  async function handleCancel() {
    const entry = confirmCancel
    if (!entry) return
    setSaving(true)
    setError(null)
    const result = await cancelSubstitution(entry.id)
    setSaving(false)
    setConfirmCancel(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onChanged()
  }

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1 }}>
        <Typography variant="subtitle1">Guru Pengganti</Typography>
        {!adding ? (
          <Button size="small" variant="outlined" onClick={() => setAdding(true)} disabled={groupOptions.length === 0}>
            Tambah
          </Button>
        ) : null}
      </Box>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      {loading ? (
        <Typography variant="body2" color="text.secondary">
          Memuat…
        </Typography>
      ) : substitutions.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Tidak ada guru pengganti pada {formatDate(sessionDate)}.
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {substitutions.map((entry) => (
            <Paper key={entry.id} variant="outlined" sx={{ p: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0 }}>
                  <strong>{entry.classroomLabel}</strong> · kelas {entry.absentTeacherName} → digantikan{' '}
                  <strong>{entry.substituteTeacherName}</strong>
                </Typography>
                <Chip
                  size="small"
                  variant="outlined"
                  color={entry.countsForPay ? 'success' : 'default'}
                  label={entry.countsForPay ? 'Dibayar' : 'Tidak dibayar'}
                />
                <Chip
                  size="small"
                  variant="outlined"
                  label={SUBSTITUTION_SOURCE_LABELS[entry.source] ?? entry.source}
                />
                <Button size="small" color="error" disabled={saving} onClick={() => setConfirmCancel(entry)}>
                  Batalkan
                </Button>
              </Box>
              {entry.reason ? (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                  {entry.reason}
                </Typography>
              ) : null}
            </Paper>
          ))}
        </Box>
      )}

      {adding ? (
        <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <TextField
            select
            size="small"
            label="Kelas yang digantikan"
            value={groupId}
            onChange={(e) => {
              setGroupId(e.target.value)
              setSubstituteId('')
            }}
            fullWidth
          >
            {groupOptions.map((entry) => (
              <MenuItem key={entry.classroomTeacherId} value={entry.classroomTeacherId}>
                {entry.classroomLabel} · {entry.teacherName}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            size="small"
            label="Guru pengganti"
            value={substituteId}
            onChange={(e) => setSubstituteId(e.target.value)}
            fullWidth
            disabled={!groupId}
          >
            {substituteOptions.map((teacher) => (
              <MenuItem key={teacher.id} value={teacher.id}>
                {teacherDisplayName(teacher)}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            size="small"
            label="Alasan (opsional)"
            placeholder="Contoh: izin sakit"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            fullWidth
          />

          <FormControlLabel
            control={
              <Switch
                checked={countsForPay}
                disabled={!payDerived}
                onChange={(e) => setCountsForPay(e.target.checked)}
              />
            }
            label="Dibayar"
          />
          {payDerived ? (
            <Typography variant="caption" color="text.secondary">
              {countsForPay
                ? 'Guru ini tidak mengajar di kelas tersebut, jadi hari ini dihitung sebagai tambahan.'
                : 'Guru ini sudah mengajar di kelas yang sama, jadi tidak ada tambahan bayar.'}
            </Typography>
          ) : null}

          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              variant="contained"
              size="small"
              disabled={!groupId || !substituteId || saving}
              onClick={() => void handleSave()}
            >
              {saving ? 'Menyimpan…' : 'Simpan'}
            </Button>
            <Button size="small" onClick={resetForm} disabled={saving}>
              Batal
            </Button>
          </Box>
        </Box>
      ) : null}

      <ConfirmDialog
        open={confirmCancel !== null}
        title="Batalkan Guru Pengganti"
        description={
          confirmCancel
            ? `${confirmCancel.substituteTeacherName} tidak lagi tercatat menggantikan ${confirmCancel.classroomLabel} pada ${formatDate(confirmCancel.sessionDate)}. Absensi dan catatan yang sudah diisi tetap tersimpan, tapi guru tersebut tidak bisa mengubahnya lagi.`
            : ''
        }
        confirmLabel="Batalkan"
        onConfirm={() => void handleCancel()}
        onCancel={() => setConfirmCancel(null)}
      />
    </Paper>
  )
}
