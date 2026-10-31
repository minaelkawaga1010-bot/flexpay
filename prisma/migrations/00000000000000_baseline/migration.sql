-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('EMPLOYEE', 'COMPANY', 'ADMIN');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('PENDING_KYC', 'ACTIVE', 'BLOCKED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "WageReceiptVehicle" AS ENUM ('UNIVERSAL_ACCOUNT', 'BANK_ACCOUNT', 'SVF_WALLET');

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'RECEIVE', 'CASHBACK', 'FEE', 'REFERRAL_REWARD', 'SAVINGS_TRANSFER', 'CARD_PURCHASE', 'PAYROLL', 'REMITTANCE', 'REFUND', 'BILL_PAYMENT');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "BillerType" AS ENUM ('DEWA', 'SEWA', 'ADDC', 'FEWA', 'ETISALAT', 'DU', 'SALIK', 'RTA', 'OTHER');

-- CreateEnum
CREATE TYPE "BillPaymentStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "CardStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED', 'EXPIRED', 'REPLACED');

-- CreateEnum
CREATE TYPE "CardType" AS ENUM ('VIRTUAL', 'PHYSICAL');

-- CreateEnum
CREATE TYPE "PlanType" AS ENUM ('BASIC', 'LUXURY');

-- CreateEnum
CREATE TYPE "SavingsGoalStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'PAUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('PENDING', 'APPROVED', 'ACTIVE', 'REPAID', 'DEFAULTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'REWARDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PayrollCycleStatus" AS ENUM ('OPEN', 'INGESTING', 'INTENTS_READY', 'SETTLED', 'FAILED');

-- CreateEnum
CREATE TYPE "PayrollIntentStatus" AS ENUM ('PENDING', 'ROUTED', 'FAILED');

-- CreateEnum
CREATE TYPE "AdvanceStatus" AS ENUM ('REQUESTED', 'APPROVED', 'RESERVED', 'SETTLED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('ADVANCE_RESERVE', 'ADVANCE_SETTLE', 'PAYROLL_RESIDUAL', 'PAYROLL_FULL', 'RECONCILIATION_ADJ');

-- CreateEnum
CREATE TYPE "KycDocumentType" AS ENUM ('EMIRATES_ID_FRONT', 'EMIRATES_ID_BACK', 'PASSPORT', 'SELFIE', 'VISA_PAGE', 'PROOF_OF_ADDRESS');

-- CreateEnum
CREATE TYPE "KycDocumentStatus" AS ENUM ('PENDING_OCR', 'EXTRACTED', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ComplianceIncidentType" AS ENUM ('SANCTIONS_HIT', 'KYC_REJECTION', 'AML_PATTERN_MATCH', 'PEP_HIT', 'HIGH_RISK_COUNTRY', 'IDENTITY_MISMATCH', 'DUPLICATE_IDENTITY');

-- CreateEnum
CREATE TYPE "ComplianceIncidentStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED_NO_ACTION', 'RESOLVED_BLOCKED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "SanctionsListSource" AS ENUM ('UN_CONSOLIDATED', 'OFAC_SDN', 'UAE_LOCAL', 'EU_CONSOLIDATED', 'UK_HMT');

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phoneHash" TEXT,
    "email" TEXT,
    "fullName" TEXT NOT NULL,
    "fullNameEncrypted" TEXT,
    "salary" DOUBLE PRECISION,
    "salaryEncrypted" TEXT,
    "phoneEncrypted" TEXT,
    "emailEncrypted" TEXT,
    "emailHash" TEXT,
    "walletBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "plan" "PlanType" NOT NULL DEFAULT 'BASIC',
    "wageReceiptVehicle" "WageReceiptVehicle",
    "wpsLicensedEntity" TEXT,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'PENDING_KYC',
    "kycVerifiedAt" TIMESTAMP(3),
    "nymcardCustomerId" TEXT,
    "referralCode" TEXT NOT NULL,
    "creditScore" INTEGER DEFAULT 50,
    "creditScoreUpdatedAt" TIMESTAMP(3),
    "deviceToken" TEXT,
    "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "companyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tradeLicense" TEXT NOT NULL,
    "adminName" TEXT NOT NULL,
    "adminEmail" TEXT NOT NULL,
    "adminPhone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE',
    "payrollDay" INTEGER,
    "autoPayrollEnabled" BOOLEAN NOT NULL DEFAULT false,
    "hrLagBufferPercent" DOUBLE PRECISION NOT NULL DEFAULT 0.10,
    "ewaFailsafeActive" BOOLEAN NOT NULL DEFAULT false,
    "ewaFailsafeTrippedAt" TIMESTAMP(3),
    "ewaFailsafeReason" TEXT,
    "ewaFailsafeDefaultRatio" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cards" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "CardType" NOT NULL,
    "status" "CardStatus" NOT NULL DEFAULT 'ACTIVE',
    "last4" CHAR(4) NOT NULL,
    "brand" TEXT NOT NULL DEFAULT 'VISA',
    "expiryMonth" INTEGER NOT NULL,
    "expiryYear" INTEGER NOT NULL,
    "dailyLimit" DOUBLE PRECISION NOT NULL DEFAULT 5000,
    "monthlyLimit" DOUBLE PRECISION NOT NULL DEFAULT 50000,
    "spentToday" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "spentThisMonth" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shippingAddress" JSONB,
    "trackingNumber" TEXT,
    "shippingStatus" TEXT,
    "applePayToken" TEXT,
    "googlePayToken" TEXT,
    "employeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_transactions" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "status" "TransactionStatus" NOT NULL DEFAULT 'COMPLETED',
    "description" TEXT,
    "reference" TEXT,
    "merchantName" TEXT,
    "merchantCategory" TEXT,
    "location" JSONB,
    "counterpartyId" TEXT,
    "counterpartyPhone" TEXT,
    "cardId" TEXT,
    "payrollId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "employee_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_payrolls" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeIds" TEXT[],
    "amountPerEmployee" JSONB,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),
    "status" "PayrollStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_payrolls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "savings_goals" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "targetAmount" DOUBLE PRECISION NOT NULL,
    "savedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monthlyAuto" DOUBLE PRECISION,
    "autoSaveDay" INTEGER,
    "deadline" TIMESTAMP(3),
    "status" "SavingsGoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "savings_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loans" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "principal" DOUBLE PRECISION NOT NULL,
    "interestRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "termDays" INTEGER NOT NULL,
    "status" "LoanStatus" NOT NULL DEFAULT 'PENDING',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "disbursedAmount" DOUBLE PRECISION,
    "disbursedAt" TIMESTAMP(3),
    "disbursementTxnId" TEXT,
    "repaidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "nextDueDate" TIMESTAMP(3),
    "nextDueAmount" DOUBLE PRECISION,
    "finalDueDate" TIMESTAMP(3),
    "partnerReference" TEXT,
    "partnerData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "refereeId" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "rewardGiven" BOOLEAN NOT NULL DEFAULT false,
    "rewardAmount" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "refereeFirstDepositAt" TIMESTAMP(3),
    "refereeFirstDepositAmount" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rewardedAt" TIMESTAMP(3),

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "discountPercentage" INTEGER NOT NULL,
    "merchant" TEXT NOT NULL,
    "affiliateLink" TEXT NOT NULL,
    "imageUrl" TEXT,
    "terms" TEXT,
    "planRequired" "PlanType",
    "minSalary" DOUBLE PRECISION,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_clicks" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "clickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "converted" BOOLEAN NOT NULL DEFAULT false,
    "conversionValue" DOUBLE PRECISION,

    CONSTRAINT "offer_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_cycles" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "fileFingerprint" TEXT,
    "fileFormat" TEXT,
    "status" "PayrollCycleStatus" NOT NULL DEFAULT 'OPEN',
    "failureReason" TEXT,
    "ingestedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_intents" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "grossAmount" DOUBLE PRECISION NOT NULL,
    "accruedAmount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "status" "PayrollIntentStatus" NOT NULL DEFAULT 'PENDING',
    "fileLineHash" TEXT NOT NULL,
    "routedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advances" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "status" "AdvanceStatus" NOT NULL DEFAULT 'REQUESTED',
    "failureReason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "reservedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "dcseModelVersion" TEXT,
    "dcseLimitAtReq" DOUBLE PRECISION,
    "dcseRiskScoreAtReq" DOUBLE PRECISION,

    CONSTRAINT "advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "employeeId" TEXT NOT NULL,
    "cycleId" TEXT,
    "intentId" TEXT,
    "advanceId" TEXT,
    "delta" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "fcmToken" TEXT,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_documents" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "KycDocumentType" NOT NULL,
    "status" "KycDocumentStatus" NOT NULL DEFAULT 'PENDING_OCR',
    "storageUri" TEXT NOT NULL,
    "imageHash" TEXT NOT NULL,
    "emiratesIdNumber" TEXT,
    "emiratesIdHash" TEXT,
    "fullName" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "nationality" TEXT,
    "documentExpiry" TIMESTAMP(3),
    "extra" JSONB,
    "extractorVersion" TEXT,
    "extractorScore" DOUBLE PRECISION,
    "rejectionReason" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyc_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_incidents" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "ComplianceIncidentType" NOT NULL,
    "status" "ComplianceIncidentStatus" NOT NULL DEFAULT 'OPEN',
    "severity" INTEGER NOT NULL,
    "evidence" JSONB NOT NULL,
    "sanctionsListSnapshotId" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sanctions_list_snapshots" (
    "id" TEXT NOT NULL,
    "source" "SanctionsListSource" NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entryCount" INTEGER NOT NULL,
    "checksumSha256" TEXT NOT NULL,

    CONSTRAINT "sanctions_list_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sanctions_list_entries" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "externalRef" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "aliases" TEXT[],
    "dateOfBirth" TIMESTAMP(3),
    "nationality" TEXT,
    "remarks" TEXT,
    "normalisedName" TEXT NOT NULL,

    CONSTRAINT "sanctions_list_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_payments" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "billerType" "BillerType" NOT NULL,
    "billerAccountRef" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "status" "BillPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "externalRef" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "walletTransactionId" TEXT,
    "refundTransactionId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "bill_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employees_phone_key" ON "employees"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "employees_email_key" ON "employees"("email");

-- CreateIndex
CREATE UNIQUE INDEX "employees_referralCode_key" ON "employees"("referralCode");

-- CreateIndex
CREATE INDEX "employees_phone_idx" ON "employees"("phone");

-- CreateIndex
CREATE INDEX "employees_phoneHash_idx" ON "employees"("phoneHash");

-- CreateIndex
CREATE INDEX "employees_companyId_idx" ON "employees"("companyId");

-- CreateIndex
CREATE INDEX "employees_status_idx" ON "employees"("status");

-- CreateIndex
CREATE INDEX "employees_referralCode_idx" ON "employees"("referralCode");

-- CreateIndex
CREATE UNIQUE INDEX "companies_tradeLicense_key" ON "companies"("tradeLicense");

-- CreateIndex
CREATE UNIQUE INDEX "companies_adminEmail_key" ON "companies"("adminEmail");

-- CreateIndex
CREATE UNIQUE INDEX "companies_adminPhone_key" ON "companies"("adminPhone");

-- CreateIndex
CREATE INDEX "companies_adminEmail_idx" ON "companies"("adminEmail");

-- CreateIndex
CREATE INDEX "companies_tradeLicense_idx" ON "companies"("tradeLicense");

-- CreateIndex
CREATE INDEX "companies_ewaFailsafeActive_idx" ON "companies"("ewaFailsafeActive");

-- CreateIndex
CREATE UNIQUE INDEX "cards_cardId_key" ON "cards"("cardId");

-- CreateIndex
CREATE INDEX "cards_customerId_idx" ON "cards"("customerId");

-- CreateIndex
CREATE INDEX "cards_employeeId_idx" ON "cards"("employeeId");

-- CreateIndex
CREATE INDEX "cards_status_idx" ON "cards"("status");

-- CreateIndex
CREATE UNIQUE INDEX "cards_employeeId_type_key" ON "cards"("employeeId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "employee_transactions_idempotencyKey_key" ON "employee_transactions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "employee_transactions_employeeId_createdAt_idx" ON "employee_transactions"("employeeId", "createdAt");

-- CreateIndex
CREATE INDEX "employee_transactions_employeeId_type_status_idx" ON "employee_transactions"("employeeId", "type", "status");

-- CreateIndex
CREATE INDEX "employee_transactions_reference_idx" ON "employee_transactions"("reference");

-- CreateIndex
CREATE INDEX "employee_transactions_idempotencyKey_idx" ON "employee_transactions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "scheduled_payrolls_companyId_scheduledDate_idx" ON "scheduled_payrolls"("companyId", "scheduledDate");

-- CreateIndex
CREATE INDEX "scheduled_payrolls_status_idx" ON "scheduled_payrolls"("status");

-- CreateIndex
CREATE INDEX "savings_goals_employeeId_status_idx" ON "savings_goals"("employeeId", "status");

-- CreateIndex
CREATE INDEX "loans_employeeId_status_idx" ON "loans"("employeeId", "status");

-- CreateIndex
CREATE INDEX "loans_partnerReference_idx" ON "loans"("partnerReference");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_refereeId_key" ON "referrals"("refereeId");

-- CreateIndex
CREATE INDEX "referrals_referrerId_idx" ON "referrals"("referrerId");

-- CreateIndex
CREATE INDEX "referrals_refereeId_idx" ON "referrals"("refereeId");

-- CreateIndex
CREATE INDEX "referrals_status_idx" ON "referrals"("status");

-- CreateIndex
CREATE INDEX "offers_merchant_isActive_idx" ON "offers"("merchant", "isActive");

-- CreateIndex
CREATE INDEX "offers_expiresAt_idx" ON "offers"("expiresAt");

-- CreateIndex
CREATE INDEX "offer_clicks_offerId_clickedAt_idx" ON "offer_clicks"("offerId", "clickedAt");

-- CreateIndex
CREATE INDEX "offer_clicks_employeeId_idx" ON "offer_clicks"("employeeId");

-- CreateIndex
CREATE INDEX "audit_logs_actorType_actorId_createdAt_idx" ON "audit_logs"("actorType", "actorId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_cycles_fileFingerprint_key" ON "payroll_cycles"("fileFingerprint");

-- CreateIndex
CREATE INDEX "payroll_cycles_status_settledAt_idx" ON "payroll_cycles"("status", "settledAt");

-- CreateIndex
CREATE INDEX "payroll_cycles_status_periodEnd_idx" ON "payroll_cycles"("status", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_cycles_companyId_periodStart_periodEnd_key" ON "payroll_cycles"("companyId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "payroll_intents_status_idx" ON "payroll_intents"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_intents_cycleId_employeeId_key" ON "payroll_intents"("cycleId", "employeeId");

-- CreateIndex
CREATE INDEX "advances_employeeId_status_idx" ON "advances"("employeeId", "status");

-- CreateIndex
CREATE INDEX "advances_cycleId_status_idx" ON "advances"("cycleId", "status");

-- CreateIndex
CREATE INDEX "advances_status_requestedAt_idx" ON "advances"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "ledger_entries_cycleId_idx" ON "ledger_entries"("cycleId");

-- CreateIndex
CREATE INDEX "ledger_entries_employeeId_createdAt_idx" ON "ledger_entries"("employeeId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "devices_employeeId_revoked_idx" ON "devices"("employeeId", "revoked");

-- CreateIndex
CREATE UNIQUE INDEX "devices_employeeId_fingerprint_key" ON "devices"("employeeId", "fingerprint");

-- CreateIndex
CREATE INDEX "kyc_documents_employeeId_type_idx" ON "kyc_documents"("employeeId", "type");

-- CreateIndex
CREATE INDEX "kyc_documents_status_idx" ON "kyc_documents"("status");

-- CreateIndex
CREATE INDEX "kyc_documents_emiratesIdHash_idx" ON "kyc_documents"("emiratesIdHash");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_documents_imageHash_key" ON "kyc_documents"("imageHash");

-- CreateIndex
CREATE INDEX "compliance_incidents_employeeId_status_idx" ON "compliance_incidents"("employeeId", "status");

-- CreateIndex
CREATE INDEX "compliance_incidents_type_createdAt_idx" ON "compliance_incidents"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "sanctions_list_snapshots_checksumSha256_key" ON "sanctions_list_snapshots"("checksumSha256");

-- CreateIndex
CREATE INDEX "sanctions_list_snapshots_source_ingestedAt_idx" ON "sanctions_list_snapshots"("source", "ingestedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "sanctions_list_snapshots_source_publishedAt_key" ON "sanctions_list_snapshots"("source", "publishedAt");

-- CreateIndex
CREATE INDEX "sanctions_list_entries_snapshotId_idx" ON "sanctions_list_entries"("snapshotId");

-- CreateIndex
CREATE INDEX "sanctions_list_entries_normalisedName_idx" ON "sanctions_list_entries"("normalisedName");

-- CreateIndex
CREATE UNIQUE INDEX "bill_payments_idempotencyKey_key" ON "bill_payments"("idempotencyKey");

-- CreateIndex
CREATE INDEX "bill_payments_employeeId_createdAt_idx" ON "bill_payments"("employeeId", "createdAt");

-- CreateIndex
CREATE INDEX "bill_payments_status_createdAt_idx" ON "bill_payments"("status", "createdAt");

-- CreateIndex
CREATE INDEX "bill_payments_externalRef_idx" ON "bill_payments"("externalRef");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_transactions" ADD CONSTRAINT "employee_transactions_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_transactions" ADD CONSTRAINT "employee_transactions_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_payrolls" ADD CONSTRAINT "scheduled_payrolls_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "savings_goals" ADD CONSTRAINT "savings_goals_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_refereeId_fkey" FOREIGN KEY ("refereeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_clicks" ADD CONSTRAINT "offer_clicks_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_clicks" ADD CONSTRAINT "offer_clicks_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_cycles" ADD CONSTRAINT "payroll_cycles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_intents" ADD CONSTRAINT "payroll_intents_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "payroll_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_intents" ADD CONSTRAINT "payroll_intents_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advances" ADD CONSTRAINT "advances_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advances" ADD CONSTRAINT "advances_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "payroll_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "payroll_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "payroll_intents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "advances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_incidents" ADD CONSTRAINT "compliance_incidents_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_incidents" ADD CONSTRAINT "compliance_incidents_sanctionsListSnapshotId_fkey" FOREIGN KEY ("sanctionsListSnapshotId") REFERENCES "sanctions_list_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sanctions_list_entries" ADD CONSTRAINT "sanctions_list_entries_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "sanctions_list_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

