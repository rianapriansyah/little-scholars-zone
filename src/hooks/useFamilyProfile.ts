import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { FamilyRow } from '../types/family'

export function useFamilyProfile(authUserId: string | undefined) {
  const [family, setFamily] = useState<FamilyRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fetchNonce, setFetchNonce] = useState(0)

  const refetch = useCallback(() => {
    setFetchNonce((n) => n + 1)
  }, [])

  useEffect(() => {
    if (!authUserId) {
      setFamily(null)
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    void supabase
      .from('families')
      .select('*')
      .eq('auth_user_id', authUserId)
      .maybeSingle()
      .then(({ data, error: qError }) => {
        if (cancelled) return
        if (qError) {
          setError(qError.message)
          setFamily(null)
        } else {
          setError(null)
          setFamily(data)
        }
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [authUserId, fetchNonce])

  return { family, loading, error, refetch }
}
