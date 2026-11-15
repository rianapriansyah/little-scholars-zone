import { useCallback, useEffect, useState } from 'react'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { supabase } from '../../../lib/supabase'
import { teacherDisplayName } from '../../../lib/teacherName'
import {
  createWorkItemAssignment,
  deleteWorkItemAssignment,
  fetchWorkItemAssignments,
  type WorkItemAssignment,
} from '../../../lib/workItemAssignments'

type EmployeeOption = { id: string; name: string }

type Props = {
  workItemId: string
  /** Called after an assignment is added or removed, so the list's counts refresh. */
  onChanged: () => void
}

/**
 * Who does this work item, and when. Each row is an assignment people clock in against, paid at
 * this work item's rate and counted on its branch's payslip. Staff work has no class, so this is
 * where it is assigned (a class's teachers are assigned from the class's Penugasan tab).
 */
export function WorkItemAssignmentsSection({ workItemId, onChanged }: Props) {
  const [assignments, setAssignments] = useState<WorkItemAssignment[]>([])
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [employeeId, setEmployeeId] = useState('')
  const [timeStart, setTimeStart] = useState('08:00')
  const [timeEnd, setTimeEnd] = useState('10:00')
  const [isFlexi, setIsFlexi] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<WorkItemAssignment | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [assignmentsResult, employeesResult] = await Promise.all([
      fetchWorkItemAssignments(workItemId),
      supabase.from('employees').select('id, full_name, call_name').eq('active', true).order('full_name'),
    ])
    setLoading(false)
    if (!assignmentsResult.ok) {
      setError(assignmentsResult.error)
      return
    }
    if (employeesResult.error) {
      setError(employeesResult.error.message)
      return
    }
    setAssignments(assignmentsResult.data)
    setEmployees((employeesResult.data ?? []).map((e) => ({ id: e.id, name: teacherDisplayName(e) })))
  }, [workItemId])

  useEffect(() => {
    void load()
  }, [load])

  async function handleAdd() {
    if (!employeeId) {
      setError('Pilih guru atau staf.')
      return
    }
    setBusy(true)
    setError(null)
    const result = await createWorkItemAssignment(workItemId, { employeeId, timeStart, timeEnd, isFlexiHours: isFlexi })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setEmployeeId('')
    onChanged()
    void load()
  }

  async function handleRemove(assignment: WorkItemAssignment) {
    setConfirmRemove(null)
    setBusy(true)
    setError(null)
    const result = await deleteWorkItemAssignment(assignment)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onChanged()
    void load()
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Typography variant="subtitle2">Penugasan</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: -1 }}>
        Siapa yang mengerjakan item ini dan jamnya. Mereka absen masuk/keluar dari kartu di beranda guru.
      </Typography>
      {error ? (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      {loading ? (
        <Typography variant="body2" color="text.secondary">
          Memuat…
        </Typography>
      ) : assignments.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Belum ada yang ditugaskan.
        </Typography>
      ) : (
        <List dense disablePadding>
          {assignments.map((a) => (
            <ListItem
              key={a.id}
              disableGutters
              secondaryAction={
                <IconButton
                  edge="end"
                  size="small"
                  aria-label={`Lepas penugasan ${a.employeeName}`}
                  disabled={busy}
                  onClick={() => setConfirmRemove(a)}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              }
            >
              <ListItemText
                primary={a.employeeName}
                secondary={`${a.isFlexiHours ? 'Fleksibel' : `${a.timeStart.slice(0, 5)}–${a.timeEnd.slice(0, 5)}`} · ${a.clockInCount} hari absen`}
              />
            </ListItem>
          ))}
        </List>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr 1fr' }, gap: 1.5 }}>
        <TextField
          id="work-item-assignment-employee"
          select
          size="small"
          label="Guru / Staf"
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          fullWidth
        >
          {employees.map((e) => (
            <MenuItem key={e.id} value={e.id}>
              {e.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          id="work-item-assignment-start"
          size="small"
          label="Mulai"
          type="time"
          value={timeStart}
          onChange={(e) => setTimeStart(e.target.value)}
          slotProps={{ inputLabel: { shrink: true }, htmlInput: { step: 1800 } }}
        />
        <TextField
          id="work-item-assignment-end"
          size="small"
          label="Selesai"
          type="time"
          value={timeEnd}
          onChange={(e) => setTimeEnd(e.target.value)}
          slotProps={{ inputLabel: { shrink: true }, htmlInput: { step: 1800 } }}
        />
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
        <FormControlLabel
          control={<Switch id="work-item-assignment-flexi" checked={isFlexi} onChange={(e) => setIsFlexi(e.target.checked)} />}
          label="Jam Fleksibel"
        />
        <Button variant="outlined" onClick={() => void handleAdd()} disabled={busy || !employeeId}>
          Tambah Penugasan
        </Button>
      </Box>
      {isFlexi ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: -1 }}>
          Jam di atas hanya ditampilkan; absen masuk/keluar bisa kapan saja, dan tidak ada status telat atau pulang cepat.
        </Typography>
      ) : null}

      <ConfirmDialog
        open={confirmRemove !== null}
        title="Lepas penugasan?"
        description={`${confirmRemove?.employeeName ?? ''} tidak lagi ditugaskan ke item kerja ini.`}
        confirmLabel="Lepas"
        onCancel={() => setConfirmRemove(null)}
        onConfirm={() => {
          if (confirmRemove) void handleRemove(confirmRemove)
        }}
      />
    </Box>
  )
}
