import bcrypt from 'bcryptjs';
import { prisma } from '@config/prisma';
import { env } from '@config/env';
import redisService from '@config/redis';
import { generateOTP } from '@shared/utils/otp';
import { generateTokens, TokenPair } from '@shared/utils/jwt';
import { generateReferralCode } from '@shared/utils/referralCode';
import { Conflict, Unauthorized } from '@shared/utils/errors';
import { twilioService } from './twilio.service';
import { cardsService } from '@modules/cards/cards.service';
import { referralsService } from '@modules/referrals/referrals.service';
import { VerifyOtpDto, RegisterCompanyDto } from './auth.dto';

export const authService = {
  // -------------------------------------------------------------- Employee

  async requestEmployeeOtp(phone: string): Promise<void> {
    const otp = generateOTP();
    await redisService.storeOTP(phone, otp);
    await twilioService.sendSms(
      phone,
      `Your FlexPay verification code is ${otp}. Expires in 5 minutes.`,
    );
  },

  async verifyEmployeeOtp(input: VerifyOtpDto): Promise<TokenPair & { employee: unknown }> {
    const ok = await redisService.verifyOTP(input.phone, input.otp);
    if (!ok) throw Unauthorized('Invalid or expired OTP');

    let employee = await prisma.employee.findUnique({ where: { phone: input.phone } });

    if (!employee) {
      employee = await prisma.employee.create({
        data: {
          phone: input.phone,
          fullName: input.fullName,
          salary: input.salary,
          companyId: input.companyId,
          referralCode: generateReferralCode(),
          status: 'PENDING_KYC',
        },
      });
      try {
        await cardsService.issueVirtualCard(employee.id);
      } catch {
        // card issuance is best-effort at signup
      }
      await referralsService.link(input.referralCode, employee.id);
    }

    if (employee.status === 'PENDING_KYC') {
      employee = await prisma.employee.update({
        where: { id: employee.id },
        data: { status: 'ACTIVE', lastLoginAt: new Date() },
      });
    } else {
      employee = await prisma.employee.update({
        where: { id: employee.id },
        data: { lastLoginAt: new Date() },
      });
    }

    const tokens = generateTokens({
      userId: employee.id,
      role: 'employee',
      companyId: employee.companyId ?? undefined,
    });

    return {
      ...tokens,
      employee: {
        id: employee.id,
        fullName: employee.fullName,
        balance: employee.walletBalance,
      },
    };
  },

  // --------------------------------------------------------------- Company

  async registerCompany(input: RegisterCompanyDto) {
    const existing = await prisma.company.findFirst({
      where: {
        OR: [
          { tradeLicense: input.tradeLicense },
          { adminEmail: input.adminEmail },
          { adminPhone: input.adminPhone },
        ],
      },
    });
    if (existing) throw Conflict('Company with the same trade license/email/phone already exists');

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

    return {
      ...tokens,
      company: { id: company.id, name: company.name, balance: company.balance },
    };
  },

  async loginCompany(email: string, password: string) {
    const company = await prisma.company.findUnique({ where: { adminEmail: email } });
    if (!company) throw Unauthorized('Invalid credentials');
    const ok = await bcrypt.compare(password, company.passwordHash);
    if (!ok) throw Unauthorized('Invalid credentials');

    const tokens = generateTokens({
      userId: company.id,
      role: 'company',
      companyId: company.id,
    });

    return {
      ...tokens,
      company: { id: company.id, name: company.name, balance: company.balance },
    };
  },
};
