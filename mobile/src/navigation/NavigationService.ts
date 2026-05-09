import {
  CommonActions,
  createNavigationContainerRef,
  NavigationAction,
} from '@react-navigation/native';
import { RootStackParamList } from '@/types/navigation';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/**
 * Lets non-React modules (push handler, axios refresh failure, etc.)
 * issue navigation. All calls are no-ops until the NavigationContainer
 * is ready, so it's safe to call during boot.
 */
export const NavigationService = {
  navigate(name: keyof RootStackParamList, params?: Record<string, unknown>) {
    if (!navigationRef.isReady()) return;
    navigationRef.dispatch(CommonActions.navigate({ name: name as string, params }));
  },

  reset(name: keyof RootStackParamList, params?: Record<string, unknown>) {
    if (!navigationRef.isReady()) return;
    navigationRef.dispatch(
      CommonActions.reset({ index: 0, routes: [{ name: name as string, params }] }),
    );
  },

  dispatch(action: NavigationAction) {
    if (!navigationRef.isReady()) return;
    navigationRef.dispatch(action);
  },
};
