import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Box, Card, CardContent, CircularProgress, Paper, Tooltip, Typography, alpha } from '@mui/material'
import { supabase } from '../../../lib/supabase'

type Counts = { total: number; active: number }

type ClassroomBar = { id: string; label: string; enrolledCount: number }

function StatTile({ label, counts }: { label: string; counts: Counts }) {
  return (
    <Card variant="outlined" sx={{ flex: '1 1 180px', minWidth: 180 }}>
      <CardContent>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="h3" fontWeight={600} sx={{ fontSize: { xs: '2rem', sm: '2.5rem' }, lineHeight: 1.2 }}>
          {counts.total}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {counts.active} aktif · {counts.total - counts.active} nonaktif
        </Typography>
      </CardContent>
    </Card>
  )
}

function ClassroomBarRow({ bar, maxCount }: { bar: ClassroomBar; maxCount: number }) {
  const pct = maxCount > 0 ? (bar.enrolledCount / maxCount) * 100 : 0
  return (
    <Tooltip title={`${bar.enrolledCount} siswa terdaftar di ${bar.label}`} placement="top" arrow>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          py: 0.75,
          px: 1,
          borderRadius: 1,
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <Typography variant="body2" noWrap sx={{ width: { xs: 88, sm: 160 }, flexShrink: 0 }}>
          {bar.label}
        </Typography>
        <Box
          sx={{
            flex: 1,
            height: 20,
            borderRadius: '0 4px 4px 0',
            bgcolor: (t) => alpha(t.palette.primary.main, t.palette.mode === 'dark' ? 0.18 : 0.12),
            overflow: 'hidden',
          }}
        >
          <Box
            sx={{
              height: '100%',
              width: `${pct}%`,
              borderRadius: '0 4px 4px 0',
              bgcolor: 'primary.main',
              transition: 'width 0.3s ease',
            }}
          />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ width: 28, textAlign: 'right', flexShrink: 0 }}>
          {bar.enrolledCount}
        </Typography>
      </Box>
    </Tooltip>
  )
}

export function DashboardPage() {
  const [classroomCounts, setClassroomCounts] = useState<Counts>({ total: 0, active: 0 })
  const [teacherCounts, setTeacherCounts] = useState<Counts>({ total: 0, active: 0 })
  const [childCounts, setChildCounts] = useState<Counts>({ total: 0, active: 0 })
  const [classroomBars, setClassroomBars] = useState<ClassroomBar[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [classroomsRes, teachersRes, childrenRes, groupsRes, enrollmentsRes] = await Promise.all([
      supabase.from('classrooms').select('id, label, active').order('label'),
      supabase.from('teachers').select('id, active'),
      supabase.from('children').select('id, active'),
      supabase.from('classroom_teachers').select('id, classroom_id'),
      supabase.from('children_classrooms').select('classroom_teacher_id').is('ended_at', null),
    ])
    setLoading(false)

    const qError = classroomsRes.error ?? teachersRes.error ?? childrenRes.error ?? groupsRes.error ?? enrollmentsRes.error
    if (qError) {
      setError(qError.message)
      return
    }

    const classrooms = classroomsRes.data ?? []
    const teachers = teachersRes.data ?? []
    const children = childrenRes.data ?? []

    setClassroomCounts({ total: classrooms.length, active: classrooms.filter((c) => c.active).length })
    setTeacherCounts({ total: teachers.length, active: teachers.filter((t) => t.active).length })
    setChildCounts({ total: children.length, active: children.filter((c) => c.active).length })

    const groupClassroomId = new Map<string, string>()
    for (const g of groupsRes.data ?? []) {
      groupClassroomId.set(g.id, g.classroom_id)
    }
    const countByClassroom = new Map<string, number>()
    for (const row of enrollmentsRes.data ?? []) {
      const classroomId = groupClassroomId.get(row.classroom_teacher_id)
      if (!classroomId) continue
      countByClassroom.set(classroomId, (countByClassroom.get(classroomId) ?? 0) + 1)
    }

    const bars: ClassroomBar[] = classrooms
      .map((c) => ({ id: c.id, label: c.label, enrolledCount: countByClassroom.get(c.id) ?? 0 }))
      .sort((a, b) => b.enrolledCount - a.enrolledCount)
    setClassroomBars(bars)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const maxCount = useMemo(() => Math.max(1, ...classroomBars.map((b) => b.enrolledCount)), [classroomBars])

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" py={6}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, mb: 2 }}>
        Dashboard
      </Typography>

      {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 3 }}>
        <StatTile label="Kelas" counts={classroomCounts} />
        <StatTile label="Guru" counts={teacherCounts} />
        <StatTile label="Siswa" counts={childCounts} />
      </Box>

      <Paper variant="outlined" sx={{ borderRadius: 2, p: { xs: 2, sm: 3 } }}>
        <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
          Siswa per Kelas
        </Typography>
        {classroomBars.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Belum ada kelas.
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            {classroomBars.map((bar) => (
              <ClassroomBarRow key={bar.id} bar={bar} maxCount={maxCount} />
            ))}
          </Box>
        )}
      </Paper>
    </Box>
  )
}
