import { useCallback, useEffect, useMemo, useState } from 'react'
import DownloadIcon from '@mui/icons-material/Download'
import { Alert, Box, Chip, Paper, TextField, Typography } from '@mui/material'
import { DataGrid, type GridCellParams, type GridColDef } from '@mui/x-data-grid'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { DataGridSearchPanel } from '../../../components/DataGridSearchPanel'
import { todayIsoDateInWita } from '../../../lib/classStatus'
import { fetchAttendanceRoster, groupAttendanceByTeacher, type TeacherAttendanceGroup } from '../../../lib/classroomTeacherAttendance'
import { matchesSearchTokens } from '../../../lib/matchesSearchTokens'
import { downloadTeacherAttendanceReport } from '../../../lib/teacherAttendanceReport'
import type { ClassroomTeacherAttendanceListEntry } from '../../../types/classroomTeacherAttendance'
import { TeacherAttendanceDialog } from './TeacherAttendanceDialog'

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const

/** One row per teacher — the raw classroom_teacher-level rows only ever show up inside the modal. */
type TeacherRow = TeacherAttendanceGroup

function rowSearchBlob(row: TeacherRow): string {
  return `${row.teacherName} ${row.classes.map((c) => c.classroomLabel).join(' ')}`.toLowerCase()
}

/**
 * The admin correction surface, one row per teacher: how many of their classes are logged for
 * the selected date, at a glance. Two different things happen depending on which column is
 * tapped — Guru confirms then downloads the monthly PDF, Ringkasan opens TeacherAttendanceDialog
 * to fill in or correct today's punches. Payroll itself stays a manual process an admin runs off
 * this data; nothing here computes pay.
 */
export function TeachersAttendancePage() {
  const [sessionDate, setSessionDate] = useState(() => todayIsoDateInWita())
  const [entries, setEntries] = useState<ClassroomTeacherAttendanceListEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 20 })
  const [keyword, setKeyword] = useState('')
  // Holds just the id, not the row object — TeacherAttendanceDialog is derived from the live
  // teacherRows below, so a save inside it (which reloads entries) is reflected immediately in
  // the arrival/departure chips instead of showing the snapshot from when the dialog was opened.
  const [selectedTeacherId, setSelectedTeacherId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [confirmDownloadTeacher, setConfirmDownloadTeacher] = useState<TeacherRow | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

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

  const teacherRows = useMemo(() => groupAttendanceByTeacher(entries), [entries])
  const selectedTeacher = teacherRows.find((row) => row.teacherId === selectedTeacherId) ?? null

  const filteredRows = useMemo(
    () => teacherRows.filter((row) => matchesSearchTokens(rowSearchBlob(row), keyword)),
    [teacherRows, keyword],
  )

  /** Always the current calendar month, regardless of the sessionDate picker above. */
  async function handleDownload(row: TeacherRow) {
    setDownloading(true)
    setDownloadError(null)
    const result = await downloadTeacherAttendanceReport({
      teacherName: row.teacherName,
      rate: row.teacherRate,
      classes: row.classes.map((c) => ({
        classroomTeacherId: c.classroomTeacherId,
        classroomLabel: c.classroomLabel,
      })),
    })
    setDownloading(false)
    if (!result.ok) setDownloadError(result.error)
  }

  const columns: GridColDef<TeacherRow>[] = useMemo(
    () => [
      {
        field: 'teacherName',
        headerName: 'Guru',
        flex: 1,
        minWidth: 200,
        valueGetter: (_v, row) => `${row.teacherName} (${row.classes.length} kelas)`,
        renderCell: (params) => (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, height: '100%', minWidth: 0 }}>
            <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
              {params.value as string}
            </Typography>
            {/* Hints that this column downloads, rather than opens, since it no longer has its
                own button to say so. */}
            <DownloadIcon fontSize="small" sx={{ color: 'text.disabled', flexShrink: 0 }} />
          </Box>
        ),
      },
      {
        field: 'summary',
        headerName: 'Ringkasan',
        width: 190,
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
      },
    ],
    [],
  )

  const handleCellClick = (params: GridCellParams<TeacherRow>) => {
    if (params.field === 'teacherName') {
      setConfirmDownloadTeacher(params.row)
      return
    }
    if (params.field === 'summary') {
      setSelectedTeacherId(params.row.teacherId)
      setDialogOpen(true)
    }
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, mb: 0.5 }}>
        Kehadiran Guru
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Klik nama guru untuk mengunduh laporan bulan ini, atau klik Ringkasan untuk mengisi/mengoreksi kehadiran
        tanggal yang dipilih. Perhitungan gaji tetap dilakukan manual dari data ini.
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
      {downloadError ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setDownloadError(null)}>
          {downloadError}
        </Alert>
      ) : null}
      {downloading ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          Menyiapkan PDF…
        </Alert>
      ) : null}
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

      <ConfirmDialog
        open={confirmDownloadTeacher !== null}
        title="Unduh Laporan Kehadiran"
        description={`Unduh laporan kehadiran bulan ini untuk ${confirmDownloadTeacher?.teacherName ?? ''}?`}
        confirmLabel="Unduh"
        confirmColor="primary"
        onCancel={() => setConfirmDownloadTeacher(null)}
        onConfirm={() => {
          if (confirmDownloadTeacher) void handleDownload(confirmDownloadTeacher)
          setConfirmDownloadTeacher(null)
        }}
      />

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
