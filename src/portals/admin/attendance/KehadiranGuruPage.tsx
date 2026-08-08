import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Box, Chip, Paper, TextField, Typography } from '@mui/material'
import { DataGrid, type GridCellParams, type GridColDef } from '@mui/x-data-grid'
import { DataGridSearchPanel } from '../../../components/DataGridSearchPanel'
import { todayIsoDateInWita } from '../../../lib/classStatus'
import { fetchAttendanceRoster } from '../../../lib/classroomTeacherAttendance'
import { matchesSearchTokens } from '../../../lib/matchesSearchTokens'
import type { ClassroomTeacherAttendanceListEntry } from '../../../types/classroomTeacherAttendance'
import { TeacherAttendanceDialog } from './TeacherAttendanceDialog'

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const

/** One row per teacher — the raw classroom_teacher-level rows only ever show up inside the modal. */
type TeacherRow = {
  teacherId: string
  teacherName: string
  classes: ClassroomTeacherAttendanceListEntry[]
}

function groupByTeacher(entries: ClassroomTeacherAttendanceListEntry[]): TeacherRow[] {
  const byTeacher = new Map<string, TeacherRow>()
  for (const entry of entries) {
    const existing = byTeacher.get(entry.teacherId)
    if (existing) {
      existing.classes.push(entry)
    } else {
      byTeacher.set(entry.teacherId, { teacherId: entry.teacherId, teacherName: entry.teacherName, classes: [entry] })
    }
  }
  const rows = [...byTeacher.values()]
  rows.sort((a, b) => a.teacherName.localeCompare(b.teacherName))
  return rows
}

function rowSearchBlob(row: TeacherRow): string {
  return `${row.teacherName} ${row.classes.map((c) => c.classroomLabel).join(' ')}`.toLowerCase()
}

/**
 * The admin correction surface, one row per teacher: how many of their classes are logged for
 * the selected date, at a glance. Tapping a row opens TeacherAttendanceDialog, which lists that
 * teacher's classes and lets an admin fill in or correct each one. Payroll itself stays a
 * manual process an admin runs off this data; nothing here computes pay.
 */
export function KehadiranGuruPage() {
  const [sessionDate, setSessionDate] = useState(() => todayIsoDateInWita())
  const [entries, setEntries] = useState<ClassroomTeacherAttendanceListEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 20 })
  const [keyword, setKeyword] = useState('')
  const [selectedTeacher, setSelectedTeacher] = useState<TeacherRow | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await fetchAttendanceRoster(sessionDate)
    setLoading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setEntries(result.data)
  }, [sessionDate])

  useEffect(() => {
    void load()
  }, [load])

  const teacherRows = useMemo(() => groupByTeacher(entries), [entries])

  const filteredRows = useMemo(
    () => teacherRows.filter((row) => matchesSearchTokens(rowSearchBlob(row), keyword)),
    [teacherRows, keyword],
  )

  const columns: GridColDef<TeacherRow>[] = useMemo(
    () => [
      {
        field: 'teacherName',
        headerName: 'Guru',
        width: 210,
        valueGetter: (_v, row) => `${row.teacherName} (${row.classes.length} kelas)`,
      },
      {
        field: 'summary',
        headerName: 'Ringkasan',
        flex: 1,
        width: 110,
        renderCell: (params) => {
          const total = params.row.classes.length
          const done = params.row.classes.filter((c) => c.status?.clockedOutAt).length
          return (
            <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
              <Chip
                size="small"
                label={`${done}/${total} Absen Kelas Terisi`}
                color={total > 0 && done === total ? 'success' : done > 0 ? 'warning' : 'default'}
                variant={done > 0 ? 'filled' : 'outlined'}
              />
            </Box>
          )
        },
      }
    ],
    [],
  )

  const handleCellClick = (params: GridCellParams<TeacherRow>) => {
    setSelectedTeacher(params.row)
    setDialogOpen(true)
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, mb: 0.5 }}>
        Kehadiran Guru
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Pilih guru untuk melihat jam masuk/selesai per kelas, dibandingkan jadwal. Perhitungan gaji tetap dilakukan
        manual dari data ini.
      </Typography>

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <TextField
          size="small"
          label="Tanggal"
          type="date"
          value={sessionDate}
          onChange={(e) => setSessionDate(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
      </Box>

      <DataGridSearchPanel
        keyword={keyword}
        onKeywordChange={setKeyword}
        onSubmit={(e) => {
          e.preventDefault()
          setPaginationModel((m) => ({ ...m, page: 0 }))
        }}
        onClear={() => {
          setKeyword('')
          setPaginationModel((m) => ({ ...m, page: 0 }))
        }}
        searchPlaceholder="Cari nama guru atau kelas…"
        loading={loading}
      />

      {error ? <Alert severity="error">{error}</Alert> : null}
      {!loading && teacherRows.length === 0 ? (
        <Typography color="text.secondary">Tidak ada kelas aktif untuk tanggal ini.</Typography>
      ) : (
        <Box sx={{ width: '100%', minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
            {loading ? 'Memuat…' : `${filteredRows.length} guru`}
          </Typography>
          <Paper sx={{ width: '100%', minWidth: 0, overflow: 'hidden', mt: error ? 2 : 0 }} variant="outlined">
            <DataGrid
              rows={filteredRows}
              columns={columns}
              getRowId={(row) => row.teacherId}
              loading={loading}
              paginationModel={paginationModel}
              onPaginationModelChange={setPaginationModel}
              pageSizeOptions={[...PAGE_SIZE_OPTIONS]}
              disableRowSelectionOnClick
              autoHeight
              onCellClick={handleCellClick}
              sx={{ border: 'none', '& .MuiDataGrid-cell': { cursor: 'pointer' } }}
            />
          </Paper>
        </Box>
      )}

      <TeacherAttendanceDialog
        open={dialogOpen}
        teacherName={selectedTeacher?.teacherName ?? ''}
        sessionDate={sessionDate}
        classes={selectedTeacher?.classes ?? []}
        onClose={() => setDialogOpen(false)}
        onSaved={() => void load()}
      />
    </Box>
  )
}
