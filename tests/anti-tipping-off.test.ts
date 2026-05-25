/**
 * Anti-tipping-off — ComplianceBlock serialization audit.
 *
 * UAE/FATF rule: a sanctioned / AML-flagged subject must NOT learn
 * they've been flagged. These tests pin that sanctions/PEP/AML blocks
 * surface as a generic transient error on the wire (no classification),
 * while operational blocks (KYC rejection) stay informative.
 */

import { ComplianceIncidentType } from '@prisma/client';
import {
  ComplianceBlock,
  isTippingOffSensitive,
  TIPPING_OFF_SENSITIVE_TYPES,
} from '../src/modules/compliance/compliance.guard';

describe('anti-tipping-off classification', () => {
  it('treats SANCTIONS_HIT / PEP_HIT / AML_PATTERN_MATCH as sensitive', () => {
    expect(isTippingOffSensitive(ComplianceIncidentType.SANCTIONS_HIT)).toBe(true);
    expect(isTippingOffSensitive(ComplianceIncidentType.PEP_HIT)).toBe(true);
    expect(isTippingOffSensitive(ComplianceIncidentType.AML_PATTERN_MATCH)).toBe(true);
    expect(TIPPING_OFF_SENSITIVE_TYPES).toHaveLength(3);
  });

  it('treats KYC_REJECTION as NOT sensitive (worker should be told to act)', () => {
    expect(isTippingOffSensitive(ComplianceIncidentType.KYC_REJECTION)).toBe(false);
  });
});

describe('ComplianceBlock — wire serialization', () => {
  it('SANCTIONS_HIT surfaces as a generic 503 with NO classification on the wire', () => {
    const err = new ComplianceBlock('emp-1', 'inc-9', ComplianceIncidentType.SANCTIONS_HIT, 5);
    // Still a ComplianceBlock (instanceof preserved for the guard tests).
    expect(err).toBeInstanceOf(ComplianceBlock);
    // Generic transient surface — reads as an outage, not a compliance hold.
    expect(err.status).toBe(503);
    expect(err.code).toBe('SERVICE_UNAVAILABLE');
    // The message + serialized details must NOT contain the classification.
    expect(err.message).not.toMatch(/SANCTIONS|AML|PEP|flagged|compliance/i);
    expect(JSON.stringify(err.details)).not.toMatch(/SANCTIONS|incidentType|severity/i);
    // Only an opaque support reference is exposed.
    expect(err.details).toEqual({ ref: 'inc-9' });
    // The truth is retained as instance props for server-side logging.
    expect(err.incidentType).toBe(ComplianceIncidentType.SANCTIONS_HIT);
    expect(err.severity).toBe(5);
  });

  it('AML_PATTERN_MATCH is likewise generic', () => {
    const err = new ComplianceBlock('emp-2', 'inc-10', ComplianceIncidentType.AML_PATTERN_MATCH, 4);
    expect(err.status).toBe(503);
    expect(err.message).not.toMatch(/AML|pattern|flagged/i);
  });

  it('KYC_REJECTION stays informative (451, tells the worker to act)', () => {
    const err = new ComplianceBlock('emp-3', 'inc-11', ComplianceIncidentType.KYC_REJECTION, 3);
    expect(err.status).toBe(451);
    expect(err.code).toBe('COMPLIANCE_BLOCK');
    expect(err.message).toMatch(/KYC_REJECTION/);
  });
});
