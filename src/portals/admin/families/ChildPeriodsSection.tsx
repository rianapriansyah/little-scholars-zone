import { useCallback, useEffect, useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Alert, Box, Button, Chip, Link, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { PaymentPeriodDialog } from '../../../components/PaymentPeriodDialog'
import { ResponsiveTableContainer } from '../../../components/ResponsiveTableContainer'
import { isNearingEnd } from '../../../lib/attendanceQuota'
import { formatDate } from '../../../lib/formatDate'
import { fetchPeriodsForChild } from '../../../lib/learningPeriods'
import { fetchPaymentPeriodsForChild } from '../../../lib/paymentPeriods'
import type { PaymentPeriodListEntry } from '../../../lib/paymentPeriods'
import type { LearningPeriodListEntry } from '../../../types/attendance'
import type { ChildRow } from '../../../types/child'
import type { FamilyRow } from '../../../types/family'
import { PAYMENT_STATUS_LABELS } from '../../../types/payment'
import { LearningPeriodDialog } from './LearningPeriodDialog'

type Props = {
  child: ChildRow
  family: FamilyRow
  /** Fired after every reload — a new period can open a program the caller has to react to. */
  onPeriodsChanged?: (periods: LearningPeriodListEntry[]) => void
}

/**
 * One child's learning periods, and the only place in the app where a new one is created.
 * Lives inside the child's card on the Data Anak tab.
 */
export function ChildPeriodsSection({ child, family, onPeriodsChanged }: Props) {
  const [periods, setPeriods] = useState<LearningPeriodListEntry[]>([])
  const [payments, setPayments] = useState<Map<string, PaymentPeriodListEntry>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedPeriod, setSelectedPeriod] = useState<LearningPeriodListEntry | null>(null)

  // Held in a ref so `load` keeps a stable identity: the caller passes an inline arrow, and a
  // changing dependency here would re-fire the mount effect on every parent render.
  const onPeriodsChangedRef = useRef(onPeriodsChanged)
  useEffect(() => {
    onPeriodsChangedRef.current = onPeriodsChanged
  })

  const load = useCallback(
    async (notify = false) => {
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
      if (notify) onPeriodsChangedRef.current?.(periodsResult.data)
    },
    [child.id],
  )

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
                      {/* The detail screen is per child now, so carry the program along to open
                          its card rather than landing on whichever one happens to be first. */}
                      <Link
                        component={RouterLink}
                        to={`/admin/periods/${child.id}?program=${period.classroomId}`}
                        underline="hover"
                      >
                        #{period.periodNo}
                      </Link>
                    </TableCell>
                    <TableCell>{period.classroomLabel}</TableCell>
                    <TableCell>{formatDate(period.startDate)}</TableCell>
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

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
        <Button variant="contained" size="small" onClick={() => setDialogOpen(true)}>
          Tambah Periode
        </Button>
      </Box>

      <LearningPeriodDialog
        open={dialogOpen}
        child={child}
        family={family}
        onClose={() => setDialogOpen(false)}
        onSaved={() => void load(true)}
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
