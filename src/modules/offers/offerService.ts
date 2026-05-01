import { prisma } from '../../config/db';
import { NotFound } from '../../utils/errors';

export const offerService = {
  async listActive() {
    const now = new Date();
    return prisma.offer.findMany({
      where: { isActive: true, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
  },

  async recordClick(offerId: string, employeeId: string, ip?: string) {
    const offer = await prisma.offer.findUnique({ where: { id: offerId } });
    if (!offer || !offer.isActive) throw NotFound('Offer not found');
    await prisma.offerClick.create({ data: { offerId, employeeId, ip } });
    return offer.affiliateLink;
  },

  async create(input: {
    title: string;
    description: string;
    discountPercentage: number;
    merchant: string;
    affiliateLink: string;
    imageUrl?: string;
    expiresAt: Date;
  }) {
    return prisma.offer.create({ data: input });
  },

  async update(id: string, patch: Partial<Parameters<typeof offerService.create>[0]> & { isActive?: boolean }) {
    return prisma.offer.update({ where: { id }, data: patch });
  },

  async remove(id: string) {
    await prisma.offer.update({ where: { id }, data: { isActive: false } });
  },
};
