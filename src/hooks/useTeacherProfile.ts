import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { TeacherRow } from '../types/teacher'

export function useTeacherProfile(authUserId: string | undefined) {
  const [teacher, setTeacher] = useState<TeacherRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fetchNonce, setFetchNonce] = useState(0)

  const refetch = useCallback(() => {
    setFetchNonce((n) => n + 1)
  }, [])

  useEffect(() => {
    if (!authUserId) {
      setTeacher(null)
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    void supabase
      .from('teachers')
      .select('*')
      .eq('auth_user_id', authUserId)
      .maybeSingle()
      .then(({ data, error: qError }) => {
        if (cancelled) return
        if (qError) {
          setError(qError.message)
          setTeacher(null)
        } else {
          setError(null)
          setTeacher(data)
        }
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [authUserId, fetchNonce])

  return { teacher, loading, error, refetch }
}
