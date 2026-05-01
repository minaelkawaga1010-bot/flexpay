import { Router } from 'express';
import authRoutes from '@modules/auth/auth.routes';
import walletRoutes from '@modules/wallet/wallet.routes';
import payrollRoutes from '@modules/payroll/payroll.routes';
import cardsRoutes from '@modules/cards/cards.routes';
import offersRoutes from '@modules/offers/offers.routes';
import savingsRoutes from '@modules/savings/savings.routes';
import scoringRoutes from '@modules/scoring/scoring.controller';
import ewaRoutes from '@modules/ewa/ewa.controller';
import remittanceRoutes from '@modules/remittance/remittance.controller';
import referralsRoutes from '@modules/referrals/referrals.routes';
import notificationRoutes from '@modules/notifications/notification.controller';

const router = Router();

router.use('/auth', authRoutes);
router.use('/wallet', walletRoutes);
router.use('/companies', payrollRoutes);
router.use('/cards', cardsRoutes);
router.use('/offers', offersRoutes);
router.use('/savings', savingsRoutes);
router.use('/employees', scoringRoutes);
router.use('/ewa', ewaRoutes);
router.use('/remittance', remittanceRoutes);
router.use('/referrals', referralsRoutes);
router.use('/notifications', notificationRoutes);

export default router;
