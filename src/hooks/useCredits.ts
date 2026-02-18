'use client';

// =============================================================================
// useCredits Hook
// Fetches and caches the user's credit balance. Provides a refetch function
// for updating after purchases or generations.
// =============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';

interface CreditState {
  balance: number;
  lifetimePurchased: number;
  isLoading: boolean;
  error: string | null;
}

export function useCredits() {
  const [state, setState] = useState<CreditState>({
    balance: 0,
    lifetimePurchased: 0,
    isLoading: true,
    error: null,
  });

  const isMounted = useRef(true);

  const fetchBalance = useCallback(async () => {
    try {
      const res = await fetch('/api/credits/balance', { credentials: 'include' });
      if (!res.ok) {
        if (res.status === 401) {
          // Not authenticated — not an error, just no balance
          if (isMounted.current) {
            setState({ balance: 0, lifetimePurchased: 0, isLoading: false, error: null });
          }
          return;
        }
        throw new Error('Failed to fetch balance');
      }

      const data = await res.json();
      if (isMounted.current) {
        setState({
          balance: data.balance ?? 0,
          lifetimePurchased: data.lifetime_purchased ?? 0,
          isLoading: false,
          error: null,
        });
      }
    } catch (err) {
      if (isMounted.current) {
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        }));
      }
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;
    fetchBalance();
    return () => { isMounted.current = false; };
  }, [fetchBalance]);

  return {
    ...state,
    refetch: fetchBalance,
  };
}

export default useCredits;
