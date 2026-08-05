import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Box, Chip, Paper, TextField, Typography } from '@mui/material'
import { DataGrid, type GridCellParams, type GridColDef } from '@mui/x-data-grid'
import { DataGridSearchPanel } from '../../../components/DataGridSearchPanel'
import { todayIsoDateInWita, witaWallClockTime } from '../../../lib/classStatus'
import { fetchAttendanceRoster } from '../../../lib/classroomTeacherAttendance'
import { matchesSearchTokens } from '../../../lib/matchesSearchTokens'
import {
  ARRIVAL_STATUS_LABELS,
  DEPARTURE_STATUS_LABELS,
  type ClassroomTeacherAttendanceListEntry,
} from '../../../types/classroomTeacherAttendance'
import { ClassroomTeacherAttendanceDialog } from './ClassroomTeacherAttendanceDialog'

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const

function rowSearchBlob(row: ClassroomTeacherAttendanceListEntry): string {
  return `${row.classroomLabel} ${row.teacherName}`.toLowerCase()
}

/**
 * The admin correction surface: one row per active classroom_teacher on the selected date,
 * whether or not anyone has logged anything for it yet — a forgotten punch shows up as a gap
 * ("Belum Absen…") rather than being silently missing from the list. Payroll itself stays a
 * manual process an admin runs off this data; nothing here computes pay.
 */
export function KehadiranGuruPage() {
  const [sessionDate, setSessionDate] = useState(() => todayIsoDateInWita())
  const [rows, setRows] = useState<ClassroomTeacherAttendanceListEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 20 })
  const [keyword, setKeyword] = useState('')
  const [editEntry, setEditEntry] = useState<ClassroomTeacherAttendanceListEntry | null>(null)
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
    setRows(result.data)
  }, [sessionDate])

  useEffect(() => {
    void load()
  }, [load])

  const filteredRows = useMemo(
    () => rows.filter((row) => matchesSearchTokens(rowSearchBlob(row), keyword)),
    [rows, keyword],
  )

  const columns: GridColDef<ClassroomTeacherAttendanceListEntry>[] = useMemo(
    () => [
      { field: 'classroomLabel', headerName: 'Kelas', flex: 1, minWidth: 160 },
      { field: 'teacherName', headerName: 'Guru', flex: 1, minWidth: 160 },
      {
        field: 'schedule',
        headerName: 'Jadwal',
        width: 120,
        valueGetter: (_v, row) => `${row.timeStart.slice(0, 5)}–${row.timeEnd.slice(0, 5)}`,
      },
      {
        field: 'arrival',
        headerName: 'Absen Masuk',
        width: 160,
        renderCell: (params) => {
          const status = params.row.status
          const arrival = status?.arrivalStatus ?? 'missing'
          return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, height: '100%' }}>
              <Chip
                size="small"
                label={ARRIVAL_STATUS_LABELS[arrival]}
                color={arrival === 'on_time' ? 'success' : arrival === 'late' ? 'warning' : 'default'}
                variant={arrival === 'missing' ? 'outlined' : 'filled'}
              />
              {status?.clockedInAt ? (
                <Typography variant="body2" color="text.secondary">
                  {witaWallClockTime(status.clockedInAt)}
                </Typography>
              ) : null}
            </Box>
          )
        },
      },
      {
        field: 'departure',
        headerName: 'Absen Selesai',
        width: 160,
        renderCell: (params) => {
          const status = params.row.status
          const departure = status?.departureStatus ?? 'missing'
          return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, height: '100%' }}>
              <Chip
                size="small"
                label={DEPARTURE_STATUS_LABELS[departure]}
                color={departure === 'on_time' ? 'success' : departure === 'early' ? 'warning' : 'default'}
                variant={departure === 'missing' ? 'outlined' : 'filled'}
              />
              {status?.clockedOutAt ? (
                <Typography variant="body2" color="text.secondary">
                  {witaWallClockTime(status.clockedOutAt)}
                </Typography>
              ) : null}
            </Box>
          )
        },
      },
      {
        field: 'minutesTaught',
        headerName: 'Durasi',
        width: 100,
        valueGetter: (_v, row) => (row.status?.minutesTaught != null ? `${row.status.minutesTaught}m` : '—'),
      },
    ],
    [],
  )

  const handleCellClick = (params: GridCellParams<ClassroomTeacherAttendanceListEntry>) => {
    setEditEntry(params.row)
    setDialogOpen(true)
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, mb: 0.5 }}>
        Kehadiran Guru
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Jam masuk/selesai per kelas, dibandingkan jadwal. Perhitungan gaji tetap dilakukan manual dari data ini.
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
      {!loading && rows.length === 0 ? (
        <Typography color="text.secondary">Tidak ada kelas aktif untuk tanggal ini.</Typography>
      ) : (
        <Box sx={{ width: '100%', minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
            {loading ? 'Memuat…' : `${filteredRows.length} kelas`}
          </Typography>
          <Paper sx={{ width: '100%', minWidth: 0, overflow: 'hidden', mt: error ? 2 : 0 }} variant="outlined">
            <DataGrid
              rows={filteredRows}
              columns={columns}
              getRowId={(row) => row.classroomTeacherId}
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

      <ClassroomTeacherAttendanceDialog
        open={dialogOpen}
        sessionDate={sessionDate}
        entry={editEntry}
        onClose={() => setDialogOpen(false)}
        onSaved={() => void load()}
      />
    </Box>
  )
}
