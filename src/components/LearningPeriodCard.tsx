import { useCallback, useEffect, useState, type ReactNode } from "react";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  IconButton,
  Typography,
} from "@mui/material";
import { isNearingEnd } from "../lib/attendanceQuota";
import { formatDate } from "../lib/formatDate";
import { fetchPeriodAttendances } from "../lib/learningPeriods";
import type {
  ChildAttendanceRow,
  LearningPeriodListEntry,
} from "../types/attendance";
import { AddAttendanceDialog } from "./AddAttendanceDialog";
import { AttendanceDetailDialog } from "./AttendanceDetailDialog";
import { AttendanceHistoryList } from "./AttendanceHistoryList";
import { MoveAttendanceDialog } from "./MoveAttendanceDialog";
import { StatTile } from "./StatTile";

type Props = {
  period: LearningPeriodListEntry;
  defaultExpanded?: boolean;
  /** Admin only: a Tambah Absen button on Riwayat Absen, for filling a day nobody recorded. */
  attendanceAdd?: boolean;
  /** Admin only: let a day that should never have been recorded be deleted from its dialog. */
  attendanceDelete?: boolean;
  /**
   * Admin only: the child's other periods in this class, which turns on Pindahkan Absen for
   * re-filing days recorded against the wrong period. Same class only — the attendance row's
   * foreign key ties a day to its classroom.
   */
  moveTargets?: LearningPeriodListEntry[];
  /**
   * Controls in the band between the period summary and Kelas — where the payment status and its
   * button go. Up here because payment is a fact about the period itself, so it reads with the
   * summary rather than trailing the day history.
   */
  headerActions?: ReactNode;
  /**
   * Controls on their own line under headerActions, separated from it — what moves the period
   * along (Tandai Selesai), kept up with the summary it changes.
   */
  statusActions?: ReactNode;
  /**
   * Controls under the period figures, on their own line between dividers — the ones that change
   * or remove the period itself, kept away from the summary so they are not hit by accident.
   */
  manageActions?: ReactNode;
  /**
   * Adding or deleting a day moves the quota, and `period` is owned by the screen above, so the
   * card cannot refresh Terpakai/Sisa itself. The parent reloads and hands back a fresh row.
   */
  onAttendanceChanged?: () => void;
  /**
   * Drop the Kelas heading inside the card — for screens that already group the cards under
   * their class, where repeating it on every period is noise.
   */
  hideClassroom?: boolean;
};

/**
 * One learning period, collapsible: the period leads, and the class it belongs to sits inside
 * under Kelas alongside its quota figures, with Riwayat Absen folding separately beneath.
 *
 * Period-led rather than program-led (which is what ProgramPeriodCard does for the parent portal):
 * on the admin screen every action — the invoice, the delete, filling a missed day — belongs to
 * one period, and leading with the program meant naming the class twice on every card.
 *
 * The quota figures come from the learning_period_status view by way of `period`; nothing here is
 * counted client-side, so this cannot drift from what the quota logic believes.
 */
export function LearningPeriodCard({
  period,
  defaultExpanded = false,
  attendanceAdd = false,
  attendanceDelete = false,
  moveTargets,
  headerActions,
  statusActions,
  manageActions,
  onAttendanceChanged,
  hideClassroom = false,
}: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [attendances, setAttendances] = useState<ChildAttendanceRow[] | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openAttendance, setOpenAttendance] =
    useState<ChildAttendanceRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchPeriodAttendances(period.id);
    setLoading(false);
    if (!result.ok) return setError(result.error);
    setError(null);
    setAttendances(result.data);
  }, [period.id]);

  // Only once the card is opened: a child with several periods would otherwise fire a query per
  // period on load, for lists nobody has asked to see yet.
  useEffect(() => {
    if (expanded && attendances === null && !loading && !error) void load();
  }, [expanded, attendances, loading, error, load]);

  /** Both the day list and the quota above it are stale after a write. */
  const reload = useCallback(() => {
    void load();
    onAttendanceChanged?.();
  }, [load, onAttendanceChanged]);

  return (
    <Accordion
      expanded={expanded}
      onChange={(_event, value) => setExpanded(value)}
      disableGutters
      variant="outlined"
      sx={{
        "&:before": { display: "none" },
        borderRadius: 2,
        overflow: "hidden",
      }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon />}
        sx={{ "& .MuiAccordionSummary-content": { my: 1.5 } }}
      >
        <Box sx={{ width: "100%", minWidth: 0, pr: 1 }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 0.75,
            }}
          >
            <Typography sx={{ fontWeight: 700 }}>
              Periode {period.periodNo}
            </Typography>
            <Chip
              size="small"
              label={period.isActive ? "Berjalan" : "Selesai"}
              color={period.isActive ? "success" : "default"}
              variant={period.isActive ? "filled" : "outlined"}
            />
            {/* Only while it is still running: days left on a closed period is noise. */}
            {period.isActive ? (
              <Chip
                size="small"
                label={`Sisa ${period.daysRemaining} hari`}
                color={isNearingEnd(period) ? "warning" : "default"}
                variant={isNearingEnd(period) ? "filled" : "outlined"}
              />
            ) : null}
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Mulai {formatDate(period.startDate)}
          </Typography>
        </Box>
      </AccordionSummary>

      <AccordionDetails sx={{ pt: 0 }}>
        {headerActions ? (
          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 1,
            }}
          >
            {headerActions}
          </Box>
        ) : null}

        {statusActions ? (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Box
              sx={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 1,
              }}
            >
              {statusActions}
            </Box>
          </>
        ) : null}

        {/* Closes off the summary — everything below belongs to the class, not to the period. */}
        <Divider sx={{ mt: 1.5, mb: 2 }} />

        {hideClassroom ? null : (
          <>
            <Typography
              variant="overline"
              color="text.secondary"
              sx={{ display: "block" }}
            >
              Kelas
            </Typography>
            <Typography sx={{ fontWeight: 600, mb: 1.5 }}>
              {period.classroomLabel}
            </Typography>
          </>
        )}

        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5 }}>
          <StatTile label="Mulai" value={formatDate(period.startDate)} />
          <StatTile
            label="Terpakai"
            value={`${period.daysConsumed}/${period.guaranteedDays}`}
            hint="Hadir + alfa"
          />
          <StatTile
            label="Sisa"
            value={period.daysRemaining}
            hint="Hari dijamin"
          />
          <StatTile
            label="Sakit"
            value={period.daysSick}
            hint="Tidak memotong"
          />
        </Box>

        {period.projectedEndDate || period.actualEndDate ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            {period.actualEndDate
              ? `Selesai pada ${formatDate(period.actualEndDate)}.`
              : `Perkiraan selesai ${formatDate(period.projectedEndDate)} — perkiraan kasar, bukan patokan.`}
          </Typography>
        ) : null}

        {manageActions ? (
          <>
            <Divider sx={{ my: 2 }} />
            <Box
              sx={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 1,
              }}
            >
              {manageActions}
            </Box>
          </>
        ) : null}

        <Divider sx={{ my: 2 }} />

        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            flexWrap: "wrap",
          }}
        >
          <IconButton
            size="small"
            onClick={() => setHistoryOpen((open) => !open)}
            aria-expanded={historyOpen}
            aria-label={
              historyOpen
                ? "Sembunyikan riwayat absen"
                : "Tampilkan riwayat absen"
            }
            sx={{
              transform: historyOpen ? "rotate(0deg)" : "rotate(-90deg)",
              transition: (theme) => theme.transitions.create("transform"),
            }}
          >
            <ExpandMoreIcon fontSize="small" />
          </IconButton>
          <Typography
            variant="overline"
            color="text.secondary"
            onClick={() => setHistoryOpen((open) => !open)}
            sx={{
              flexGrow: 1,
              minWidth: 0,
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            Riwayat Absen{attendances ? ` (${attendances.length})` : ""}
          </Typography>
        </Box>

        {attendanceAdd || moveTargets ? (
          <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
            {attendanceAdd ? (
              <Button
                size="small"
                variant="outlined"
                onClick={() => setAddOpen(true)}
                sx={{ flex: 1 }}
              >
                Tambah Absen
              </Button>
            ) : null}
            {moveTargets ? (
              <Button
                size="small"
                variant="outlined"
                onClick={() => setMoveOpen(true)}
                // Nothing to move, or nowhere to move it to.
                disabled={!attendances?.length || moveTargets.length === 0}
                sx={{ flex: 1 }}
              >
                Pindahkan Absen
              </Button>
            ) : null}
          </Box>
        ) : null}

        <Collapse in={historyOpen} unmountOnExit>
          <Box sx={{ pt: 1 }}>
            {error ? (
              <Alert severity="error">{error}</Alert>
            ) : attendances === null ? (
              <Box display="flex" justifyContent="center" py={3}>
                <CircularProgress size={24} />
              </Box>
            ) : (
              <>
                {attendances.length > 0 ? (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mb: 1 }}
                  >
                    Klik satu tanggal untuk detailnya.
                  </Typography>
                ) : null}
                <AttendanceHistoryList
                  attendances={attendances}
                  onSelect={(row) => setOpenAttendance(row)}
                />
              </>
            )}
          </Box>
        </Collapse>
      </AccordionDetails>

      {openAttendance ? (
        <AttendanceDetailDialog
          open
          attendance={openAttendance}
          childId={period.childId}
          classroomId={period.classroomId}
          onClose={() => setOpenAttendance(null)}
          allowDelete={attendanceDelete}
          onDeleted={reload}
        />
      ) : null}

      {attendanceAdd ? (
        <AddAttendanceDialog
          open={addOpen}
          childId={period.childId}
          childName={period.childName}
          classroomId={period.classroomId}
          onClose={() => setAddOpen(false)}
          onSaved={reload}
        />
      ) : null}

      {moveTargets && attendances ? (
        <MoveAttendanceDialog
          open={moveOpen}
          period={period}
          attendances={attendances}
          targets={moveTargets}
          onClose={() => setMoveOpen(false)}
          onMoved={reload}
        />
      ) : null}
    </Accordion>
  );
}
