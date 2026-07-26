import { useEffect, useState } from 'react'
import { Alert, Box, Card, CardContent, CircularProgress, Typography } from '@mui/material'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useFamilyProfile } from '../../hooks/useFamilyProfile'
import type { ChildRow } from '../../types/child'

type ChildWithClassroom = ChildRow & { classroomLabel: string | null; teacherName: string | null }

export function ParentHomePage() {
  const { user } = useAuth()
  const { family } = useFamilyProfile(user?.id)
  const [children, setChildren] = useState<ChildWithClassroom[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!family) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      const { data: childRows, error: cError } = await supabase
        .from('children')
        .select('*')
        .eq('family_id', family.id)
        .order('full_name')
      if (cError) {
        if (!cancelled) {
          setError(cError.message)
          setLoading(false)
        }
        return
      }

      const results: ChildWithClassroom[] = []
      for (const child of childRows ?? []) {
        const { data: enrollment } = await supabase
          .from('children_classrooms')
          .select('classroom_teachers(classrooms(label), teachers(full_name))')
          .eq('child_id', child.id)
          .is('ended_at', null)
          .maybeSingle()
        const group = enrollment?.classroom_teachers as unknown as
          | { classrooms: { label: string } | null; teachers: { full_name: string } | null }
          | null
        results.push({
          ...child,
          classroomLabel: group?.classrooms?.label ?? null,
          teacherName: group?.teachers?.full_name ?? null,
        })
      }

      if (!cancelled) {
        setChildren(results)
        setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [family])

  if (!family || loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="40vh">
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, mb: 2 }}>
        Anak Saya
      </Typography>

      {error ? <Alert severity="error">{error}</Alert> : null}

      {children.length === 0 ? (
        <Typography color="text.secondary">Belum ada data anak.</Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {children.map((child) => (
            <Card key={child.id} variant="outlined">
              <CardContent>
                <Typography variant="h6" sx={{ fontSize: '1.1rem' }}>
                  {child.full_name}
                </Typography>
                {child.classroomLabel ? (
                  <Typography variant="body2" color="text.secondary">
                    Kelas: {child.classroomLabel}
                    {child.teacherName ? ` (Guru ${child.teacherName})` : ''}
                  </Typography>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Belum terdaftar di kelas manapun.
                  </Typography>
                )}
              </CardContent>
            </Card>
          ))}
        </Box>
      )}
    </Box>
  )
}
