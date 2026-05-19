import { LinkingOptions } from '@react-navigation/native';
import { RootStackParamList } from '@/types/navigation';

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['flexpay://', 'https://flexpay.ae'],
  config: {
    screens: {
      Auth: {
        screens: {
          Welcome: 'welcome',
          PhoneInput: 'login',
          OTP: 'login/otp',
        },
      },
      App: {
        screens: {
          Home: 'home',
          Wallet: {
            screens: {
              WalletHome: 'wallet',
              Transactions: 'wallet/transactions',
              Transfer: 'wallet/transfer',
              TransactionDetail: 'wallet/tx/:transactionId',
              AddMoney: 'wallet/add',
            },
          },
          Cards: {
            screens: {
              CardsHome: 'cards',
              VirtualCard: 'cards/virtual',
              OrderPhysicalCard: 'cards/order',
              PhysicalCard: 'cards/physical',
              Tokenize: 'cards/tokenize',
            },
          },
          Offers: 'offers',
          Profile: 'profile',
        },
      },
    },
  },
};
