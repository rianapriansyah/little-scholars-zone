import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Link as RouterLink,
  useParams,
  useSearchParams,
} from "react-router-dom";
import AddIcon from "@mui/icons-material/Add";
import DoneIcon from "@mui/icons-material/TaskAlt";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import EditIcon from "@mui/icons-material/EditOutlined";
import PaymentsIcon from "@mui/icons-material/PaymentsOutlined";
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
} from "@mui/material";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { EditLearningPeriodDialog } from "../../../components/EditLearningPeriodDialog";
import { LearningPeriodCard } from "../../../components/LearningPeriodCard";
import { LearningPeriodDialog } from "../../../components/LearningPeriodDialog";
import { PaymentPeriodDialog } from "../../../components/PaymentPeriodDialog";
import {
  closeLearningPeriod,
  fetchPeriodsForChild,
} from "../../../lib/learningPeriods";
import { fetchPaymentPeriodsByLearningPeriodIds } from "../../../lib/paymentPeriods";
import {
  groupPeriodsByProgram,
  type ChildProgramGroup,
} from "../../../lib/periodGrouping";
import { deletePaymentReceipt } from "../../../lib/receiptStorage";
import { supabase } from "../../../lib/supabase";
import type { LearningPeriodListEntry } from "../../../types/attendance";
import type { ChildRow } from "../../../types/child";
import type { FamilyRow } from "../../../types/family";
import {
  PAYMENT_STATUS_LABELS,
  type PaymentStatus,
} from "../../../types/payment";

/**
 * Tandai Selesai is offered on a running period, and on a Belum Mulai one that a later period of
 * the same class has already overtaken (a higher period_no that is Berjalan or Selesai) — sold,
 * never attended, and left open it would take a teacher's days once the current period fills.
 * A Belum Mulai period with nothing started after it is the next block waiting its turn, so it
 * gets no button; a closed period has nothing left to finish.
 */
function canFinish(
  period: LearningPeriodListEntry,
  classPeriods: LearningPeriodListEntry[],
): boolean {
  if (period.isActive) return true;
  if (period.closedAt !== null) return false;
  return classPeriods.some(
    (other) =>
      other.periodNo > period.periodNo &&
      (other.isActive || other.closedAt !== null),
  );
}

/** "Periode 1 dan Periode 2", or "Periode 1, Periode 2 dan Periode 3". */
function formatPeriodList(periodNos: number[]): string {
  const names = periodNos.map((no) => `Periode ${no}`);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} dan ${names[names.length - 1]}`;
}

/**
 * One child's learning periods, grouped under one heading per class (running classes first),
 * with a collapsible card per period beneath it, Periode 1, 2, 3 in order.
 *
 * Grouped because period numbers restart per class: a flat list read "Periode 1, Periode 2,
 * Periode 1, Periode 2, Periode 3" with the class buried inside each card. The heading names the
 * class once, so the cards drop their own Kelas line (hideClassroom). Every action still belongs
 * to one period, so the class heading is a label, not a card.
 */
export function PeriodDetailPage() {
  const { childId } = useParams<{ childId: string }>();
  const [searchParams] = useSearchParams();
  /** Set by a deep link from Detail Keluarga, so that program opens rather than all of them. */
  const focusClassroomId = searchParams.get("program");

  const [programs, setPrograms] = useState<ChildProgramGroup[]>([]);
  const [childName, setChildName] = useState("");
  /** The child and their family, which Tambah Periode Belajar needs to raise the invoice. */
  const [child, setChild] = useState<ChildRow | null>(null);
  const [family, setFamily] = useState<FamilyRow | null>(null);
  const [payments, setPayments] = useState<Map<string, PaymentStatus>>(
    new Map(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<LearningPeriodListEntry | null>(
    null,
  );
  const [editTarget, setEditTarget] = useState<LearningPeriodListEntry | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] =
    useState<LearningPeriodListEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [finishTarget, setFinishTarget] =
    useState<LearningPeriodListEntry | null>(null);
  const [finishing, setFinishing] = useState(false);

  const load = useCallback(async () => {
    if (!childId) return;
    setLoading(true);
    // The child row comes back alongside the periods rather than being derived from them: a child
    // with no period yet has no period to read a name off, and that is exactly when an admin is
    // here to add one. The embedded family is what the dialog needs to offer the invoice after.
    const [result, childRes] = await Promise.all([
      fetchPeriodsForChild(childId),
      supabase
        .from("children")
        .select("*, families(*)")
        .eq("id", childId)
        .maybeSingle(),
    ]);
    if (!result.ok) {
      setLoading(false);
      setError(result.error);
      return;
    }

    const childRow = childRes.data as unknown as
      (ChildRow & { families: FamilyRow | null }) | null;
    setChild(childRow);
    setFamily(childRow?.families ?? null);

    // Best-effort, same as the grid: a failed payment lookup still shows the periods.
    const paymentsResult = await fetchPaymentPeriodsByLearningPeriodIds(
      result.data.map((p) => p.id),
    );
    const statusByPeriodId = new Map<string, PaymentStatus>();
    if (paymentsResult.ok) {
      for (const [periodId, payment] of paymentsResult.data)
        statusByPeriodId.set(periodId, payment.status);
    }

    setLoading(false);
    setError(null);
    setChildName(childRow?.full_name ?? result.data[0]?.childName ?? "");
    setPayments(statusByPeriodId);
    setPrograms(groupPeriodsByProgram(result.data));
  }, [childId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Every period across every class, for the count and the empty state. */
  const periods = useMemo(
    () => programs.flatMap((group) => group.periods),
    [programs],
  );

  /**
   * Classes where more than one period is active at once. Allowed on purpose while the school moves
   * from the manual process to the app (the admin keeps full access to every period), but it is
   * almost always days filed on the wrong period, so the page says so loudly. Oldest period first.
   */
  const multiActive = useMemo(
    () =>
      programs
        .map((group) => ({
          classroomId: group.classroomId,
          classroomLabel: group.classroomLabel,
          periodNos: group.periods
            .filter((p) => p.isActive)
            .map((p) => p.periodNo)
            .sort((a, b) => a - b),
        }))
        .filter((group) => group.periodNos.length > 1),
    [programs],
  );

  /**
   * Open exactly one card. A deep link from Detail Keluarga names a program, so open that
   * program's newest period; otherwise the newest period of the first class (running classes sort
   * first), so a child with several periods does not open as a wall of detail.
   * `group.periods` is newest first, so [0] is the newest.
   */
  const focusGroup =
    programs.find((group) => group.classroomId === focusClassroomId) ??
    programs[0];
  const expandedPeriodId = focusGroup?.periods[0]?.id;

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
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    const { data: receiptPath, error: rpcError } = await supabase.rpc(
      "delete_learning_period",
      {
        p_learning_period_id: deleteTarget.id,
      },
    );
    setDeleting(false);
    if (rpcError) {
      setError(
        rpcError.code === "23503"
          ? "Tidak dapat dihapus: periode ini memiliki riwayat kehadiran tercatat."
          : rpcError.message,
      );
      setDeleteTarget(null);
      return;
    }
    if (receiptPath) void deletePaymentReceipt(receiptPath);
    setDeleteTarget(null);
    await load();
  }

  /** Tandai Selesai — closes the period by hand; Sisa keeps the days it was not used for. */
  async function handleFinish() {
    if (!finishTarget) return;
    setFinishing(true);
    setError(null);
    const result = await closeLearningPeriod(finishTarget.id);
    setFinishing(false);
    setFinishTarget(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await load();
  }

  if (!childId) {
    return <Alert severity="error">Siswa tidak valid.</Alert>;
  }

  return (
    <Box>
      <Breadcrumbs sx={{ mb: 1 }}>
        <Link
          component={RouterLink}
          to="/admin/periods"
          underline="hover"
          color="inherit"
        >
          Periode Belajar
        </Link>
        <Typography color="text.primary">{childName || "Detail"}</Typography>
      </Breadcrumbs>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      {!loading
        ? multiActive.map((group) => (
            <Alert
              key={group.classroomId}
              severity="error"
              variant="filled"
              sx={{ mb: 2 }}
            >
              {group.classroomLabel}:{" "}
              {formatPeriodList(group.periodNos)} sama-sama aktif. Pindahkan
              absen ke periode yang benar, lalu Tandai Selesai periode yang
              sudah lewat.
            </Alert>
          ))
        : null}

      {loading ? (
        <Box display="flex" justifyContent="center" py={6}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          <Typography
            variant="h5"
            sx={{ fontSize: { xs: "1.25rem", sm: "1.5rem" }, mb: 0.5 }}
          >
            {childName}
          </Typography>

          {/* The header row, not inside the empty branch: a child with no period at all is the
              clearest reason to be on this screen, and hiding the button there would send the
              admin back to Detail Keluarga for the one thing they came to do. */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 2,
              mb: 2,
            }}
          >
            <Typography variant="body2" color="text.secondary">
              {periods.length === 0
                ? "Belum ada periode belajar."
                : `${programs.length} kelas · ${periods.length} periode · klik satu periode untuk melihat kuota, riwayat absen, dan pembayarannya.`}
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
                Siswa ini belum memiliki periode belajar. Tambahkan satu untuk
                mulai mencatat absensi.
              </Typography>
            </Paper>
          ) : (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {programs.map((group) => (
                <Box key={group.classroomId} component="section">
                  <Typography
                    variant="h6"
                    sx={{
                      fontSize: { xs: "1rem", sm: "1.125rem" },
                      fontWeight: 700,
                    }}
                  >
                    {group.classroomLabel}
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mb: 1 }}
                  >
                    {group.periods.length} periode
                  </Typography>
                  <Box
                    sx={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 1.5,
                      pl: { xs: 1, sm: 2 },
                      borderLeft: 2,
                      borderColor: "divider",
                    }}
                  >
                    {/* Oldest first inside a class, so the periods read 1, 2, 3 down the page. */}
                    {[...group.periods].reverse().map((period) => {
                      const status = payments.get(period.id) ?? null;
                      return (
                        <LearningPeriodCard
                          key={period.id}
                          period={period}
                          defaultExpanded={period.id === expandedPeriodId}
                          hideClassroom
                          attendanceAdd
                          attendanceDelete
                          // The rest of this class's periods: a day can only move within its class.
                          moveTargets={group.periods.filter(
                            (other) => other.id !== period.id,
                          )}
                          // Recording or deleting a day moves the quota this card reads from `period`.
                          onAttendanceChanged={() => void load()}
                          headerActions={
                            <>
                              <Chip
                                size="small"
                                label={
                                  status
                                    ? PAYMENT_STATUS_LABELS[status]
                                    : "Belum ada tagihan"
                                }
                                color={
                                  status === "paid" ? "success" : "warning"
                                }
                                variant={
                                  status === "paid" ? "filled" : "outlined"
                                }
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
                          // Running, or a Belum Mulai period a later one has overtaken — see canFinish.
                          statusActions={
                            canFinish(period, group.periods) ? (
                              <Button
                                size="small"
                                variant="outlined"
                                color="success"
                                fullWidth
                                startIcon={<DoneIcon />}
                                onClick={() => setFinishTarget(period)}
                              >
                                Tandai Selesai
                              </Button>
                            ) : undefined
                          }
                          manageActions={
                            <>
                              <Button
                                size="small"
                                variant="outlined"
                                startIcon={<EditIcon />}
                                onClick={() => setEditTarget(period)}
                                sx={{ flex: 1 }}
                              >
                                Edit
                              </Button>
                              <Button
                                size="small"
                                variant="outlined"
                                color="error"
                                sx={{ flex: 1 }}
                                startIcon={<DeleteIcon />}
                                onClick={() => setDeleteTarget(period)}
                              >
                                Hapus
                              </Button>
                            </>
                          }
                        />
                      );
                    })}
                  </Box>
                </Box>
              ))}
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
        description={`Hapus periode #${deleteTarget?.periodNo} ${deleteTarget?.classroomLabel ?? ""} milik ${childName}? Data pembayaran dan bukti pembayaran yang terlampir (jika ada) akan ikut terhapus. Tindakan ini tidak dapat dibatalkan.`}
        confirmLabel={deleting ? "Menghapus…" : "Hapus"}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
      />

      <ConfirmDialog
        open={finishTarget !== null}
        title="Tandai Periode Selesai"
        description={`Tandai periode #${finishTarget?.periodNo} ${finishTarget?.classroomLabel ?? ""} milik ${childName} sebagai selesai? Sisa ${finishTarget?.daysRemaining ?? 0} hari tetap tercatat, tetapi absen baru tidak akan lagi masuk ke periode ini.`}
        confirmLabel={finishing ? "Menyimpan…" : "Tandai Selesai"}
        onCancel={() => setFinishTarget(null)}
        onConfirm={() => void handleFinish()}
      />
    </Box>
  );
}
