import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react'
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
  Paper,
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
import { teacherDisplayName } from '../../../lib/teacherName'
import { FormPanel, FormSection } from '../../../components/FormSection'
import { ResponsiveTableContainer } from '../../../components/ResponsiveTableContainer'
import { ChildPeriodsSection } from './ChildPeriodsSection'

export type ChildDetailEditFormHandle = {
  save: () => Promise<void>
}

/** One (classroom, teacher) pair a child can be enrolled into. */
type Group = { id: string; classroomId: string; classroomLabel: string; teacherName: string }

/** One row of the child's classroom history — the open one (ended_at null) is the current class. */
type Enrollment = {
  id: string
  groupId: string
  classroomId: string
  /** Classroom + teacher, for the history table where rows span programs. */
  groupLabel: string
  /** Teacher alone, for the per-program slot that already names the classroom above it. */
  teacherName: string
  startedAt: string
  endedAt: string | null
  endReason: string | null
}

/** A program (classroom) the child holds learning periods in — one enrollment slot each. */
type Program = { classroomId: string; classroomLabel: string; periodCount: number }

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
  /** Programs the child holds a learning period in — one enrollment slot is offered per program. */
  const [programs, setPrograms] = useState<Program[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [endReason, setEndReason] = useState('')
  const [enrolling, setEnrolling] = useState(false)
  /** The program whose enrollment dialog is open, plus the class the child sits in today. */
  const [enrollTarget, setEnrollTarget] = useState<{ program: Program; current: Enrollment | null } | null>(null)

  const childId = child?.id ?? null

  const loadEnrollments = useCallback(async (id: string) => {
    const { data } = await supabase
      .from('children_classrooms')
      .select(
        'id, classroom_teacher_id, started_at, ended_at, end_reason, classroom_teachers(classroom_id, classrooms(label), teachers(full_name, call_name))',
      )
      .eq('child_id', id)
      .order('started_at', { ascending: false })
    setEnrollments(
      (data ?? []).map((row) => {
        const group = row.classroom_teachers as unknown as
          | {
              classroom_id: string
              classrooms: { label: string } | null
              teachers: { full_name: string; call_name: string | null } | null
            }
          | null
        const teacherName = group?.teachers ? teacherDisplayName(group.teachers) : '—'
        return {
          id: row.id,
          groupId: row.classroom_teacher_id,
          classroomId: group?.classroom_id ?? '',
          groupLabel: group ? `${group.classrooms?.label ?? '—'} (${teacherName})` : '—',
          teacherName,
          startedAt: row.started_at,
          endedAt: row.ended_at,
          endReason: row.end_reason,
        }
      }),
    )
  }, [])

  /** One slot per program the child was sold — several periods in the same program are one slot. */
  const loadPrograms = useCallback(async (id: string) => {
    const { data, error: qErr } = await supabase
      .from('learning_periods')
      .select('classroom_id, classrooms(label)')
      .eq('child_id', id)
    if (qErr) {
      setError(qErr.message)
      return
    }
    const byClassroom = new Map<string, Program>()
    for (const row of data ?? []) {
      const existing = byClassroom.get(row.classroom_id)
      if (existing) {
        existing.periodCount += 1
        continue
      }
      byClassroom.set(row.classroom_id, {
        classroomId: row.classroom_id,
        classroomLabel: (row.classrooms as unknown as { label: string } | null)?.label ?? '—',
        periodCount: 1,
      })
    }
    setPrograms([...byClassroom.values()].sort((a, b) => a.classroomLabel.localeCompare(b.classroomLabel)))
  }, [])

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
    setPrograms([])

    if (!childId) return

    void supabase
      .from('classroom_teachers')
      .select('id, classroom_id, classrooms(label, is_billable), teachers(full_name, call_name)')
      .then(({ data }) => {
        // Enrolling a child only ever makes sense into a real fee-paying program — never into
        // an internal work program (cleaning duty, content creation) that reuses the classroom
        // table (see 20260815010000_classrooms_billable_and_flexi_hours.sql).
        const options: Group[] = (data ?? [])
          .filter((row) => (row.classrooms as unknown as { is_billable: boolean } | null)?.is_billable)
          .map((row) => {
            const classroom = row.classrooms as unknown as { label: string } | null
            const teacher = row.teachers as unknown as { full_name: string; call_name: string | null } | null
            return {
              id: row.id,
              classroomId: row.classroom_id,
              classroomLabel: classroom?.label ?? '—',
              teacherName: teacher ? teacherDisplayName(teacher) : '—',
            }
          })
        setGroups(options)
      })
    void loadEnrollments(childId)
    void loadPrograms(childId)
  }, [child, childId, loadEnrollments, loadPrograms])

  useEffect(() => {
    onBusyChange?.({ saving })
  }, [saving, onBusyChange])

  const classroomLabels = useMemo(
    () => new Map(groups.map((g) => [g.classroomId, g.classroomLabel])),
    [groups],
  )

  /**
   * One row per program: the slots the child's learning periods entitle them to, plus any
   * program they still sit in without holding a period there (so it stays manageable).
   */
  const slots = useMemo(() => {
    const rows = programs.map((program) => ({
      program,
      current: enrollments.find((e) => e.endedAt === null && e.classroomId === program.classroomId) ?? null,
    }))
    const covered = new Set(programs.map((p) => p.classroomId))
    for (const enrollment of enrollments) {
      if (enrollment.endedAt !== null || covered.has(enrollment.classroomId)) continue
      covered.add(enrollment.classroomId)
      rows.push({
        program: {
          classroomId: enrollment.classroomId,
          classroomLabel: classroomLabels.get(enrollment.classroomId) ?? enrollment.groupLabel,
          periodCount: 0,
        },
        current: enrollment,
      })
    }
    return rows
  }, [programs, enrollments, classroomLabels])

  const enrollOptions = enrollTarget
    ? groups.filter((g) => g.classroomId === enrollTarget.program.classroomId && g.id !== enrollTarget.current?.groupId)
    : []

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

  function closeEnrollDialog() {
    if (enrolling) return
    setEnrollTarget(null)
    setSelectedGroupId('')
    setEndReason('')
  }

  async function handleEnroll() {
    if (!child || !enrollTarget || !selectedGroupId) return
    setEnrolling(true)
    setError(null)
    // Moving a child out of a class and into another is one server-side switch, so the old
    // enrollment is closed and the new one opened in the same transaction. Both RPCs are
    // scoped to the target group's classroom, so the child's other programs are untouched.
    const { error: rpcErr } = enrollTarget.current
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
    setEnrollTarget(null)
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
        <FormPanel>
          {child ? (
            // A new period may open a program the child has no class in yet, so the enrollment
            // slots below have to be rebuilt whenever this section saves one.
            <ChildPeriodsSection
              child={child}
              family={family}
              onPeriodsChanged={() => void loadPrograms(child.id)}
            />
          ) : (
            needsSaveHint
          )}
        </FormPanel>
      </FormSection>

      <FormSection title="Pendaftaran Kelas">
        <FormPanel>
          {!child ? (
            needsSaveHint
          ) : (
            <>
              {/* One slot per program the child holds periods in: a child enrolled in both
                  Calistung and Mengaji needs a class in each, not one class overall. */}
              {slots.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Belum ada periode belajar. Tambah periode dulu di bagian Periode Belajar untuk bisa mendaftarkan
                  kelas.
                </Typography>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  {slots.map(({ program, current }) => (
                    // Everything stacks left under the classroom heading. The card is narrow
                    // inside the modal, so a heading/action row would only wrap into this
                    // shape anyway — stacking keeps it identical at every width.
                    <Paper
                      key={program.classroomId}
                      variant="outlined"
                      sx={{ p: 2, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.75 }}
                    >
                      <Box>
                        <Typography variant="subtitle2">{program.classroomLabel}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {program.periodCount > 0
                            ? `${program.periodCount} periode belajar`
                            : 'Tanpa periode belajar'}
                        </Typography>
                      </Box>
                      {/* Teacher only — the classroom is already the heading of this card. */}
                      {current ? (
                        <Chip size="small" color="success" label={current.teacherName} />
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          Belum terdaftar
                        </Typography>
                      )}
                      <Button
                        variant={current ? 'outlined' : 'contained'}
                        size="small"
                        onClick={() => {
                          setSelectedGroupId('')
                          setEndReason('')
                          setEnrollTarget({ program, current })
                        }}
                      >
                        {current ? 'Pindah Kelas' : 'Daftarkan'}
                      </Button>
                    </Paper>
                  ))}
                </Box>
              )}

              <Typography variant="subtitle2" sx={{ mt: 2 }}>
                Riwayat Kelas
              </Typography>
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
            </>
          )}
        </FormPanel>
      </FormSection>

      <Dialog open={enrollTarget !== null} onClose={closeEnrollDialog} fullWidth maxWidth="sm">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          {enrollTarget?.current ? 'Pindah Kelas' : 'Daftarkan ke Kelas'}
          <IconButton onClick={closeEnrollDialog} disabled={enrolling} size="small" aria-label="Tutup">
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Program: <strong>{enrollTarget?.program.classroomLabel ?? '—'}</strong>
              {' · '}
              {enrollTarget?.current ? `saat ini dengan ${enrollTarget.current.teacherName}` : 'belum terdaftar'}
            </Typography>
            {/* Only this program's groups: the class list is the teachers assigned to the
                classroom the learning period was sold in, never every class in the centre. */}
            <TextField
              size="small"
              select
              label="Guru / Kelas"
              value={selectedGroupId}
              onChange={(e) => setSelectedGroupId(e.target.value)}
              fullWidth
              disabled={enrollOptions.length === 0}
              helperText={
                enrollOptions.length === 0
                  ? `Belum ada guru lain yang ditetapkan untuk ${enrollTarget?.program.classroomLabel ?? 'program ini'}. Tetapkan guru dulu di halaman Kelas.`
                  : undefined
              }
            >
              {enrollOptions.map((g) => (
                <MenuItem key={g.id} value={g.id}>
                  {g.teacherName}
                </MenuItem>
              ))}
            </TextField>
            {enrollTarget?.current ? (
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
            {enrolling ? 'Menyimpan…' : enrollTarget?.current ? 'Pindah Kelas' : 'Daftarkan'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
})
