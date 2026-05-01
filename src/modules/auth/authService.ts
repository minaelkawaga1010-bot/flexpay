import bcrypt from 'bcrypt';
import { prisma } from '../../config/db';
import { otpService } from '../../services/otpService';
import { twilioService } from '../../services/twilioService';
import { signAccessToken, signRefreshToken } from '../../utils/jwt';
import { BadRequest, Conflict, Unauthorized } from '../../utils/errors';
import { generateReferralCode } from '../../utils/referral';
import { cardService } from '../cards/cardService';
import { referralService } from '../referrals/referralService';

const BCRYPT_ROUNDS = 10;

export const authService = {
  // ---------------------------------------------------------------- Employee

  async requestEmployeeOtp(phone: string): Promise<void> {
    const otp = otpService.generateOtp();
    await otpService.storeOtp(phone, otp);
    await twilioService.sendSms(phone, `Your FlexPay verification code is ${otp}. Expires in 5 minutes.`);
  },

  async verifyEmployeeOtp(input: {
    phone: string;
    otp: string;
    fullName: string;
    salary?: number;
    companyId?: string;
    referralCode?: string;
  }) {
    const ok = await otpService.verifyOtp(input.phone, input.otp);
    if (!ok) throw Unauthorized('Invalid or expired OTP');

    let employee = await prisma.employee.findUnique({ where: { phone: input.phone } });

    if (!employee) {
      employee = await prisma.employee.create({
        data: {
          phone: input.phone,
          fullName: input.fullName,
          salary: input.salary ?? 0,
          companyId: input.companyId,
          referralCode: generateReferralCode(),
          status: 'PENDING_KYC',
        },
      });
      // Auto-issue virtual card. Failures are non-fatal at signup time.
      try {
        await cardService.issueVirtualCard(employee.id);
      } catch {
        /* card issuance can be retried later */
      }
      await referralService.link(input.referralCode, employee.id);
    }

    if (employee.status === 'PENDING_KYC') {
      employee = await prisma.employee.update({
        where: { id: employee.id },
        data: { status: 'ACTIVE' },
      });
    }

    return this.issueEmployeeTokens(employee);
  },

  async issueEmployeeTokens(employee: { id: string; fullName: string; walletBalance: number; companyId: string | null }) {
    const token = signAccessToken({ sub: employee.id, role: 'employee', companyId: employee.companyId ?? undefined });
    const refreshToken = signRefreshToken({ sub: employee.id, role: 'employee' });
    return {
      token,
      refreshToken,
      employee: {
        id: employee.id,
        fullName: employee.fullName,
        balance: employee.walletBalance,
      },
    };
  },

  // ----------------------------------------------------------------- Company

  async registerCompany(input: {
    name: string;
    tradeLicense: string;
    adminName: string;
    adminEmail: string;
    adminPhone: string;
    password: string;
  }) {
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

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
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
    return this.issueCompanyTokens(company);
  },

  async loginCompany(email: string, password: string) {
    const company = await prisma.company.findUnique({ where: { adminEmail: email } });
    if (!company) throw Unauthorized('Invalid credentials');
    const ok = await bcrypt.compare(password, company.passwordHash);
    if (!ok) throw Unauthorized('Invalid credentials');
    return this.issueCompanyTokens(company);
  },

  issueCompanyTokens(company: { id: string; name: string; balance: number }) {
    const token = signAccessToken({ sub: company.id, role: 'company', companyId: company.id });
    const refreshToken = signRefreshToken({ sub: company.id, role: 'company' });
    return {
      token,
      refreshToken,
      company: { id: company.id, name: company.name, balance: company.balance },
    };
  },
};

export function assertPasswordPolicy(password: string): void {
  if (password.length < 8) throw BadRequest('Password must be at least 8 characters long');
}
