// hooks/useAIGenerations.ts
// React Query hook for AI generation history

'use client';

import { useQuery } from '@tanstack/react-query';

interface AIGenerationEntry {
  id: string;
  stage: string;
  prompt: string;
  model: string;
  style?: string;
  genre?: string;
  video_url?: string;
  clip_id?: string;
  error_message?: string;
  created_at: string;
  completed_at?: string;
}

interface AIHistoryResponse {
  success: boolean;
  generations: AIGenerationEntry[];
  page: number;
  limit: number;
  hasMore: boolean;
}

export function useAIGenerations(page: number = 1, limit: number = 20) {
  return useQuery<AIHistoryResponse>({
    queryKey: ['ai-generations', page, limit],
    queryFn: async () => {
      const res = await fetch(`/api/ai/history?page=${page}&limit=${limit}`);
      if (!res.ok) throw new Error('Failed to fetch AI generations');
      return res.json();
    },
    staleTime: 30 * 1000, // 30s
    refetchOnWindowFocus: false,
  });
}

export type { AIGenerationEntry, AIHistoryResponse };
