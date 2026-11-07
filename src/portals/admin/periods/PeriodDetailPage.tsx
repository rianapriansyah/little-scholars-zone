import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link as RouterLink, useParams, useSearchParams } from 'react-router-dom'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import EditIcon from '@mui/icons-material/EditOutlined'
import PaymentsIcon from '@mui/icons-material/PaymentsOutlined'
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Chip,
  CircularProgress,
  Link,
  Paper,
  Typography,
} from '@mui/material'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { EditLearningPeriodDialog } from '../../../components/EditLearningPeriodDialog'
import { LearningPeriodCard } from '../../../components/LearningPeriodCard'
import { LearningPeriodDialog } from '../../../components/LearningPeriodDialog'
import { PaymentPeriodDialog } from '../../../components/PaymentPeriodDialog'
import { fetchPeriodsForChild } from '../../../lib/learningPeriods'
import { fetchPaymentPeriodsByLearningPeriodIds } from '../../../lib/paymentPeriods'
import { groupPeriodsByProgram, type ChildProgramGroup } from '../../../lib/periodGrouping'
import { deletePaymentReceipt } from '../../../lib/receiptStorage'
import { supabase } from '../../../lib/supabase'
import type { LearningPeriodListEntry } from '../../../types/attendance'
import type { ChildRow } from '../../../types/child'
import type { FamilyRow } from '../../../types/family'
import { PAYMENT_STATUS_LABELS, type PaymentStatus } from '../../../types/payment'

/**
 * One child's learning periods, one collapsible card each, with the class and the day history
 * inside the period it belongs to.
 *
 * Keyed by child rather than by period: the grid lists children now, and a child in two programs
 * needs both in one place to be compared. The cards are still ordered by program (running ones
 * first, newest period first within each) so a renewal sits beside the period it renews, but the
 * program is no longer a card of its own — every action here belongs to one period, not to the
 * program, and leading with the program named the class twice on every card.
 */
export function PeriodDetailPage() {
  const { childId } = useParams<{ childId: string }>()
  const [searchParams] = useSearchParams()
  /** Set by a deep link from Detail Keluarga, so that program opens rather than all of them. */
  const focusClassroomId = searchParams.get('program')

  const [programs, setPrograms] = useState<ChildProgramGroup[]>([])
  const [childName, setChildName] = useState('')
  /** The child and their family, which Tambah Periode Belajar needs to raise the invoice. */
  const [child, setChild] = useState<ChildRow | null>(null)
  const [family, setFamily] = useState<FamilyRow | null>(null)
  const [payments, setPayments] = useState<Map<string, PaymentStatus>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [payTarget, setPayTarget] = useState<LearningPeriodListEntry | null>(null)
  const [editTarget, setEditTarget] = useState<LearningPeriodListEntry | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<LearningPeriodListEntry | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    if (!childId) return
    setLoading(true)
    // The child row comes back alongside the periods rather than being derived from them: a child
    // with no period yet has no period to read a name off, and that is exactly when an admin is
    // here to add one. The embedded family is what the dialog needs to offer the invoice after.
    const [result, childRes] = await Promise.all([
      fetchPeriodsForChild(childId),
      supabase.from('children').select('*, families(*)').eq('id', childId).maybeSingle(),
    ])
    if (!result.ok) {
      setLoading(false)
      setError(result.error)
      return
    }

    const childRow = childRes.data as unknown as (ChildRow & { families: FamilyRow | null }) | null
    setChild(childRow)
    setFamily(childRow?.families ?? null)

    // Best-effort, same as the grid: a failed payment lookup still shows the periods.
    const paymentsResult = await fetchPaymentPeriodsByLearningPeriodIds(result.data.map((p) => p.id))
    const statusByPeriodId = new Map<string, PaymentStatus>()
    if (paymentsResult.ok) {
      for (const [periodId, payment] of paymentsResult.data) statusByPeriodId.set(periodId, payment.status)
    }

    setLoading(false)
    setError(null)
    setChildName(childRow?.full_name ?? result.data[0]?.childName ?? '')
    setPayments(statusByPeriodId)
    setPrograms(groupPeriodsByProgram(result.data))
  }, [childId])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * The cards, flattened out of their programs: grouping only supplies the order now — running
   * programs first, newest period first within each — not a level of the layout.
   */
  const periods = useMemo(() => programs.flatMap((group) => group.periods), [programs])

  /**
   * Open exactly one card. A deep link from Detail Keluarga names a program, so open that
   * program's newest period; otherwise the first, so a child with several periods does not open
   * as a wall of detail.
   */
  const expandedPeriodId = focusClassroomId
    ? (periods.find((period) => period.classroomId === focusClassroomId)?.id ?? periods[0]?.id)
    : periods[0]?.id

  /**
   * Deletes the payment_periods row and the learning_periods row together (delete_learning_period
   * does both server-side, in that order, in one transaction), then best-effort deletes the
   * attached receipt from storage if there was one — see deletePaymentReceipt, which only runs
   * once the RPC has succeeded, so a refused delete keeps its receipt.
   *
   * Refused when the period has recorded attendance: the RPC says so in its own (Indonesian)
   * message, and child_attendances_period_fkey backs it up at commit with '23503'. It used to
   * cascade instead, which is how one child's attendance was erased — see
   * 20261108020000_protect_attendance_from_period_delete.sql.
   */
  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setError(null)
    const { data: receiptPath, error: rpcError } = await supabase.rpc('delete_learning_period', {
      p_learning_period_id: deleteTarget.id,
    })
    setDeleting(false)
    if (rpcError) {
      setError(
        rpcError.code === '23503'
          ? 'Tidak dapat dihapus: periode ini memiliki riwayat kehadiran tercatat.'
          : rpcError.message,
      )
      setDeleteTarget(null)
      return
    }
    if (receiptPath) void deletePaymentReceipt(receiptPath)
    setDeleteTarget(null)
    await load()
  }

  if (!childId) {
    return <Alert severity="error">Siswa tidak valid.</Alert>
  }

  return (
    <Box>
      <Breadcrumbs sx={{ mb: 1 }}>
        <Link component={RouterLink} to="/admin/periods" underline="hover" color="inherit">
          Periode Belajar
        </Link>
        <Typography color="text.primary">{childName || 'Detail'}</Typography>
      </Breadcrumbs>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      {loading ? (
        <Box display="flex" justifyContent="center" py={6}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          <Typography variant="h5" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, mb: 0.5 }}>
            {childName}
          </Typography>

          {/* The header row, not inside the empty branch: a child with no period at all is the
              clearest reason to be on this screen, and hiding the button there would send the
              admin back to Detail Keluarga for the one thing they came to do. */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 2,
              mb: 2,
            }}
          >
            <Typography variant="body2" color="text.secondary">
              {periods.length === 0
                ? 'Belum ada periode belajar.'
                : `${periods.length} periode · klik satu periode untuk melihat kelas, kuota, riwayat absen, dan pembayarannya.`}
            </Typography>
            {/* Disabled until the child row has loaded — the dialog needs it and the family for
                the invoice it offers once the period is saved. */}
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              disabled={!child || !family}
              onClick={() => setAddOpen(true)}
              sx={{ flexShrink: 0 }}
            >
              Tambah Periode Belajar
            </Button>
          </Box>

          {periods.length === 0 ? (
            <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
              <Typography color="text.secondary">
                Siswa ini belum memiliki periode belajar. Tambahkan satu untuk mulai mencatat absensi.
              </Typography>
            </Paper>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {periods.map((period) => {
                const status = payments.get(period.id) ?? null
                return (
                  <LearningPeriodCard
                    key={period.id}
                    period={period}
                    defaultExpanded={period.id === expandedPeriodId}
                    attendanceAdd
                    attendanceDelete
                    // Recording or deleting a day moves the quota this card reads from `period`.
                    onAttendanceChanged={() => void load()}
                    headerActions={
                      <>
                        <Chip
                          size="small"
                          label={status ? PAYMENT_STATUS_LABELS[status] : 'Belum ada tagihan'}
                          color={status === 'paid' ? 'success' : 'warning'}
                          variant={status === 'paid' ? 'filled' : 'outlined'}
                        />
                        <Box sx={{ flexGrow: 1 }} />
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<PaymentsIcon />}
                          onClick={() => setPayTarget(period)}
                        >
                          Pembayaran
                        </Button>
                      </>
                    }
                    manageActions={
                      <>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<EditIcon />}
                          onClick={() => setEditTarget(period)}
                        >
                          Edit
                        </Button>
                        <Box sx={{ flexGrow: 1 }} />
                        <Button
                          size="small"
                          variant="outlined"
                          color="error"
                          startIcon={<DeleteIcon />}
                          onClick={() => setDeleteTarget(period)}
                        >
                          Hapus
                        </Button>
                      </>
                    }
                  />
                )
              })}
            </Box>
          )}
        </>
      )}

      {child && family ? (
        <LearningPeriodDialog
          open={addOpen}
          child={child}
          family={family}
          onClose={() => setAddOpen(false)}
          onSaved={() => void load()}
        />
      ) : null}

      {editTarget ? (
        <EditLearningPeriodDialog
          open
          period={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => void load()}
        />
      ) : null}

      {payTarget ? (
        <PaymentPeriodDialog
          open
          learningPeriodId={payTarget.id}
          childName={payTarget.childName}
          classroomLabel={payTarget.classroomLabel}
          periodNo={payTarget.periodNo}
          startDate={payTarget.startDate}
          onClose={() => setPayTarget(null)}
          onChanged={() => void load()}
        />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Hapus Periode Belajar"
        description={`Hapus periode #${deleteTarget?.periodNo} ${deleteTarget?.classroomLabel ?? ''} milik ${childName}? Data pembayaran dan bukti pembayaran yang terlampir (jika ada) akan ikut terhapus. Tindakan ini tidak dapat dibatalkan.`}
        confirmLabel={deleting ? 'Menghapus…' : 'Hapus'}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
      />
    </Box>
  )
}
