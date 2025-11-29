// hooks/useFeatureFlags.ts
// ============================================================================
// FEATURE FLAGS HOOK - Check if features are enabled
// ============================================================================

import { useQuery } from '@tanstack/react-query';

interface FeatureFlagsResponse {
  features: Record<string, boolean>;
  configs: Record<string, Record<string, unknown>>;
}

/**
 * Hook to check feature flags
 * @returns Object with isEnabled function, configs, and loading state
 */
export function useFeatureFlags() {
  const { data, isLoading, error } = useQuery<FeatureFlagsResponse>({
    queryKey: ['feature-flags'],
    queryFn: async () => {
      const response = await fetch('/api/features');
      if (!response.ok) throw new Error('Failed to fetch features');
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    refetchOnWindowFocus: false,
  });

  const isEnabled = (key: string): boolean => {
    return data?.features[key] ?? false;
  };

  const getConfig = <T = Record<string, unknown>>(key: string): T | null => {
    return (data?.configs[key] as T) ?? null;
  };

  return {
    isEnabled,
    getConfig,
    features: data?.features ?? {},
    configs: data?.configs ?? {},
    isLoading,
    error,
  };
}

/**
 * Hook to check a single feature flag
 * Useful for simple components that only need one flag
 */
export function useFeature(key: string) {
  const { isEnabled, getConfig, isLoading } = useFeatureFlags();

  return {
    enabled: isEnabled(key),
    config: getConfig(key),
    isLoading,
  };
}
