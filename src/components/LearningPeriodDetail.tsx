import { useCallback, useEffect, useState } from 'react'
import { Alert, Box, Button, Chip, CircularProgress, Divider, Typography } from '@mui/material'
import { formatDate } from '../lib/formatDate'
import { fetchPeriod, fetchPeriodAttendances } from '../lib/learningPeriods'
import type { ChildAttendanceRow, LearningPeriodListEntry } from '../types/attendance'
import { AddAttendanceDialog } from './AddAttendanceDialog'
import { AttendanceDetailDialog } from './AttendanceDetailDialog'
import { AttendanceHistoryList } from './AttendanceHistoryList'
import { StatTile } from './StatTile'

type Props = {
  periodId: string
  /**
   * Drop the child's name from the header. Set it where the surrounding screen already groups
   * by child — the parent portal lists a child once and their programs beneath — so the
   * program becomes the card's title instead of repeating the name on every card.
   */
  hideChildName?: boolean
  /**
   * Make each Riwayat Absensi row open AttendanceDetailDialog — that day's status, its note, and
   * the daily report filed against it.
   *
   * Opt-in rather than always on: this component is shared with the parent portal, and whether
   * parents see daily reports is a product decision that has not been taken yet (the columns are
   * readable to them at the API level either way, but nothing in the app shows them). Admin passes
   * it; teacher and parent are unchanged until asked.
   */
  attendanceDetail?: boolean
  /** Admin only: let a day that should never have been recorded be deleted from its dialog. */
  attendanceDelete?: boolean
  /**
   * Admin only: a Tambah Absen button on Riwayat Absensi, for filling a day nobody recorded at the
   * time. What it writes is attributed to Admin, not to the class's teacher.
   */
  attendanceAdd?: boolean
}

/**
 * One child, one classroom, one period. Every number shown here comes from the
 * learning_period_status view — nothing is counted client-side, so this cannot drift from
 * what the quota logic believes.
 *
 * Used by the teacher portal and, through ProgramPeriodCard, by the parent portal; each supplies
 * its own breadcrumbs around it. The admin period screen has its own card — see
 * LearningPeriodCard — because it leads with the period rather than the program.
 */
export function LearningPeriodDetail({
  periodId,
  hideChildName = false,
  attendanceDetail = false,
  attendanceDelete = false,
  attendanceAdd = false,
}: Props) {
  const [period, setPeriod] = useState<LearningPeriodListEntry | null>(null)
  const [attendances, setAttendances] = useState<ChildAttendanceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openAttendance, setOpenAttendance] = useState<ChildAttendanceRow | null>(null)
  const [addOpen, setAddOpen] = useState(false)

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
        <StatTile label="Mulai" value={formatDate(period.startDate)} />
        <StatTile label="Terpakai" value={`${period.daysConsumed}/${period.guaranteedDays}`} hint="Hadir + alfa" />
        <StatTile label="Sisa" value={period.daysRemaining} hint="Hari dijamin" />
        <StatTile label="Sakit" value={period.daysSick} hint="Tidak memotong" />
      </Box>

      {period.projectedEndDate || period.actualEndDate ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {period.actualEndDate
            ? `Selesai pada ${formatDate(period.actualEndDate)}.`
            : `Perkiraan selesai ${formatDate(period.projectedEndDate)} — perkiraan kasar, bukan patokan.`}
        </Typography>
      ) : null}

      <Divider sx={{ mb: 1.5 }} />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ flexGrow: 1, minWidth: 0 }}>
          Riwayat Absensi ({attendances.length})
          {attendanceDetail && attendances.length > 0 ? ' · klik satu tanggal untuk detailnya' : ''}
        </Typography>
        {attendanceAdd ? (
          <Button size="small" variant="outlined" onClick={() => setAddOpen(true)}>
            Tambah Absen
          </Button>
        ) : null}
      </Box>

      <AttendanceHistoryList
        attendances={attendances}
        onSelect={attendanceDetail ? (row) => setOpenAttendance(row) : undefined}
      />

      {openAttendance ? (
        <AttendanceDetailDialog
          open
          attendance={openAttendance}
          childId={period.childId}
          classroomId={period.classroomId}
          onClose={() => setOpenAttendance(null)}
          allowDelete={attendanceDelete}
          // Reloads the period too, not just the list: deleting a day hands it back to the quota,
          // so Terpakai/Sisa and the Selesai chip above are all stale the moment it succeeds.
          onDeleted={() => void load()}
        />
      ) : null}

      {attendanceAdd ? (
        <AddAttendanceDialog
          open={addOpen}
          childId={period.childId}
          childName={period.childName}
          classroomId={period.classroomId}
          onClose={() => setAddOpen(false)}
          // Same reasoning as onDeleted: recording a day draws down the quota, so Terpakai/Sisa
          // and the Selesai chip above are stale the moment it saves.
          onSaved={() => void load()}
        />
      ) : null}
    </Box>
  )
}
