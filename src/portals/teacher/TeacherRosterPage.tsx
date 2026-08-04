import { useEffect, useState } from 'react'
import { Alert, Box, Card, CardContent, Chip, CircularProgress, List, ListItem, ListItemText, Typography } from '@mui/material'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useTeacherProfile } from '../../hooks/useTeacherProfile'
import type { ClassroomRow } from '../../types/classroom'
import {
  formatWitaDayAndDate,
  getClassStatus,
  getTodaysClassEndInWita,
  getTodaysClassStartInWita,
  type ClassStatusBorder,
} from '../../lib/classStatus'
import { MAX_STUDENTS_PER_TEACHER } from '../../lib/enrollmentLimits'

type GroupWithRoster = {
  id: string
  classroom: ClassroomRow
  roster: { childId: string; childName: string }[]
}

const STATUS_BORDER_COLOR: Record<ClassStatusBorder, string | undefined> = {
  green: 'success.main',
  red: 'error.main',
  yellow: 'warning.main',
  default: undefined,
}

/** Live-updating check of every 30s so the border/label advance without a page reload. */
function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

export function TeacherRosterPage() {
  const { user } = useAuth()
  const { teacher } = useTeacherProfile(user?.id)
  const [groups, setGroups] = useState<GroupWithRoster[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const now = useNow()

  useEffect(() => {
    if (!teacher) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      const { data: groupRows, error: gError } = await supabase
        .from('classroom_teachers')
        .select('id, classrooms(*)')
        .eq('teacher_id', teacher.id)
      if (gError) {
        if (!cancelled) {
          setError(gError.message)
          setLoading(false)
        }
        return
      }

      const results: GroupWithRoster[] = []
      for (const group of groupRows ?? []) {
        const classroom = group.classrooms as unknown as ClassroomRow | null
        if (!classroom) continue
        const { data: enrollmentRows } = await supabase
          .from('children_classrooms')
          .select('child_id, children(full_name)')
          .eq('classroom_teacher_id', group.id)
          .is('ended_at', null)
        const roster = (enrollmentRows ?? []).map((row) => {
          const child = row.children as unknown as { full_name: string } | null
          return { childId: row.child_id, childName: child?.full_name ?? '—' }
        })
        results.push({ id: group.id, classroom, roster })
      }
      results.sort((a, b) => a.classroom.label.localeCompare(b.classroom.label))

      if (!cancelled) {
        setGroups(results)
        setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [teacher])

  if (!teacher || loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="40vh">
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, mb: 0.5 }}>
        Selamat Bekerja, {teacher.full_name}
      </Typography>
      {/* Driven by `now`, which ticks every 30s, so the date rolls over without a reload. */}
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Kelas hari ini, {formatWitaDayAndDate(now)}
      </Typography>

      {error ? <Alert severity="error">{error}</Alert> : null}

      {groups.length === 0 ? (
        <Typography color="text.secondary">Belum ada kelas yang ditetapkan.</Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {groups.map((group) => {
            const { classroom } = group
            const todaysStart = getTodaysClassStartInWita(classroom.time_start, now)
            const todaysEnd = getTodaysClassEndInWita(classroom.time_end, now)
            const status = todaysStart ? getClassStatus(todaysStart, now, todaysEnd) : null
            const borderColor = status ? STATUS_BORDER_COLOR[status.border] : undefined

            return (
              <Card
                key={group.id}
                variant="outlined"
                sx={borderColor ? { borderColor, borderWidth: 2 } : undefined}
              >
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <Typography variant="h6" sx={{ fontSize: '1.1rem' }}>
                      {classroom.label}
                    </Typography>
                    {status?.label ? (
                      <Chip
                        size="small"
                        label={status.label}
                        // Only the in-progress state is green; "Kelas selesai" must read as neutral.
                        color={status.border === 'green' ? 'success' : 'default'}
                        variant="outlined"
                      />
                    ) : null}
                  </Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    Sen–Jum · {classroom.time_start.slice(0, 5)}
                    {classroom.time_end ? `–${classroom.time_end.slice(0, 5)}` : ''} · {group.roster.length}/
                    {MAX_STUDENTS_PER_TEACHER} siswa
                  </Typography>
                  {group.roster.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      Belum ada siswa yang terdaftar.
                    </Typography>
                  ) : (
                    <List dense disablePadding>
                      {group.roster.map((r) => (
                        <ListItem key={r.childId} disableGutters>
                          <ListItemText primary={r.childName} />
                        </ListItem>
                      ))}
                    </List>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </Box>
      )}
    </Box>
  )
}
