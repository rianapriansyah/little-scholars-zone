import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import CloseIcon from '@mui/icons-material/Close'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import dayjs, { type Dayjs } from 'dayjs'
import { supabase } from '../../../lib/supabase'
import type { ChildRow } from '../../../types/child'
import type { FamilyRow } from '../../../types/family'
import { uploadProfilePhoto } from '../../../lib/uploadProfilePhoto'
import { formatAge } from '../../../lib/calculateAge'
import { DISPLAY_DATE_FORMAT, formatDate } from '../../../lib/formatDate'
import { FormPanel, FormSection } from '../../../components/FormSection'
import { ResponsiveTableContainer } from '../../../components/ResponsiveTableContainer'
import { ChildPeriodsSection } from './ChildPeriodsSection'

export type ChildDetailEditFormHandle = {
  save: () => Promise<void>
}

type Group = { id: string; classroomId: string; label: string }

/** One row of the child's classroom history — the open one (ended_at null) is the current class. */
type Enrollment = {
  id: string
  groupId: string
  groupLabel: string
  startedAt: string
  endedAt: string | null
  endReason: string | null
}

type Props = {
  /** null = create mode: Simpan inserts a new child into `family`. Periods and classes need a
   *  saved child, so those sections stay locked until the first save. */
  child: ChildRow | null
  /** Owner of the child — the learning period dialog needs it to price a new period. */
  family: FamilyRow
  onSaved: () => void
  /** Create mode only: the freshly inserted row, so the caller can switch to editing it. */
  onCreated?: (child: ChildRow) => void
  hideActions?: boolean
  onBusyChange?: (busy: { saving: boolean }) => void
}

export const ChildDetailEditForm = forwardRef<ChildDetailEditFormHandle, Props>(function ChildDetailEditForm(
  { child, family, onSaved, onCreated, hideActions = false, onBusyChange },
  ref,
) {
  const [fullName, setFullName] = useState('')
  const [birthPlace, setBirthPlace] = useState('')
  const [birthdate, setBirthdate] = useState<Dayjs | null>(null)
  const [notes, setNotes] = useState('')
  const [active, setActive] = useState(true)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [groups, setGroups] = useState<Group[]>([])
  const [enrollments, setEnrollments] = useState<Enrollment[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [endReason, setEndReason] = useState('')
  const [enrolling, setEnrolling] = useState(false)
  const [enrollOpen, setEnrollOpen] = useState(false)
  /** Classrooms this child holds a learning period in — the only ones offered for enrolment. */
  const [periodClassroomIds, setPeriodClassroomIds] = useState<Set<string>>(new Set())

  const current = enrollments.find((e) => e.endedAt === null) ?? null
  const enrollOptions = groups.filter((g) => g.id !== current?.groupId && periodClassroomIds.has(g.classroomId))

  const loadEnrollments = async (childId: string) => {
    const { data } = await supabase
      .from('children_classrooms')
      .select(
        'id, classroom_teacher_id, started_at, ended_at, end_reason, classroom_teachers(classrooms(label), teachers(full_name))',
      )
      .eq('child_id', childId)
      .order('started_at', { ascending: false })
    setEnrollments(
      (data ?? []).map((row) => {
        const group = row.classroom_teachers as unknown as
          | { classrooms: { label: string } | null; teachers: { full_name: string } | null }
          | null
        return {
          id: row.id,
          groupId: row.classroom_teacher_id,
          groupLabel: group ? `${group.classrooms?.label ?? '—'} (${group.teachers?.full_name ?? '—'})` : '—',
          startedAt: row.started_at,
          endedAt: row.ended_at,
          endReason: row.end_reason,
        }
      }),
    )
  }

  useEffect(() => {
    setFullName(child?.full_name ?? '')
    setBirthPlace(child?.birth_place ?? '')
    setBirthdate(child?.birthdate ? dayjs(child.birthdate) : null)
    setNotes(child?.notes ?? '')
    setActive(child?.active ?? true)
    setPhotoFile(null)
    setPhotoPreviewUrl(child?.photo_url ?? null)
    setError(null)
    setSelectedGroupId('')
    setEndReason('')
    setEnrollments([])

    if (!child) return

    void supabase
      .from('classroom_teachers')
      .select('id, classroom_id, classrooms(label, is_billable), teachers(full_name)')
      .then(({ data }) => {
        // Enrolling a child only ever makes sense into a real fee-paying program — never into
        // an internal work program (cleaning duty, content creation) that reuses the classroom
        // table (see 20260815010000_classrooms_billable_and_flexi_hours.sql).
        const options: Group[] = (data ?? [])
          .filter((row) => (row.classrooms as unknown as { is_billable: boolean } | null)?.is_billable)
          .map((row) => {
            const classroom = row.classrooms as unknown as { label: string } | null
            const teacher = row.teachers as unknown as { full_name: string } | null
            return {
              id: row.id,
              classroomId: row.classroom_id,
              label: `${classroom?.label ?? '—'} (${teacher?.full_name ?? '—'})`,
            }
          })
        setGroups(options)
      })
    void loadEnrollments(child.id)
  }, [child])

  useEffect(() => {
    onBusyChange?.({ saving })
  }, [saving, onBusyChange])

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoFile(file)
    setPhotoPreviewUrl(URL.createObjectURL(file))
  }

  async function handleSave() {
    setError(null)
    if (!fullName.trim()) {
      setError('Masukkan nama lengkap siswa.')
      return
    }

    setSaving(true)

    let photoUrl = child?.photo_url ?? null
    if (photoFile) {
      try {
        photoUrl = await uploadProfilePhoto('child-photos', 'children', photoFile)
      } catch (e) {
        setSaving(false)
        setError(e instanceof Error ? e.message : 'Gagal mengunggah foto.')
        return
      }
    }

    const fields = {
      full_name: fullName.trim(),
      birth_place: birthPlace.trim() || null,
      birthdate: birthdate?.isValid() ? birthdate.format('YYYY-MM-DD') : null,
      notes: notes.trim() || null,
      active,
      photo_url: photoUrl,
    }

    if (child) {
      const { error: uErr } = await supabase.from('children').update(fields).eq('id', child.id)
      setSaving(false)
      if (uErr) {
        setError(uErr.message)
        return
      }
      onSaved()
      return
    }

    const { data: created, error: iErr } = await supabase
      .from('children')
      .insert({ ...fields, family_id: family.id })
      .select()
      .single()
    setSaving(false)
    if (iErr) {
      setError(iErr.message)
      return
    }
    onSaved()
    onCreated?.(created)
  }

  useImperativeHandle(ref, () => ({
    save: () => handleSave(),
  }))

  /** Re-reads the child's periods on every open: one may have just been added in the Periode
   *  Belajar section above, which keeps its own state. */
  async function openEnrollDialog() {
    if (!child) return
    setEnrollOpen(true)
    const { data, error: qErr } = await supabase
      .from('learning_periods')
      .select('classroom_id')
      .eq('child_id', child.id)
    if (qErr) {
      setError(qErr.message)
      return
    }
    setPeriodClassroomIds(new Set((data ?? []).map((row) => row.classroom_id)))
  }

  function closeEnrollDialog() {
    if (enrolling) return
    setEnrollOpen(false)
    setSelectedGroupId('')
    setEndReason('')
  }

  async function handleEnroll() {
    if (!child || !selectedGroupId) return
    setEnrolling(true)
    setError(null)
    // Moving a child out of a class and into another is one server-side switch, so the old
    // enrollment is closed and the new one opened in the same transaction.
    const { error: rpcErr } = current
      ? await supabase.rpc('switch_classroom', {
          p_child_id: child.id,
          p_new_classroom_teacher_id: selectedGroupId,
          p_end_reason: endReason.trim() || undefined,
        })
      : await supabase.rpc('enroll_child_in_classroom', {
          p_child_id: child.id,
          p_classroom_teacher_id: selectedGroupId,
        })
    setEnrolling(false)
    if (rpcErr) {
      setError(rpcErr.message)
      return
    }
    setEnrollOpen(false)
    setSelectedGroupId('')
    setEndReason('')
    await loadEnrollments(child.id)
    onSaved()
  }

  const needsSaveHint = (
    <Typography variant="body2" color="text.secondary">
      Simpan Data Anak terlebih dahulu.
    </Typography>
  )

  return (
    <Box>
      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      <FormSection title="Data Anak">
        <FormPanel>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Avatar src={photoPreviewUrl ?? undefined} sx={{ width: 64, height: 64 }}>
              {fullName ? fullName.charAt(0).toUpperCase() : '?'}
            </Avatar>
            <Button variant="outlined" component="label" size="small">
              Unggah Foto
              <input type="file" accept="image/*" hidden onChange={handlePhotoChange} />
            </Button>
          </Box>

          <TextField
            size="small"
            label="Nama Lengkap"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            fullWidth
          />
          <TextField
            size="small"
            label="Tempat Lahir"
            value={birthPlace}
            onChange={(e) => setBirthPlace(e.target.value)}
            fullWidth
          />
          <DatePicker
            label="Tanggal Lahir"
            value={birthdate}
            onChange={setBirthdate}
            format={DISPLAY_DATE_FORMAT}
            slotProps={{ textField: { size: 'small', fullWidth: true } }}
          />
          {formatAge(birthdate) ? (
            <Typography variant="body2" color="text.secondary">
              Usia: {formatAge(birthdate)}
            </Typography>
          ) : null}
          <TextField
            size="small"
            label="Catatan"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            multiline
            minRows={3}
            fullWidth
          />

          <FormControlLabel
            control={<Switch checked={active} onChange={(e) => setActive(e.target.checked)} />}
            label="Saat ini terdaftar di pusat"
          />

          {hideActions ? null : (
            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="contained" onClick={() => void handleSave()} disabled={saving || !fullName.trim()}>
                {saving ? 'Menyimpan…' : 'Simpan'}
              </Button>
            </Box>
          )}
        </FormPanel>
      </FormSection>

      <FormSection title="Periode Belajar">
        <FormPanel>{child ? <ChildPeriodsSection child={child} family={family} /> : needsSaveHint}</FormPanel>
      </FormSection>

      <FormSection title="Pendaftaran Kelas">
        <FormPanel>
          {!child ? (
            needsSaveHint
          ) : (
            <>
              {enrollments.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Belum terdaftar di kelas manapun.
                </Typography>
              ) : (
                <ResponsiveTableContainer>
                  <Table size="small" sx={{ minWidth: 560 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell>Kelas</TableCell>
                        <TableCell>Mulai</TableCell>
                        <TableCell>Selesai</TableCell>
                        <TableCell>Alasan</TableCell>
                        <TableCell>Status</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {enrollments.map((enrollment) => (
                        <TableRow key={enrollment.id} hover>
                          <TableCell>{enrollment.groupLabel}</TableCell>
                          <TableCell>{formatDate(enrollment.startedAt)}</TableCell>
                          <TableCell>{formatDate(enrollment.endedAt)}</TableCell>
                          <TableCell>{enrollment.endReason ?? '—'}</TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={enrollment.endedAt ? 'Selesai' : 'Aktif'}
                              color={enrollment.endedAt ? 'default' : 'success'}
                              variant={enrollment.endedAt ? 'outlined' : 'filled'}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ResponsiveTableContainer>
              )}

              <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button variant="contained" size="small" onClick={() => void openEnrollDialog()}>
                  Daftarkan
                </Button>
              </Box>
            </>
          )}
        </FormPanel>
      </FormSection>

      <Dialog open={enrollOpen} onClose={closeEnrollDialog} fullWidth maxWidth="sm">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          {current ? 'Pindah Kelas' : 'Daftarkan ke Kelas'}
          <IconButton onClick={closeEnrollDialog} disabled={enrolling} size="small" aria-label="Tutup">
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {current ? `Saat ini di: ${current.groupLabel}` : 'Belum terdaftar di kelas manapun.'}
            </Typography>
            <TextField
              size="small"
              select
              label="Daftarkan ke Kelas Periode Belajar"
              value={selectedGroupId}
              onChange={(e) => setSelectedGroupId(e.target.value)}
              fullWidth
              disabled={enrollOptions.length === 0}
              helperText={
                enrollOptions.length === 0
                  ? 'Belum ada kelas dengan periode belajar untuk anak ini. Tambah periode dulu di bagian Periode Belajar.'
                  : undefined
              }
            >
              {enrollOptions.map((g) => (
                <MenuItem key={g.id} value={g.id}>
                  {g.label}
                </MenuItem>
              ))}
            </TextField>
            {current ? (
              <TextField
                size="small"
                label="Alasan pindah (opsional)"
                value={endReason}
                onChange={(e) => setEndReason(e.target.value)}
                fullWidth
              />
            ) : null}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={closeEnrollDialog} disabled={enrolling}>
            Batal
          </Button>
          <Button variant="contained" onClick={() => void handleEnroll()} disabled={!selectedGroupId || enrolling}>
            {enrolling ? 'Menyimpan…' : current ? 'Pindah Kelas' : 'Daftarkan'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
})
