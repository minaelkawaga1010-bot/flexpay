import { prisma } from '@config/prisma';
import { NotFound } from '@shared/utils/errors';

export interface CreateOfferInput {
  title: string;
  description?: string;
  discountPercentage: number;
  merchant: string;
  affiliateLink: string;
  imageUrl?: string;
  expiresAt: Date;
}

export const offersService = {
  async listActive() {
    return prisma.offer.findMany({
      where: { isActive: true, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
  },

  async recordClick(offerId: string, employeeId: string, ipAddress?: string, userAgent?: string) {
    const offer = await prisma.offer.findUnique({ where: { id: offerId } });
    if (!offer || !offer.isActive) throw NotFound('Offer not found');
    await prisma.$transaction([
      prisma.offerClick.create({ data: { offerId, employeeId, ipAddress, userAgent } }),
      prisma.offer.update({ where: { id: offerId }, data: { clicks: { increment: 1 } } }),
    ]);
    return offer.affiliateLink;
  },

  async create(input: CreateOfferInput) {
    return prisma.offer.create({ data: input });
  },

  async update(id: string, patch: Partial<CreateOfferInput> & { isActive?: boolean }) {
    return prisma.offer.update({ where: { id }, data: patch });
  },

  async deactivate(id: string) {
    await prisma.offer.update({ where: { id }, data: { isActive: false } });
  },
};
