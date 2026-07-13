import { useEffect, useState } from 'react'
import { Alert, Box, Card, CardContent, Chip, CircularProgress, List, ListItem, ListItemText, Typography } from '@mui/material'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useTeacherProfile } from '../../hooks/useTeacherProfile'
import type { ClassroomRow } from '../../types/classroom'
import { getClassStatus, getTodaysClassStartInWita, type ClassStatusBorder } from '../../lib/classStatus'

type ClassroomWithRoster = ClassroomRow & { roster: { childId: string; childName: string }[] }

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
  const [classrooms, setClassrooms] = useState<ClassroomWithRoster[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const now = useNow()

  useEffect(() => {
    if (!teacher) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      const { data: classroomRows, error: cError } = await supabase
        .from('classrooms')
        .select('*')
        .eq('teacher_id', teacher.id)
        .order('label')
      if (cError) {
        if (!cancelled) {
          setError(cError.message)
          setLoading(false)
        }
        return
      }

      const results: ClassroomWithRoster[] = []
      for (const classroom of classroomRows ?? []) {
        const { data: enrollmentRows } = await supabase
          .from('children_classrooms')
          .select('child_id, children(full_name)')
          .eq('classroom_id', classroom.id)
          .is('ended_at', null)
        const roster = (enrollmentRows ?? []).map((row) => {
          const child = row.children as unknown as { full_name: string } | null
          return { childId: row.child_id, childName: child?.full_name ?? '—' }
        })
        results.push({ ...classroom, roster })
      }

      if (!cancelled) {
        setClassrooms(results)
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
      <Typography variant="h5" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, mb: 2 }}>
        My classrooms
      </Typography>

      {error ? <Alert severity="error">{error}</Alert> : null}

      {classrooms.length === 0 ? (
        <Typography color="text.secondary">No classrooms assigned yet.</Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {classrooms.map((classroom) => {
            const todaysStart = getTodaysClassStartInWita(classroom.days_of_week, classroom.time_start, now)
            const status = todaysStart ? getClassStatus(todaysStart, now) : null
            const borderColor = status ? STATUS_BORDER_COLOR[status.border] : undefined

            return (
              <Card
                key={classroom.id}
                variant="outlined"
                sx={borderColor ? { borderColor, borderWidth: 2 } : undefined}
              >
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <Typography variant="h6" sx={{ fontSize: '1.1rem' }}>
                      {classroom.label}
                    </Typography>
                    {status?.label ? (
                      <Chip size="small" label={status.label} color="success" variant="outlined" />
                    ) : null}
                  </Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    {classroom.days_of_week.join(', ')} · {classroom.time_start.slice(0, 5)}
                    {classroom.time_end ? `–${classroom.time_end.slice(0, 5)}` : ''} · {classroom.roster.length}/
                    {classroom.capacity} enrolled
                  </Typography>
                  {classroom.roster.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      No children currently enrolled.
                    </Typography>
                  ) : (
                    <List dense disablePadding>
                      {classroom.roster.map((r) => (
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
