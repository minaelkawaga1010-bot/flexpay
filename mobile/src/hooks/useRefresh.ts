import { useCallback, useState } from 'react';

export function useRefresh(fn: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fn();
    } finally {
      setRefreshing(false);
    }
  }, [fn]);
  return { refreshing, onRefresh };
}
