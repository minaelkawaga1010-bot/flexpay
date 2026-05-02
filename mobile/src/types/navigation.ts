import { NavigatorScreenParams } from '@react-navigation/native';

export type AuthStackParamList = {
  Welcome: undefined;
  PhoneInput: undefined;
  OTP: { phone: string };
  ProfileSetup: { phone: string };
};

export type AppTabParamList = {
  Home: undefined;
  Wallet: NavigatorScreenParams<WalletStackParamList>;
  Cards: NavigatorScreenParams<CardsStackParamList>;
  Offers: undefined;
  Profile: undefined;
};

export type WalletStackParamList = {
  WalletHome: undefined;
  Transactions: undefined;
  Transfer: undefined;
  TransactionDetail: { transactionId: string };
  AddMoney: undefined;
};

export type CardsStackParamList = {
  CardsHome: undefined;
  VirtualCard: undefined;
  OrderPhysicalCard: undefined;
  PhysicalCard: undefined;
  Tokenize: undefined;
};

export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList>;
  App: NavigatorScreenParams<AppTabParamList>;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
