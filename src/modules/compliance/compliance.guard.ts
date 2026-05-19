import {
  ComplianceIncidentStatus,
  ComplianceIncidentType,
  EmployeeStatus,
  Prisma,
} from '@prisma/client';
import { AppError } from '@shared/utils/errors';

/**
 * Compliance gate — the C in ACID for the regulatory plane.
 *
 * Called from inside the `reserveAdvance` Prisma `$transaction` (and any
 * other money-movement entry point). If the employee is currently
 * carrying an open compliance incident, the transaction is rolled back
 * before any ledger row is written. The check runs against the
 * transaction client so it observes the same MVCC snapshot as the
 * subsequent writes — no TOCTOU window between gate and side-effect.
 *
 * Severity policy:
 *   • 5 (SANCTIONS_HIT, confirmed PEP, identity-mismatch with confirmed
 *     fraud) — hard block. AccountStatus must be SUSPENDED before any
 *     incident at this level can sit at OPEN.
 *   • 3-4 (AML pattern, high-risk country) — block advances but not
 *     refunds / wallet drains; here we treat them as blocking for the
 *     reserveAdvance hot path. P2P drains will be gated by a softer
 *     `enforceComplianceForP2P` variant if/when surface grows.
 *   • 1-2 (low-severity flags) — surfaced to ops, not blocking.
 *
 * Statuses that BLOCK:
 *   OPEN, UNDER_REVIEW, ESCALATED, RESOLVED_BLOCKED
 *
 * Statuses that DO NOT BLOCK:
 *   RESOLVED_NO_ACTION (cleared by officer — formally absolved)
 *
 * RESOLVED_BLOCKED is intentionally still blocking: it's the terminal
 * suspension marker, not an absolution. An officer who wants to lift it
 * issues a NEW incident row with status RESOLVED_NO_ACTION (per the
 * immutability discipline — see ComplianceIncident model comment).
 */

export const BLOCKING_INCIDENT_STATUSES: ComplianceIncidentStatus[] = [
  ComplianceIncidentStatus.OPEN,
  ComplianceIncidentStatus.UNDER_REVIEW,
  ComplianceIncidentStatus.ESCALATED,
  ComplianceIncidentStatus.RESOLVED_BLOCKED,
];

export const HOT_PATH_BLOCKING_SEVERITY = 3;

export class ComplianceBlock extends AppError {
  constructor(
    public readonly employeeId: string,
    public readonly incidentId: string,
    public readonly incidentType: ComplianceIncidentType,
    public readonly severity: number,
  ) {
    super(
      451,
      'COMPLIANCE_BLOCK',
      `Account flagged: ${incidentType} (severity ${severity}). Money movement disabled pending compliance review.`,
      { incidentId, incidentType, severity },
    );
    this.name = 'ComplianceBlock';
  }
}

/**
 * Block the caller if the employee has any open/active blocking
 * incident at or above the hot-path severity threshold, OR if the
 * employee row itself is suspended.
 *
 * Always pass the transaction client — running this on the global
 * `prisma` from inside a transaction would defeat the consistency
 * guarantee by reading from a different MVCC snapshot.
 */
export async function enforceComplianceForAdvance(
  tx: Prisma.TransactionClient,
  employeeId: string,
): Promise<void> {
  const employee = await tx.employee.findUnique({
    where: { id: employeeId },
    select: { status: true },
  });

  if (!employee) {
    // Caller-side validation should have caught this; surfacing a
    // distinct code keeps the failure mode legible in logs.
    throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found');
  }

  if (
    employee.status === EmployeeStatus.BLOCKED ||
    employee.status === EmployeeStatus.DEACTIVATED
  ) {
    throw new AppError(
      451,
      'ACCOUNT_NOT_ACTIVE',
      `Account status ${employee.status} — money movement disabled.`,
      { employeeStatus: employee.status },
    );
  }

  if (employee.status === EmployeeStatus.PENDING_KYC) {
    throw new AppError(
      451,
      'KYC_NOT_COMPLETE',
      'KYC not complete — advances unlocked after Emirates ID verification.',
    );
  }

  const blocker = await tx.complianceIncident.findFirst({
    where: {
      employeeId,
      severity: { gte: HOT_PATH_BLOCKING_SEVERITY },
      status: { in: BLOCKING_INCIDENT_STATUSES },
    },
    orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, type: true, severity: true },
  });

  if (blocker) {
    throw new ComplianceBlock(employeeId, blocker.id, blocker.type, blocker.severity);
  }
}
