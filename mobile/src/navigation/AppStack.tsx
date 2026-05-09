import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AppTabParamList, WalletStackParamList, CardsStackParamList } from '@/types/navigation';
import { HomeScreen } from '@screens/home/HomeScreen';
import { WalletScreen } from '@screens/wallet/WalletScreen';
import { TransferScreen } from '@screens/wallet/TransferScreen';
import { CardsScreen } from '@screens/cards/CardsScreen';
import { OrderPhysicalCardScreen } from '@screens/cards/OrderPhysicalCardScreen';
import { OffersScreen } from '@screens/offers/OffersScreen';
import { ProfileScreen } from '@screens/profile/ProfileScreen';

const Tab = createBottomTabNavigator<AppTabParamList>();
const WalletStackNav = createNativeStackNavigator<WalletStackParamList>();
const CardsStackNav = createNativeStackNavigator<CardsStackParamList>();

const WalletStack = () => (
  <WalletStackNav.Navigator screenOptions={{ headerLargeTitle: true }}>
    <WalletStackNav.Screen name="WalletHome" component={WalletScreen} options={{ title: 'Wallet' }} />
    <WalletStackNav.Screen name="Transfer" component={TransferScreen} options={{ title: 'Transfer' }} />
  </WalletStackNav.Navigator>
);

const CardsStack = () => (
  <CardsStackNav.Navigator screenOptions={{ headerLargeTitle: true }}>
    <CardsStackNav.Screen name="CardsHome" component={CardsScreen} options={{ title: 'Cards' }} />
    <CardsStackNav.Screen
      name="OrderPhysicalCard"
      component={OrderPhysicalCardScreen}
      options={{ title: 'Order physical card' }}
    />
  </CardsStackNav.Navigator>
);

export const AppStack: React.FC = () => (
  <Tab.Navigator screenOptions={{ headerShown: false }}>
    <Tab.Screen name="Home" component={HomeScreen} />
    <Tab.Screen name="Wallet" component={WalletStack} />
    <Tab.Screen name="Cards" component={CardsStack} />
    <Tab.Screen name="Offers" component={OffersScreen} />
    <Tab.Screen name="Profile" component={ProfileScreen} />
  </Tab.Navigator>
);
