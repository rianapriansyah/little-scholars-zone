import { useEffect, useMemo, useState } from 'react'
import CloseIcon from '@mui/icons-material/Close'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Typography,
} from '@mui/material'
import { formatDate } from '../lib/formatDate'
import { moveChildAttendances } from '../lib/learningPeriods'
import { periodState, periodStateChipProps } from '../lib/periodState'
import {
  ATTENDANCE_STATUS_LABELS,
  isAttendanceStatus,
  type ChildAttendanceRow,
  type LearningPeriodListEntry,
} from '../types/attendance'

/**
 * Pindahkan Absen: re-file days recorded against this period onto another period of the same
 * child and class. Before every period was entered, days could only land on whichever period was
 * open, so the days are right and only their period is wrong.
 *
 * Targets are limited to the same class by the caller — the attendance row's foreign key ties it
 * to (period, child, classroom), so a day cannot move to another class's period at all.
 *
 * Nothing is preselected: which days belong where is the admin's call, and moving the wrong one is
 * as easy to make as the mistake being fixed.
 */
export function MoveAttendanceDialog({
  open,
  period,
  attendances,
  targets,
  onClose,
  onMoved,
}: {
  open: boolean
  /** The period the days currently sit on. */
  period: LearningPeriodListEntry
  /** Its recorded days, newest first, as the card already holds them. */
  attendances: ChildAttendanceRow[]
  /** The child's other periods in the same class. */
  targets: LearningPeriodListEntry[]
  onClose: () => void
  /** Fires after a move, so both periods' quota and history reload. */
  onMoved: () => void
}) {
  const [targetId, setTargetId] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTargetId('')
    setSelected(new Set())
    setError(null)
  }, [open])

  const sortedTargets = useMemo(
    () => [...targets].sort((a, b) => a.periodNo - b.periodNo),
    [targets],
  )
  const target = sortedTargets.find((p) => p.id === targetId) ?? null

  /** Sakit days never count toward a quota, so only the rest can overfill the target. */
  const consumingSelected = attendances.filter(
    (row) => selected.has(row.id) && row.status !== 'sick',
  ).length
  const overfills = target !== null && consumingSelected > target.daysRemaining

  const allSelected = attendances.length > 0 && selected.size === attendances.length

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleMove() {
    if (!target || selected.size === 0) return
    setSaving(true)
    setError(null)
    const result = await moveChildAttendances([...selected], target.id)
    setSaving(false)
    if (!result.ok) return setError(result.error)
    onMoved()
    onClose()
  }

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        Pindahkan Absen
        <IconButton onClick={onClose} size="small" aria-label="Tutup" disabled={saving}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Pindahkan hari yang tercatat di Periode {period.periodNo} ke periode lain milik{' '}
          {period.childName} di kelas {period.classroomLabel}.
        </Typography>

        {error ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}

        <FormControl fullWidth size="small" sx={{ mb: 2 }}>
          <InputLabel id="move-attendance-target">Pindahkan ke</InputLabel>
          <Select
            labelId="move-attendance-target"
            label="Pindahkan ke"
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
          >
            {sortedTargets.map((option) => (
              <MenuItem key={option.id} value={option.id}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <span>
                    Periode {option.periodNo} · mulai {formatDate(option.startDate)}
                  </span>
                  <Chip size="small" {...periodStateChipProps(periodState(option))} />
                  <Chip size="small" variant="outlined" label={`Sisa ${option.daysRemaining} hari`} />
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={allSelected}
                indeterminate={selected.size > 0 && !allSelected}
                onChange={() =>
                  setSelected(allSelected ? new Set() : new Set(attendances.map((row) => row.id)))
                }
              />
            }
            label="Pilih semua"
          />
          <Typography variant="body2" color="text.secondary">
            {selected.size} dipilih
          </Typography>
        </Box>

        <Paper variant="outlined" sx={{ maxHeight: 320, overflowY: 'auto' }}>
          <List dense disablePadding>
            {attendances.map((row, index) => {
              const status = isAttendanceStatus(row.status) ? row.status : null
              return (
                <ListItem key={row.id} disablePadding divider={index < attendances.length - 1}>
                  <ListItemButton onClick={() => toggle(row.id)} dense>
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <Checkbox
                        edge="start"
                        size="small"
                        checked={selected.has(row.id)}
                        tabIndex={-1}
                        disableRipple
                      />
                    </ListItemIcon>
                    <ListItemText primary={formatDate(row.attendance_date)} />
                    <Chip
                      size="small"
                      variant="outlined"
                      label={status ? ATTENDANCE_STATUS_LABELS[status] : row.status}
                    />
                  </ListItemButton>
                </ListItem>
              )
            })}
          </List>
        </Paper>

        {overfills && target ? (
          <Alert severity="warning" sx={{ mt: 2 }}>
            Periode {target.periodNo} hanya punya sisa {target.daysRemaining} hari, tetapi{' '}
            {consumingSelected} hari yang dipilih memotong kuota (sakit tidak dihitung).
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>
          Batal
        </Button>
        <Button
          variant="contained"
          onClick={() => void handleMove()}
          disabled={saving || !target || selected.size === 0 || overfills}
        >
          {saving ? <CircularProgress size={20} /> : `Pindahkan (${selected.size})`}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
