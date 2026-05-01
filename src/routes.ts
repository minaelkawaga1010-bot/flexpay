import { Router } from 'express';
import authController from './modules/auth/authController';
import walletController from './modules/wallet/walletController';
import companyController from './modules/companies/companyController';
import cardController from './modules/cards/cardController';
import offerController from './modules/offers/offerController';
import savingsController from './modules/savings/savingsController';
import creditScoreController from './modules/scoring/creditScoreController';
import ewaController from './modules/ewa/ewaController';
import remittanceController from './modules/remittance/remittanceController';
import referralController from './modules/referrals/referralController';
import notificationController from './modules/notifications/notificationController';

const router = Router();

router.use('/auth', authController);
router.use('/wallet', walletController);
router.use('/companies', companyController);
router.use('/cards', cardController);
router.use('/offers', offerController);
router.use('/savings', savingsController);
router.use('/employees', creditScoreController);
router.use('/ewa', ewaController);
router.use('/remittance', remittanceController);
router.use('/referrals', referralController);
router.use('/notifications', notificationController);

export default router;
