import { useCallback, useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Link,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { PaymentPeriodDialog } from '../../../components/PaymentPeriodDialog'
import { ResponsiveTableContainer } from '../../../components/ResponsiveTableContainer'
import { isNearingEnd } from '../../../lib/attendanceQuota'
import { fetchPeriodsForChild } from '../../../lib/learningPeriods'
import { fetchPaymentPeriodsForChild } from '../../../lib/paymentPeriods'
import type { PaymentPeriodListEntry } from '../../../lib/paymentPeriods'
import { supabase } from '../../../lib/supabase'
import type { LearningPeriodListEntry } from '../../../types/attendance'
import type { ChildRow } from '../../../types/child'
import type { FamilyRow } from '../../../types/family'
import { PAYMENT_STATUS_LABELS } from '../../../types/payment'
import { LearningPeriodDialog } from './LearningPeriodDialog'

type Props = {
  familyId: string
  family: FamilyRow
}

function ChildPeriods({ child, family }: { child: ChildRow; family: FamilyRow }) {
  const [periods, setPeriods] = useState<LearningPeriodListEntry[]>([])
  const [payments, setPayments] = useState<Map<string, PaymentPeriodListEntry>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedPeriod, setSelectedPeriod] = useState<LearningPeriodListEntry | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [periodsResult, paymentsResult] = await Promise.all([
      fetchPeriodsForChild(child.id),
      fetchPaymentPeriodsForChild(child.id),
    ])
    setLoading(false)
    if (!periodsResult.ok) {
      setError(periodsResult.error)
      return
    }
    setError(null)
    setPeriods(periodsResult.data)
    setPayments(
      new Map((paymentsResult.ok ? paymentsResult.data : []).map((payment) => [payment.learningPeriodId, payment])),
    )
  }, [child.id])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Box>
      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}

      <Box sx={{ mb: 2 }}>
        <Button variant="contained" size="small" onClick={() => setDialogOpen(true)}>
          Tambah Periode
        </Button>
      </Box>

      {loading ? (
        <Typography variant="body2" color="text.secondary">
          Memuat…
        </Typography>
      ) : periods.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Belum ada periode belajar. Absensi tidak bisa dicatat sebelum periode dibuat.
        </Typography>
      ) : (
        <ResponsiveTableContainer>
          <Table size="small" sx={{ minWidth: 780 }}>
            <TableHead>
              <TableRow>
                <TableCell>Periode</TableCell>
                <TableCell>Kelas</TableCell>
                <TableCell>Mulai</TableCell>
                <TableCell align="right">Terpakai</TableCell>
                <TableCell align="right">Sakit</TableCell>
                <TableCell align="right">Sisa</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Pembayaran</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {periods.map((period) => {
                const payment = payments.get(period.id)
                return (
                  <TableRow key={period.id} hover>
                    <TableCell>
                      <Link component={RouterLink} to={`/admin/periods/${period.id}`} underline="hover">
                        #{period.periodNo}
                      </Link>
                    </TableCell>
                    <TableCell>{period.classroomLabel}</TableCell>
                    <TableCell>{period.startDate}</TableCell>
                    <TableCell align="right">
                      {period.daysConsumed}/{period.guaranteedDays}
                    </TableCell>
                    <TableCell align="right">{period.daysSick}</TableCell>
                    <TableCell align="right">
                      <Chip
                        size="small"
                        label={period.daysRemaining}
                        color={period.isActive && isNearingEnd(period) ? 'warning' : 'default'}
                        variant={period.isActive && isNearingEnd(period) ? 'filled' : 'outlined'}
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={period.isActive ? 'Berjalan' : 'Selesai'}
                        color={period.isActive ? 'success' : 'default'}
                        variant={period.isActive ? 'filled' : 'outlined'}
                      />
                    </TableCell>
                    <TableCell onClick={() => setSelectedPeriod(period)} sx={{ cursor: 'pointer' }}>
                      {payment ? (
                        <Chip
                          size="small"
                          label={PAYMENT_STATUS_LABELS[payment.status]}
                          color={payment.status === 'paid' ? 'success' : 'warning'}
                          variant={payment.status === 'paid' ? 'filled' : 'outlined'}
                        />
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </ResponsiveTableContainer>
      )}

      <LearningPeriodDialog
        open={dialogOpen}
        child={child}
        family={family}
        onClose={() => setDialogOpen(false)}
        onSaved={() => void load()}
      />

      {selectedPeriod ? (
        <PaymentPeriodDialog
          open
          learningPeriodId={selectedPeriod.id}
          childName={child.full_name}
          classroomLabel={selectedPeriod.classroomLabel}
          periodNo={selectedPeriod.periodNo}
          startDate={selectedPeriod.startDate}
          onClose={() => setSelectedPeriod(null)}
          onChanged={() => void load()}
        />
      ) : null}
    </Box>
  )
}

/**
 * One collapsible card per child in the family, each holding that child's periods and the
 * only place in the app where a new period is created.
 */
export function FamilyPeriodsTab({ familyId, family }: Props) {
  const [children, setChildren] = useState<ChildRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | false>(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void supabase
      .from('children')
      .select('*')
      .eq('family_id', familyId)
      .order('full_name')
      .then(({ data, error: qError }) => {
        if (cancelled) return
        setLoading(false)
        if (qError) {
          setError(qError.message)
          return
        }
        setError(null)
        setChildren(data ?? [])
        // With a single child there is nothing to choose between — open it straight away.
        if ((data ?? []).length === 1) setExpandedId(data![0].id)
      })
    return () => {
      cancelled = true
    }
  }, [familyId])

  return (
    <Box>
      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}

      {!loading && children.length === 0 ? (
        <Typography color="text.secondary">Belum ada anak.</Typography>
      ) : (
        children.map((child) => (
          <Accordion
            key={child.id}
            expanded={expandedId === child.id}
            onChange={(_, isExpanded) => setExpandedId(isExpanded ? child.id : false)}
            disableGutters
            variant="outlined"
            sx={{ mb: 1, '&:before': { display: 'none' } }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Avatar src={child.photo_url ?? undefined} sx={{ width: 32, height: 32 }}>
                  {child.full_name.charAt(0).toUpperCase()}
                </Avatar>
                <Typography>{child.full_name}</Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              {expandedId === child.id ? <ChildPeriods child={child} family={family} /> : null}
            </AccordionDetails>
          </Accordion>
        ))
      )}
    </Box>
  )
}
