import { NavigatorScreenParams } from '@react-navigation/native';

export type AuthStackParamList = {
  Welcome: undefined;
  PhoneInput: undefined;
  OTP: { phone: string };
  // OTP is carried forward in memory so the second verify call (which
  // sets `fullName`) can re-use it. The backend re-stores the OTP in
  // Redis when it raises FULL_NAME_REQUIRED, so the second call will
  // still find a valid OTP.
  ProfileSetup: { phone: string; otp: string };
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
