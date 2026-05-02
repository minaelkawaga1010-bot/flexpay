import bcrypt from 'bcryptjs';
import { Prisma, EmployeeStatus, PlanType, CompanyStatus } from '@prisma/client';
import { prisma } from '@config/prisma';
import redisService from '@config/redis';
import { env } from '@config/env';
import {
  generateAccessToken,
  generateTokens,
  JWTPayload,
  TokenPair,
  verifyRefreshToken,
} from '@shared/utils/jwt';
import { generateOTP } from '@shared/utils/otp';
import { generateReferralCode } from '@shared/utils/referralCode';
import { AppError, Conflict, Unauthorized, Forbidden } from '@shared/utils/errors';
import logger from '@shared/utils/logger';
import { twilioService } from './twilio.service';
import { nymcardService } from '@modules/cards/nymcard.service';

export class AuthService {
  // ----------------------------------------------------- Employee: OTP send

  async requestEmployeeOTP(phone: string): Promise<{ message: string }> {
    const otp = generateOTP();
    await redisService.storeOTP(phone, otp);
    await twilioService.sendOTP(phone, otp);
    logger.info('OTP sent', { phone, otpLength: otp.length });
    return { message: 'OTP sent successfully' };
  }

  // ------------------------------------------------- Employee: OTP verify

  async verifyEmployeeOTP(input: {
    phone: string;
    otp: string;
    fullName?: string;
    salary?: number;
    companyId?: string;
    referralCode?: string;
  }): Promise<{ accessToken: string; refreshToken: string; user: Record<string, unknown> }> {
    const isValid = await redisService.verifyOTP(input.phone, input.otp);
    if (!isValid) throw Unauthorized('INVALID_OR_EXPIRED_OTP');

    let employee = await prisma.employee.findUnique({
      where: { phone: input.phone },
      include: { cards: { where: { type: 'VIRTUAL' }, take: 1 } },
    });

    if (employee) {
      if (employee.status === EmployeeStatus.BLOCKED) throw Forbidden('ACCOUNT_BLOCKED');
      employee = await prisma.employee.update({
        where: { id: employee.id },
        data: { lastLoginAt: new Date() },
        include: { cards: { where: { type: 'VIRTUAL' }, take: 1 } },
      });
    } else {
      // The OTP was correct, but no account exists yet — surface a
      // structured 422 so the mobile client can navigate forward to its
      // ProfileSetupScreen and re-call verify with `fullName` filled in.
      // verifyOTP() above already deleted the OTP from Redis, so we
      // re-store it (resetting the 5-minute TTL) before signalling.
      if (!input.fullName) {
        await redisService.storeOTP(input.phone, input.otp);
        throw new AppError(
          422,
          'FULL_NAME_REQUIRED',
          'Profile setup needed: fullName is required to create the account.',
        );
      }
      employee = await this.createEmployee({ ...input, fullName: input.fullName });
    }

    const payload: JWTPayload = {
      userId: employee.id,
      role: 'employee',
      companyId: employee.companyId ?? undefined,
    };
    const tokens = generateTokens(payload);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: employee.id,
        role: 'employee',
        phone: employee.phone,
        fullName: employee.fullName,
        balance: employee.walletBalance,
        plan: employee.plan,
        status: employee.status,
        companyId: employee.companyId,
        virtualCardLast4: employee.cards[0]?.last4 ?? null,
      },
    };
  }

  // -------------------------------------------- Employee: registration tx

  private async createEmployee(input: {
    phone: string;
    fullName: string;
    salary?: number;
    companyId?: string;
    referralCode?: string;
  }) {
    const employee = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.employee.create({
        data: {
          phone: input.phone,
          fullName: input.fullName,
          salary: input.salary,
          companyId: input.companyId,
          // Always issue the new employee their OWN unique referral code.
          // `input.referralCode` is the *referrer's* code and is consumed below.
          referralCode: generateReferralCode(),
          status: EmployeeStatus.PENDING_KYC,
          plan: PlanType.BASIC,
        },
      });

      // Process incoming referral if one was provided.
      if (input.referralCode) {
        await this.processReferralOnSignup(input.referralCode, created.id, tx);
      }

      return created;
    });

    // Card issuance happens outside the registration transaction so that
    // a NymCard outage doesn't roll back the user account. The card record
    // owns its own DB consistency via cardsService.issueVirtualCard.
    try {
      const customer = await nymcardService.createCustomer({
        name: employee.fullName,
        email: `${employee.phone.replace(/\+/g, '')}@flexpay.ae`,
        phone: employee.phone,
      });

      const issued = await nymcardService.issueVirtualCard(customer.id);

      await prisma.$transaction([
        prisma.card.create({
          data: {
            cardId: issued.cardId,
            customerId: customer.id,
            type: 'VIRTUAL',
            status: 'ACTIVE',
            last4: issued.last4,
            brand: issued.brand ?? 'VISA',
            expiryMonth: issued.expiryMonth,
            expiryYear: issued.expiryYear,
            employeeId: employee.id,
          },
        }),
        prisma.employee.update({
          where: { id: employee.id },
          data: {
            nymcardCustomerId: customer.id,
            status: EmployeeStatus.ACTIVE,
          },
        }),
      ]);

      logger.info('NymCard integration completed', { employeeId: employee.id });
    } catch (error) {
      // Card can be retried later. Don't block account creation.
      logger.error('NymCard integration failed', {
        employeeId: employee.id,
        error: (error as Error).message,
      });
    }

    await twilioService.sendWelcomeSMS(employee.phone);

    return prisma.employee.findUniqueOrThrow({
      where: { id: employee.id },
      include: { cards: { where: { type: 'VIRTUAL' }, take: 1 } },
    });
  }

  // --------------------------------------------------- Company: register

  async registerCompany(
    input: {
      name: string;
      tradeLicense: string;
      adminName: string;
      adminEmail: string;
      adminPhone: string;
      password: string;
    },
    ipAddress?: string,
  ) {
    const existing = await prisma.company.findFirst({
      where: {
        OR: [
          { tradeLicense: input.tradeLicense },
          { adminEmail: input.adminEmail },
          { adminPhone: input.adminPhone },
        ],
      },
    });

    if (existing) {
      if (existing.tradeLicense === input.tradeLicense) {
        throw Conflict('TRADE_LICENSE_ALREADY_REGISTERED');
      }
      if (existing.adminEmail === input.adminEmail) {
        throw Conflict('EMAIL_ALREADY_REGISTERED');
      }
      throw Conflict('PHONE_ALREADY_REGISTERED');
    }

    const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_SALT_ROUNDS);
    const company = await prisma.company.create({
      data: {
        name: input.name,
        tradeLicense: input.tradeLicense,
        adminName: input.adminName,
        adminEmail: input.adminEmail,
        adminPhone: input.adminPhone,
        passwordHash,
      },
    });

    const tokens = generateTokens({
      userId: company.id,
      role: 'company',
      companyId: company.id,
    });

    await prisma.auditLog.create({
      data: {
        actorType: 'company',
        actorId: company.id,
        action: 'COMPANY_REGISTERED',
        ipAddress: ipAddress ?? null,
      },
    });

    return {
      ...tokens,
      company: {
        id: company.id,
        name: company.name,
        adminEmail: company.adminEmail,
        balance: company.balance,
      },
    };
  }

  // ------------------------------------------------------ Company: login

  async loginCompany(email: string, password: string, ipAddress?: string) {
    const company = await prisma.company.findUnique({ where: { adminEmail: email } });
    if (!company) throw Unauthorized('INVALID_CREDENTIALS');
    if (company.status !== CompanyStatus.ACTIVE) throw Forbidden('ACCOUNT_SUSPENDED');

    const ok = await bcrypt.compare(password, company.passwordHash);
    if (!ok) throw Unauthorized('INVALID_CREDENTIALS');

    const tokens = generateTokens({
      userId: company.id,
      role: 'company',
      companyId: company.id,
    });

    await prisma.company.update({ where: { id: company.id }, data: { updatedAt: new Date() } });
    await prisma.auditLog.create({
      data: {
        actorType: 'company',
        actorId: company.id,
        action: 'COMPANY_LOGIN',
        ipAddress: ipAddress ?? null,
      },
    });

    return {
      ...tokens,
      company: {
        id: company.id,
        name: company.name,
        adminEmail: company.adminEmail,
        balance: company.balance,
      },
    };
  }

  // ------------------------------------------------------- Token refresh

  async refreshTokens(refreshToken: string): Promise<TokenPair> {
    let payload: JWTPayload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      throw Unauthorized('INVALID_REFRESH_TOKEN');
    }

    const user =
      payload.role === 'employee'
        ? await prisma.employee.findUnique({ where: { id: payload.userId } })
        : await prisma.company.findUnique({ where: { id: payload.userId } });

    if (!user) throw Unauthorized('USER_NOT_FOUND');

    return generateTokens({
      userId: payload.userId,
      role: payload.role,
      companyId: payload.role === 'company' ? payload.userId : payload.companyId,
    });
  }

  // ----------------------------------------------------------- Internals

  private async processReferralOnSignup(
    referralCode: string,
    newEmployeeId: string,
    tx: Prisma.TransactionClient,
  ) {
    // findFirst (not findUnique) so we can combine the unique referralCode
    // with a non-unique status filter.
    const referrer = await tx.employee.findFirst({
      where: { referralCode, status: EmployeeStatus.ACTIVE },
    });
    if (!referrer || referrer.id === newEmployeeId) return;

    const existing = await tx.referral.findUnique({ where: { refereeId: newEmployeeId } });
    if (existing) return;

    await tx.referral.create({
      data: { referrerId: referrer.id, refereeId: newEmployeeId, status: 'PENDING' },
    });

    logger.info('Referral recorded', { referrerId: referrer.id, refereeId: newEmployeeId });
  }

  /** Re-issue a short-lived access token from an authenticated subject. */
  reissueAccessToken(payload: JWTPayload): string {
    return generateAccessToken(payload);
  }
}

export const authService = new AuthService();
