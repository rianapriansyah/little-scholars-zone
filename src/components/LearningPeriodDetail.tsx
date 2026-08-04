import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Divider,
  List,
  ListItem,
  ListItemText,
  Paper,
  Typography,
} from '@mui/material'
import { fetchPeriod, fetchPeriodAttendances } from '../lib/learningPeriods'
import { ATTENDANCE_STATUS_LABELS, isAttendanceStatus } from '../types/attendance'
import type { AttendanceStatus, ChildAttendanceRow, LearningPeriodListEntry } from '../types/attendance'

const STATUS_COLOR: Record<AttendanceStatus, 'success' | 'warning' | 'info'> = {
  present: 'success',
  absent: 'warning',
  sick: 'info',
}

function StatTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, flex: '1 1 120px', minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {label}
      </Typography>
      <Typography variant="h6" sx={{ fontSize: '1.35rem', lineHeight: 1.2 }}>
        {value}
      </Typography>
      {hint ? (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      ) : null}
    </Paper>
  )
}

type Props = {
  periodId: string
  /**
   * Drop the child's name from the header. Set it where the surrounding screen already groups
   * by child — the parent portal lists a child once and their programs beneath — so the
   * program becomes the card's title instead of repeating the name on every card.
   */
  hideChildName?: boolean
}

/**
 * One child, one classroom, one period. Every number shown here comes from the
 * learning_period_status view — nothing is counted client-side, so this cannot drift from
 * what the quota logic believes.
 *
 * Shared by the teacher and admin portals; each supplies its own breadcrumbs around it.
 */
export function LearningPeriodDetail({ periodId, hideChildName = false }: Props) {
  const [period, setPeriod] = useState<LearningPeriodListEntry | null>(null)
  const [attendances, setAttendances] = useState<ChildAttendanceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [periodResult, attendanceResult] = await Promise.all([
      fetchPeriod(periodId),
      fetchPeriodAttendances(periodId),
    ])
    setLoading(false)
    if (!periodResult.ok) return setError(periodResult.error)
    if (!attendanceResult.ok) return setError(attendanceResult.error)
    setError(null)
    setPeriod(periodResult.data)
    setAttendances(attendanceResult.data)
  }, [periodId])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" py={6}>
        <CircularProgress />
      </Box>
    )
  }

  if (error || !period) {
    return <Alert severity="error">{error ?? 'Data tidak tersedia.'}</Alert>
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.5 }}>
        <Typography variant="h6" sx={{ fontSize: '1.1rem' }}>
          {hideChildName ? period.classroomLabel : period.childName}
        </Typography>
        <Chip
          size="small"
          label={period.isActive ? 'Berjalan' : 'Selesai'}
          color={period.isActive ? 'success' : 'default'}
          variant={period.isActive ? 'filled' : 'outlined'}
        />
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {hideChildName ? `Periode ${period.periodNo}` : `${period.classroomLabel} · Periode ${period.periodNo}`}
      </Typography>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mb: 2 }}>
        <StatTile label="Mulai" value={period.startDate} />
        <StatTile label="Terpakai" value={`${period.daysConsumed}/${period.guaranteedDays}`} hint="Hadir + alfa" />
        <StatTile label="Sisa" value={period.daysRemaining} hint="Hari dijamin" />
        <StatTile label="Sakit" value={period.daysSick} hint="Tidak memotong" />
      </Box>

      {period.projectedEndDate || period.actualEndDate ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {period.actualEndDate
            ? `Selesai pada ${period.actualEndDate}.`
            : `Perkiraan selesai ${period.projectedEndDate} — perkiraan kasar, bukan patokan.`}
        </Typography>
      ) : null}

      <Divider sx={{ mb: 1.5 }} />
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
        Riwayat Absensi ({attendances.length})
      </Typography>

      {attendances.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Belum ada absensi tercatat pada periode ini.
        </Typography>
      ) : (
        <Paper variant="outlined">
          <List disablePadding>
            {attendances.map((row, index) => {
              const status = isAttendanceStatus(row.status) ? row.status : null
              return (
                <ListItem key={row.id} divider={index < attendances.length - 1} sx={{ gap: 1 }}>
                  <ListItemText primary={row.attendance_date} secondary={row.note ?? undefined} />
                  {status ? (
                    <Chip
                      size="small"
                      variant="outlined"
                      color={STATUS_COLOR[status]}
                      label={ATTENDANCE_STATUS_LABELS[status]}
                    />
                  ) : (
                    <Chip size="small" variant="outlined" label={row.status} />
                  )}
                </ListItem>
              )
            })}
          </List>
        </Paper>
      )}
    </Box>
  )
}
