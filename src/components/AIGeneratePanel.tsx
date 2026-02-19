'use client';

// ============================================================================
// AI GENERATE PANEL
// Prompt-to-video generation flow with polling, optional narration, and submission.
// All gated behind ai_video_generation feature flag.
// Narration gated behind elevenlabs_narration feature flag.
// ============================================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  Loader2,
  AlertCircle,
  Check,
  RefreshCw,
  Volume2,
  VolumeX,
  X,
  Film,
  Zap,
  Mic,
  Trash2,
  ChevronDown,
  ChevronUp,
  Wand2,
  Play,
} from 'lucide-react';
import { useCsrf } from '@/hooks/useCsrf';
import { useFeature } from '@/hooks/useFeatureFlags';
import { useCredits } from '@/hooks/useCredits';
import CreditPurchaseModal from './CreditPurchaseModal';
import CharacterReferenceSuggestModal from './CharacterReferenceSuggestModal';
import UserCharacterManager from './UserCharacterManager';
import type { UserCharacter } from './UserCharacterManager';
import UserCharacterUploadModal from './UserCharacterUploadModal';

// ============================================================================
// TYPES
// ============================================================================

type Stage = 'idle' | 'queued' | 'generating' | 'ready' | 'submitting' | 'done' | 'failed';

interface AIGeneratePanelProps {
  preselectedGenre?: string;
  onComplete?: () => void;
  compact?: boolean;
  lastFrameUrl?: string | null;
  initialPrompt?: string;
  onGenreChange?: (genre: string) => void;
}

interface VoiceOption {
  id: string;
  name: string;
  accent: string;
  gender: string;
  style: string;
}

interface NarrationConfig {
  max_chars: number;
  cost_per_generation_cents: number;
  daily_limit: number;
  voices: VoiceOption[];
}

// Models that support image-to-video on fal.ai
const I2V_SUPPORTED_MODELS = new Set(['kling-2.6', 'hailuo-2.3', 'sora-2']);

const STYLES = [
  { id: 'cinematic', label: 'Cinematic', emoji: '🎬' },
  { id: 'anime', label: 'Anime', emoji: '🎨' },
  { id: 'realistic', label: 'Realistic', emoji: '📷' },
  { id: 'abstract', label: 'Abstract', emoji: '🌀' },
  { id: 'noir', label: 'Noir', emoji: '🖤' },
  { id: 'retro', label: 'Retro', emoji: '📼' },
  { id: 'neon', label: 'Neon', emoji: '💜' },
];

const MODELS = [
  { id: 'kling-2.6', label: 'Kling 2.6', desc: '5s, 720p, portrait' },
  { id: 'veo3-fast', label: 'Veo3 Fast', desc: '8s, 720p, portrait' },
  { id: 'hailuo-2.3', label: 'Hailuo 2.3', desc: '6s, 1080p, landscape' },
  { id: 'sora-2', label: 'Sora 2', desc: '8s, 720p, portrait' },
];

const GENRES = [
  { id: 'action', label: 'Action' },
  { id: 'comedy', label: 'Comedy' },
  { id: 'thriller', label: 'Thriller' },
  { id: 'sci-fi', label: 'Sci-Fi' },
  { id: 'romance', label: 'Romance' },
  { id: 'animation', label: 'Animation' },
  { id: 'horror', label: 'Horror' },
  { id: 'drama', label: 'Drama' },
];

const SUGGESTION_CHIPS: Record<string, string[]> = {
  '': [
    'Tracking shot — figure sprints through flames',
    'Crane shot — city skyline at golden hour',
    'Dolly zoom — books fly off shelves in a storm',
    'Whip pan — dancer spins on edge of a volcano',
  ],
  action: [
    'Tracking shot — hero sprints through exploding bridge',
    'Whip pan — motorcycle smashes through glass wall',
    'Crane shot — rooftop sword fight at sunset',
    'Dolly in — fist slams table, glass shatters',
  ],
  comedy: [
    'Dolly zoom — cat knocks wedding cake off table',
    'Whip pan — man slips on banana into a pool',
    'Tracking shot — toddler chases terrified clown',
    'Crane shot — pigeons steal a hot dog stand',
  ],
  thriller: [
    'Dolly zoom — shadowy figure appears in mirror',
    'Tracking shot — detective runs through fog',
    'Handheld — suspect bolts through crowded market',
    'Crane shot — car chase on rain-soaked highway',
  ],
  'sci-fi': [
    'Tracking shot — astronaut floats through wreckage',
    'Crane shot — alien ship rises from the ocean',
    'Dolly in — robot opens its eyes for first time',
    'Whip pan — portal rips open above the city',
  ],
  romance: [
    'Dolly in — two hands reach across a rainy bridge',
    'Crane shot — couple dances alone on a rooftop',
    'Tracking shot — lovers run through cherry blossoms',
    'Whip pan — eyes meet across a crowded ballroom',
  ],
  animation: [
    'Crane shot — paper birds burst from a storybook',
    'Tracking shot — paint splatters form a dragon',
    'Dolly zoom — tiny fox discovers a glowing forest',
    'Whip pan — origami city unfolds under starlight',
  ],
  horror: [
    'Dolly zoom — door creaks open to empty hallway',
    'Tracking shot — shadow follows her down stairs',
    'Handheld — something moves under the bed sheets',
    'Crane shot — fog rolls over abandoned hospital',
  ],
  drama: [
    'Dolly in — tears fall as she reads the letter',
    'Crane shot — soldier returns to an empty home',
    'Tracking shot — father watches son walk away',
    'Handheld — hands tremble holding a photograph',
  ],
};

const STORAGE_KEY = 'ai_active_generation_id';
const STORAGE_TIMESTAMP_KEY = 'ai_active_generation_ts';
const PROMPT_SUGGEST_KEY = 'ai_prompt_suggest_enabled';

// ============================================================================
// COMPONENT
// ============================================================================

export default function AIGeneratePanel({
  preselectedGenre,
  onComplete,
  compact = false,
  lastFrameUrl,
  initialPrompt,
  onGenreChange,
}: AIGeneratePanelProps) {
  const router = useRouter();
  const { post: csrfPost, ensureToken } = useCsrf();
  const { enabled: aiEnabled, isLoading: flagLoading } = useFeature('ai_video_generation');
  const { enabled: narrationEnabled, config: narrationConfigRaw } = useFeature('elevenlabs_narration');
  const { enabled: pinningEnabled } = useFeature('character_pinning');
  const { enabled: userCharsEnabled } = useFeature('user_characters');
  const { enabled: autoAnglesEnabled } = useFeature('auto_generate_angles');
  const { enabled: promptLearningEnabled } = useFeature('prompt_learning');
  const { balance: creditBalance, refetch: refetchCredits } = useCredits();
  const [purchaseModalOpen, setPurchaseModalOpen] = useState(false);

  // Model credit costs (fetched once)
  const [modelCreditCosts, setModelCreditCosts] = useState<Record<string, number>>({});
  useEffect(() => {
    fetch('/api/credits/packages', { credentials: 'include' })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.model_pricing) {
          const costs: Record<string, number> = {};
          for (const mp of data.model_pricing) {
            costs[mp.model_key] = mp.credit_cost;
          }
          setModelCreditCosts(costs);
        }
      })
      .catch(() => {});
  }, []);

  const narrationConfig = narrationConfigRaw as NarrationConfig | null;

  // Pinned characters
  const [pinnedCharacters, setPinnedCharacters] = useState<Array<{
    id: string;
    element_index: number;
    label: string | null;
    frontal_image_url: string;
    reference_count: number;
    appearance_description: string | null;
  }>>([]);
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<Set<string>>(new Set());
  const [previewCharacter, setPreviewCharacter] = useState<{
    id: string;
    label: string | null;
    frontal_image_url: string;
    element_index: number;
    reference_count: number;
    appearance_description: string | null;
  } | null>(null);
  const [pinnedSeasonId, setPinnedSeasonId] = useState<string | null>(null);
  const [suggestingForCharacter, setSuggestingForCharacter] = useState<{
    id: string;
    label: string | null;
    frontal_image_url: string;
    element_index: number;
    reference_count: number;
    appearance_description: string | null;
  } | null>(null);

  // User characters
  const [userCharacters, setUserCharacters] = useState<UserCharacter[]>([]);
  const [selectedUserCharIds, setSelectedUserCharIds] = useState<Set<string>>(new Set());
  const [showUploadModal, setShowUploadModal] = useState(false);

  // Genre state (declared early so pinned character fetch can depend on it)
  const [genre, setGenre] = useState(preselectedGenre || '');

  // AI Prompt Suggestion state
  const [autoSuggestEnabled, setAutoSuggestEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem(PROMPT_SUGGEST_KEY);
    return stored === null ? true : stored === 'true';
  });
  const [isLoadingSuggestion, setIsLoadingSuggestion] = useState(false);
  const [suggestionBasis, setSuggestionBasis] = useState<{
    brief_title: string | null;
    top_patterns: string[];
  } | null>(null);

  // Fetch pinned characters when feature is enabled or genre changes
  useEffect(() => {
    if (!pinningEnabled) return;
    async function fetchPinned() {
      try {
        const genreQuery = genre ? `?genre=${encodeURIComponent(genre)}` : '';
        const res = await fetch(`/api/story/pinned-characters${genreQuery}`);
        const data = await res.json();
        if (data.ok && data.characters?.length > 0) {
          setPinnedCharacters(data.characters);
          // Default: all characters selected
          setSelectedCharacterIds(new Set(data.characters.map((c: { id: string }) => c.id)));
          if (data.season_id) setPinnedSeasonId(data.season_id);
        } else {
          setPinnedCharacters([]);
          setSelectedCharacterIds(new Set());
          setPinnedSeasonId('');
        }
      } catch {
        // Non-critical
      }
    }
    fetchPinned();
  }, [pinningEnabled, genre]);

  // Fetch user characters when feature is enabled
  useEffect(() => {
    if (!userCharsEnabled) return;
    async function fetchUserChars() {
      try {
        const res = await fetch('/api/ai/characters');
        const data = await res.json();
        if (data.ok && data.characters?.length > 0) {
          setUserCharacters(data.characters);
        } else {
          setUserCharacters([]);
        }
      } catch {
        // Non-critical
      }
    }
    fetchUserChars();
  }, [userCharsEnabled]);

  // Toggle a single user character selection
  const toggleUserChar = (id: string) => {
    setSelectedUserCharIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        // Enforce total max 4 (pinned + user combined)
        const totalSelected = selectedCharacterIds.size + next.size;
        if (totalSelected >= 4) return prev;
        next.add(id);
      }
      return next;
    });
  };

  // Max selectable user characters = 4 minus selected pinned chars
  const maxSelectableUserChars = 4 - selectedCharacterIds.size;

  // Toggle a single character selection
  const toggleCharacter = (id: string) => {
    setSelectedCharacterIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Select all characters
  const selectAllCharacters = () => {
    setSelectedCharacterIds(new Set(pinnedCharacters.map(c => c.id)));
  };

  // Deselect all characters
  const deselectAllCharacters = () => {
    setSelectedCharacterIds(new Set());
  };

  // Get the IDs of characters to skip (those not selected)
  const getSkipCharacterIds = (): string[] => {
    return pinnedCharacters
      .filter(c => !selectedCharacterIds.has(c.id))
      .map(c => c.id);
  };

  // Continuation mode
  const [continuationMode, setContinuationMode] = useState<'continue' | 'fresh' | null>(null);

  // Form state
  const [prompt, setPrompt] = useState(initialPrompt || '');
  const [style, setStyle] = useState<string | undefined>();
  const [model, setModel] = useState('kling-2.6');
  const [title, setTitle] = useState('');

  // Notify parent when genre changes (for multi-genre last frame fetching)
  useEffect(() => {
    if (genre && onGenreChange) {
      onGenreChange(genre);
    }
  }, [genre, onGenreChange]);

  // Persist auto-suggest toggle to localStorage
  useEffect(() => {
    localStorage.setItem(PROMPT_SUGGEST_KEY, String(autoSuggestEnabled));
  }, [autoSuggestEnabled]);

  // Fetch AI-suggested prompt when enabled and model changes
  useEffect(() => {
    // Skip if feature disabled, already has prompt, or initialPrompt provided
    if (!promptLearningEnabled || !autoSuggestEnabled || initialPrompt || prompt.length > 0) {
      return;
    }

    async function fetchSuggestedPrompt() {
      setIsLoadingSuggestion(true);
      try {
        const genreQuery = genre ? `&genre=${encodeURIComponent(genre)}` : '';
        const res = await fetch(`/api/clip/suggest-prompt?model=${encodeURIComponent(model)}${genreQuery}`);
        if (!res.ok) {
          setIsLoadingSuggestion(false);
          return;
        }
        const data = await res.json();
        if (data.ok && data.prompt) {
          setPrompt(data.prompt);
          setSuggestionBasis(data.based_on || null);
        }
      } catch {
        // Non-critical - user can still type their own prompt
      } finally {
        setIsLoadingSuggestion(false);
      }
    }

    fetchSuggestedPrompt();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptLearningEnabled, autoSuggestEnabled, model, genre]);

  // Update prompt when initialPrompt changes (from BriefBanner)
  useEffect(() => {
    if (initialPrompt) {
      setPrompt(initialPrompt);
    }
  }, [initialPrompt]);

  // Generation state
  const [stage, setStage] = useState<Stage>('idle');
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(true);
  const [blobVideoUrl, setBlobVideoUrl] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoError, setVideoError] = useState(false);

  // Narration state
  const [narrationOpen, setNarrationOpen] = useState(false);
  const [narrationText, setNarrationText] = useState('');
  const [narrationVoiceId, setNarrationVoiceId] = useState<string | null>(null);
  const [narrationAudioUrl, setNarrationAudioUrl] = useState<string | null>(null);
  const [narrationAudioBase64, setNarrationAudioBase64] = useState<string | null>(null);
  const [isNarrating, setIsNarrating] = useState(false);
  const [narrationError, setNarrationError] = useState<string | null>(null);

  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const completeResultRef = useRef<{
    generationId: string;
    falVideoUrl: string;
    signedUploadUrl: string;
    fetchedAt: number;
  } | null>(null);
  const prefetchedVideoRef = useRef<Blob | null>(null);
  const pollCountRef = useRef(0);

  // Resume from localStorage on mount
  useEffect(() => {
    const savedId = localStorage.getItem(STORAGE_KEY);
    if (savedId) {
      // L3: Check if saved generation is older than 7 days (fal.ai URL TTL)
      const savedTs = localStorage.getItem(STORAGE_TIMESTAMP_KEY);
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      if (savedTs && Date.now() - parseInt(savedTs, 10) > sevenDaysMs) {
        // Expired — clean up stale state
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STORAGE_TIMESTAMP_KEY);
        return;
      }
      setGenerationId(savedId);
      setStage('queued');
    }
  }, []);

  // Poll status when we have a generation ID and are in a polling stage
  const pollStatus = useCallback(async () => {
    if (!generationId) return;

    try {
      const res = await fetch(`/api/ai/status/${generationId}`);
      if (!res.ok) {
        if (res.status === 404) {
          localStorage.removeItem(STORAGE_KEY);
          localStorage.removeItem(STORAGE_TIMESTAMP_KEY);
          setStage('idle');
          setGenerationId(null);
          return;
        }
        return;
      }

      const data = await res.json();

      if (data.stage === 'ready') {
        setStage('ready');
        setVideoUrl(data.videoUrl);
        if (pollRef.current) clearTimeout(pollRef.current);
      } else if (data.stage === 'failed') {
        setStage('failed');
        setError(data.error || 'Generation failed');
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STORAGE_TIMESTAMP_KEY);
        if (pollRef.current) clearTimeout(pollRef.current);
      } else if (data.stage === 'generating') {
        setStage('generating');
      } else {
        setStage('queued');
      }
    } catch {
      // Silently retry on next interval
    }
  }, [generationId]);

  useEffect(() => {
    if (generationId && (stage === 'queued' || stage === 'generating')) {
      pollCountRef.current = 0;

      // Adaptive polling: 1s for first 15 polls, 2s for next 15, 3s thereafter
      const getInterval = () => {
        const count = pollCountRef.current;
        if (count < 15) return 1000;
        if (count < 30) return 2000;
        return 3000;
      };

      const schedulePoll = () => {
        pollStatus();
        pollCountRef.current++;
        pollRef.current = setTimeout(schedulePoll, getInterval());
      };

      // Poll immediately, then schedule adaptive
      pollStatus();
      pollCountRef.current++;
      pollRef.current = setTimeout(schedulePoll, getInterval());

      return () => {
        if (pollRef.current) clearTimeout(pollRef.current);
      };
    }
  }, [generationId, stage, pollStatus]);

  // Pre-download video Blob when generation is ready (saves 2-10s on submit + instant preview)
  useEffect(() => {
    if (stage !== 'ready' || !videoUrl) return;
    const controller = new AbortController();
    setVideoLoading(true);
    setIsPlaying(false);
    setVideoError(false);

    let blobUrl: string | null = null;
    fetch(videoUrl, { signal: controller.signal })
      .then(res => res.blob())
      .then(blob => {
        if (blob.size <= 20 * 1024 * 1024) { // 20MB guard for mobile
          prefetchedVideoRef.current = blob;
          blobUrl = URL.createObjectURL(blob);
          setBlobVideoUrl(blobUrl);
        }
      })
      .catch(() => {}); // Non-critical pre-fetch

    return () => {
      controller.abort();
      prefetchedVideoRef.current = null;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      setBlobVideoUrl(null);
    };
  }, [stage, videoUrl]);

  // Sync narration audio with video playback
  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio || !narrationAudioUrl) return;

    const onPlay = () => { audio.currentTime = video.currentTime; audio.play().catch(() => {}); };
    const onPause = () => audio.pause();
    const onSeeked = () => { audio.currentTime = video.currentTime; };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('seeked', onSeeked);

    // Start playing if video is already playing
    if (!video.paused) {
      audio.currentTime = video.currentTime;
      audio.play().catch(() => {});
    }

    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('seeked', onSeeked);
    };
  }, [narrationAudioUrl]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
      // Revoke blob URLs
      if (narrationAudioUrl) URL.revokeObjectURL(narrationAudioUrl);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================================================
  // HANDLERS
  // ============================================================================

  const handleGenerate = async () => {
    if (!prompt.trim() || prompt.trim().length < 10) {
      setError('Prompt must be at least 10 characters');
      return;
    }

    setError(null);
    setStage('queued');

    try {
      await ensureToken();

      // Determine which characters to skip
      const skipCharacterIds = getSkipCharacterIds();
      const skipAll = pinnedCharacters.length > 0 && skipCharacterIds.length === pinnedCharacters.length;

      const res = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': document.cookie.split(';').find(c => c.trim().startsWith('csrf-token='))?.split('=')[1] || '' },
        credentials: 'include',
        body: JSON.stringify({
          prompt: prompt.trim(),
          model,
          style: style || undefined,
          genre: genre || undefined,
          ...(continuationMode === 'continue' && lastFrameUrl ? { image_url: lastFrameUrl } : {}),
          ...(skipAll ? { skip_pinned: true } : {}),
          ...(skipCharacterIds.length > 0 && !skipAll ? { skip_character_ids: skipCharacterIds } : {}),
          ...(selectedUserCharIds.size > 0 ? { user_character_ids: Array.from(selectedUserCharIds) } : {}),
        }),
      });

      const result = await res.json();

      if (!res.ok || !result.success) {
        // Handle specific error codes from the API
        if (result.code === 'INSUFFICIENT_CREDITS') {
          setPurchaseModalOpen(true);
          setError(`Insufficient credits (need ${result.required}, have ${result.current})`);
          setStage('failed');
          return;
        }
        throw new Error(result.error || 'Failed to start generation');
      }

      if (!result.generationId) {
        throw new Error('Failed to start generation');
      }

      setGenerationId(result.generationId);
      localStorage.setItem(STORAGE_KEY, result.generationId);
      localStorage.setItem(STORAGE_TIMESTAMP_KEY, String(Date.now()));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Generation failed';
      setError(message);
      setStage('failed');
    }
  };

  const handleGenerateNarration = async () => {
    if (!generationId || !narrationText.trim() || !narrationVoiceId) {
      setNarrationError('Please enter text and select a voice');
      return;
    }

    setNarrationError(null);
    setIsNarrating(true);

    try {
      await ensureToken();

      const result = await csrfPost<{
        success: boolean;
        audioBase64?: string;
        contentType?: string;
        error?: string;
      }>('/api/ai/narrate', {
        generationId,
        text: narrationText.trim(),
        voiceId: narrationVoiceId,
      });

      if (!result.success || !result.audioBase64) {
        throw new Error(result.error || 'Narration failed');
      }

      // Store base64 for submission
      setNarrationAudioBase64(result.audioBase64);

      // Create blob URL for preview
      const binaryString = atob(result.audioBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: result.contentType || 'audio/mpeg' });

      // Revoke previous blob URL if exists
      if (narrationAudioUrl) URL.revokeObjectURL(narrationAudioUrl);

      const blobUrl = URL.createObjectURL(blob);
      setNarrationAudioUrl(blobUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Narration failed';
      setNarrationError(message);
    } finally {
      setIsNarrating(false);
    }
  };

  const handleRemoveNarration = () => {
    if (narrationAudioUrl) URL.revokeObjectURL(narrationAudioUrl);
    setNarrationText('');
    setNarrationVoiceId(null);
    setNarrationAudioUrl(null);
    setNarrationAudioBase64(null);
    setNarrationError(null);
    if (audioRef.current) audioRef.current.pause();
  };

  const handleSubmit = async () => {
    if (!generationId || !genre || !title.trim()) {
      setError('Please fill in genre and title');
      return;
    }

    setError(null);
    setStage('submitting');

    try {
      await ensureToken();

      // Step 1: Complete — with or without narration
      if (narrationAudioBase64) {
        // Narration path: server merges audio and uploads
        const completeResult = await csrfPost<{
          success: boolean;
          storageKey?: string;
          publicUrl?: string;
          error?: string;
        }>('/api/ai/complete', {
          generationId,
          narrationAudioBase64,
        });

        if (!completeResult.success || !completeResult.publicUrl) {
          throw new Error(completeResult.error || 'Failed to prepare submission');
        }

        // Server already uploaded — go straight to register
        const registerResult = await csrfPost<{
          success: boolean;
          clip?: { id: string };
          error?: string;
        }>('/api/ai/register', {
          generationId,
          genre,
          title: title.trim(),
          description: prompt.trim().slice(0, 500),
        });

        if (!registerResult.success) {
          throw new Error(registerResult.error || 'Failed to register clip');
        }
        // Note: Prompt recording is now handled server-side in /api/ai/register
      } else {
        // Standard path: get signed URL, client downloads and uploads
        let falVideoUrl: string;
        let signedUploadUrl: string;

        const SIGNED_URL_MAX_AGE = 10 * 60 * 1000; // 10 min (R2 URLs expire in 15)
        const cached = completeResultRef.current;
        if (cached && cached.generationId === generationId
            && (Date.now() - cached.fetchedAt) < SIGNED_URL_MAX_AGE) {
          falVideoUrl = cached.falVideoUrl;
          signedUploadUrl = cached.signedUploadUrl;
        } else {
          const completeResult = await csrfPost<{
            success: boolean;
            falVideoUrl?: string;
            signedUploadUrl?: string;
            storageKey?: string;
            error?: string;
          }>('/api/ai/complete', { generationId });

          if (!completeResult.success || !completeResult.falVideoUrl || !completeResult.signedUploadUrl) {
            throw new Error(completeResult.error || 'Failed to prepare submission');
          }

          falVideoUrl = completeResult.falVideoUrl;
          signedUploadUrl = completeResult.signedUploadUrl;
          completeResultRef.current = { generationId, falVideoUrl, signedUploadUrl, fetchedAt: Date.now() };
        }

        // Step 2: Use pre-fetched Blob or download from fal.ai
        let videoBlob: Blob;
        if (prefetchedVideoRef.current) {
          videoBlob = prefetchedVideoRef.current;
        } else {
          const videoRes = await fetch(falVideoUrl);
          if (!videoRes.ok) throw new Error('Failed to download video');
          videoBlob = await videoRes.blob();
        }

        // Step 3: Upload to our storage via signed URL
        const uploadRes = await fetch(signedUploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'video/mp4' },
          body: videoBlob,
        });

        if (!uploadRes.ok) throw new Error('Failed to upload video to storage');

        // Step 4: Register as tournament clip
        const registerResult = await csrfPost<{
          success: boolean;
          clip?: { id: string };
          error?: string;
        }>('/api/ai/register', {
          generationId,
          genre,
          title: title.trim(),
          description: prompt.trim().slice(0, 500),
        });

        if (!registerResult.success) {
          throw new Error(registerResult.error || 'Failed to register clip');
        }

        // Note: Prompt recording is now handled server-side in /api/ai/register
      }

      setStage('done');
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_TIMESTAMP_KEY);
      onComplete?.();

      // Redirect after success
      setTimeout(() => router.push('/dashboard'), 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Submission failed';
      setError(message);
      setStage('ready'); // Go back to preview so they can retry
    }
  };

  const handleReset = () => {
    setStage('idle');
    setGenerationId(null);
    setVideoUrl(null);
    setError(null);
    setPrompt('');
    setStyle(undefined);
    setTitle('');
    completeResultRef.current = null;
    prefetchedVideoRef.current = null;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_TIMESTAMP_KEY);
    if (pollRef.current) clearTimeout(pollRef.current);
    // Clear video preview state
    if (blobVideoUrl) URL.revokeObjectURL(blobVideoUrl);
    setBlobVideoUrl(null);
    setVideoLoading(true);
    setIsPlaying(false);
    setVideoError(false);
    // Clear narration state
    handleRemoveNarration();
    setNarrationOpen(false);
  };

  const handleClearAll = () => {
    setPrompt('');
    setStyle(undefined);
    setModel('kling-2.6');
    setGenre(preselectedGenre || '');
    setTitle('');
    setContinuationMode(null);
    setSelectedCharacterIds(new Set());
    setSelectedUserCharIds(new Set());
    setError(null);
    setSuggestionBasis(null);
    handleRemoveNarration();
    setNarrationOpen(false);
  };

  const hasFormState = !!(
    prompt.trim() || style || model !== 'kling-2.6' ||
    genre !== (preselectedGenre || '') || selectedCharacterIds.size > 0 ||
    selectedUserCharIds.size > 0 || continuationMode
  );

  const handleCancel = async () => {
    if (!generationId) {
      handleReset();
      return;
    }

    try {
      await ensureToken();
      const result = await csrfPost<{ success: boolean; error?: string; alreadyCompleted?: boolean }>('/api/ai/cancel', {
        generationId,
      });

      // M6: If generation completed during cancel, don't discard it — poll for result
      if (result.alreadyCompleted) {
        setStage('queued');
        return;
      }
    } catch {
      // Cancel is best-effort — reset locally regardless
    }

    handleReset();
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  if (flagLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
      </div>
    );
  }

  if (!aiEnabled) return null;

  const maxNarrationChars = narrationConfig?.max_chars || 200;
  const voices = narrationConfig?.voices || [];

  // Generating / polling states
  if (stage === 'queued' || stage === 'generating') {
    return (
      <div className="space-y-6 text-center py-8">
        <div className="relative w-20 h-20 mx-auto">
          <div className="absolute inset-0 rounded-full bg-purple-500/20 animate-ping" />
          <div className="relative w-20 h-20 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center">
            <Sparkles className="w-10 h-10 text-white animate-pulse" />
          </div>
        </div>
        <div>
          <h3 className="text-xl font-bold mb-1">
            {stage === 'queued' ? 'In Queue...' : 'Generating Video...'}
          </h3>
          <p className="text-white/60 text-sm">
            {stage === 'queued'
              ? 'Your video is queued for generation'
              : 'AI is creating your video clip'}
          </p>
        </div>
        <div className="h-2 max-w-xs mx-auto bg-white/10 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-purple-500 to-pink-500"
            animate={{ width: stage === 'queued' ? '30%' : '70%' }}
            transition={{ duration: 2, ease: 'easeInOut' }}
          />
        </div>
        <button
          onClick={handleCancel}
          className="px-5 py-2 bg-white/10 border border-white/10 rounded-xl text-white/60 hover:bg-white/20 transition flex items-center gap-2 mx-auto text-sm"
        >
          <X className="w-4 h-4" /> Cancel
        </button>
      </div>
    );
  }

  // Ready — video preview + narration + submit form
  if (stage === 'ready' && videoUrl) {
    return (
      <div className="space-y-6">
        {/* Video preview */}
        <div
          className="relative aspect-[9/16] max-h-[60vh] mx-auto rounded-xl overflow-hidden bg-black cursor-pointer"
          onClick={() => {
            const v = videoRef.current;
            if (!v) return;
            if (v.paused) { v.play().catch(() => {}); }
            else { v.pause(); }
          }}
        >
          <video
            ref={videoRef}
            src={blobVideoUrl || videoUrl}
            className="w-full h-full object-contain"
            autoPlay
            loop
            muted={isMuted}
            playsInline
            onCanPlay={() => setVideoLoading(false)}
            onPlaying={() => { setVideoLoading(false); setIsPlaying(true); }}
            onWaiting={() => setVideoLoading(true)}
            onPause={() => setIsPlaying(false)}
            onPlay={() => setIsPlaying(true)}
            onError={() => { setVideoError(true); setVideoLoading(false); }}
          />
          {/* Loading spinner */}
          {videoLoading && !videoError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 pointer-events-none">
              <Loader2 className="w-8 h-8 text-white animate-spin" />
            </div>
          )}
          {/* Play button — shown when paused and not loading */}
          {!isPlaying && !videoLoading && !videoError && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-16 h-16 rounded-full bg-black/60 flex items-center justify-center">
                <Play className="w-8 h-8 text-white ml-1" />
              </div>
            </div>
          )}
          {/* Error state */}
          {videoError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
              <AlertCircle className="w-8 h-8 text-red-400" />
              <p className="text-sm text-red-400">Failed to load video</p>
            </div>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); setIsMuted(!isMuted); }}
            className="absolute bottom-3 right-3 w-9 h-9 rounded-full bg-black/50 flex items-center justify-center"
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          {/* Narration badge on video */}
          {narrationAudioBase64 && (
            <div className="absolute top-3 left-3 px-2 py-1 rounded-full bg-green-500/80 text-xs font-medium flex items-center gap-1">
              <Mic className="w-3 h-3" /> Narration added
            </div>
          )}
        </div>

        {/* Hidden audio element for narration preview */}
        {narrationAudioUrl && (
          <audio ref={audioRef} src={narrationAudioUrl} loop />
        )}

        {/* Narration section (feature-flagged) */}
        {narrationEnabled && voices.length > 0 && (
          <div className="border border-white/10 rounded-xl overflow-hidden">
            <button
              onClick={() => setNarrationOpen(!narrationOpen)}
              className="w-full px-4 py-3 flex items-center justify-between text-sm hover:bg-white/5 transition"
            >
              <span className="flex items-center gap-2">
                <Mic className="w-4 h-4 text-purple-400" />
                <span className="font-medium">
                  {narrationAudioBase64 ? 'Narration Added' : 'Add Narration'}
                </span>
                {narrationAudioBase64 && (
                  <span className="text-green-400 text-xs">(voice-over will play with video)</span>
                )}
              </span>
              {narrationOpen ? <ChevronUp className="w-4 h-4 text-white/40" /> : <ChevronDown className="w-4 h-4 text-white/40" />}
            </button>

            {narrationOpen && (
              <div className="px-4 pb-4 space-y-4 border-t border-white/10 pt-3">
                {/* Success state */}
                {narrationAudioBase64 && (
                  <div className="flex items-center gap-3 p-3 bg-green-500/10 border border-green-500/20 rounded-xl">
                    <Check className="w-5 h-5 text-green-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-green-300">Narration ready</p>
                      <p className="text-xs text-white/50 truncate">&quot;{narrationText}&quot;</p>
                    </div>
                    <button
                      onClick={handleRemoveNarration}
                      className="p-1.5 text-white/40 hover:text-red-400 transition"
                      title="Remove narration"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Input form (hidden if narration already generated) */}
                {!narrationAudioBase64 && (
                  <>
                    {/* Narration text */}
                    <div>
                      <textarea
                        value={narrationText}
                        onChange={(e) => setNarrationText(e.target.value.slice(0, maxNarrationChars))}
                        placeholder="Type what the narrator should say..."
                        rows={2}
                        className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-purple-500 resize-none"
                      />
                      <p className="text-xs text-white/40 mt-1 text-right">
                        {narrationText.length}/{maxNarrationChars}
                      </p>
                    </div>

                    {/* Voice picker */}
                    <div>
                      <p className="text-xs text-white/50 mb-2">Select voice:</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {voices.map((v) => (
                          <button
                            key={v.id}
                            onClick={() => setNarrationVoiceId(v.id)}
                            className={`px-3 py-2 rounded-lg text-left text-sm transition-all ${
                              narrationVoiceId === v.id
                                ? 'bg-purple-500/20 border border-purple-500'
                                : 'bg-white/5 border border-white/10 hover:bg-white/10'
                            }`}
                          >
                            <p className="font-medium text-xs">{v.name}</p>
                            <p className="text-[10px] text-white/40">{v.gender} &middot; {v.style}</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Narration error */}
                    {narrationError && (
                      <div className="p-2 bg-red-500/20 border border-red-500/40 rounded-lg text-red-400 text-xs flex items-center gap-2">
                        <AlertCircle className="w-3 h-3 shrink-0" /> {narrationError}
                      </div>
                    )}

                    {/* Generate narration button */}
                    <button
                      onClick={handleGenerateNarration}
                      disabled={!narrationText.trim() || !narrationVoiceId || isNarrating}
                      className={`w-full py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition ${
                        narrationText.trim() && narrationVoiceId && !isNarrating
                          ? 'bg-purple-500/30 border border-purple-500 text-purple-300 hover:bg-purple-500/40'
                          : 'bg-white/5 border border-white/10 text-white/30 cursor-not-allowed'
                      }`}
                    >
                      {isNarrating ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" /> Generating...
                        </>
                      ) : (
                        <>
                          <Mic className="w-4 h-4" /> Generate Narration
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Title input */}
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, 100))}
          placeholder="Give your clip a title..."
          className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:border-purple-500"
        />

        {/* Genre selector */}
        {!preselectedGenre && (
          <div>
            <p className="text-sm text-white/60 mb-2">Select genre:</p>
            <div className="flex flex-wrap gap-2">
              {GENRES.map((g) => (
                <button
                  key={g.id}
                  onClick={() => setGenre(g.id)}
                  className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                    genre === g.id
                      ? 'bg-purple-500/30 border border-purple-500 text-purple-300'
                      : 'bg-white/5 border border-white/10 text-white/60 hover:bg-white/10'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-500/20 border border-red-500/40 rounded-xl text-red-400 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        {/* Submit & reset buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleReset}
            className="px-4 py-3 bg-white/10 border border-white/10 rounded-xl text-white/60 hover:bg-white/20 transition flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" /> New
          </button>
          <button
            onClick={handleSubmit}
            disabled={!genre || !title.trim()}
            className={`flex-1 py-3 rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition ${
              genre && title.trim()
                ? 'bg-gradient-to-r from-purple-500 to-pink-500'
                : 'bg-white/10 text-white/40 cursor-not-allowed'
            }`}
          >
            Submit to Tournament
          </button>
        </div>
      </div>
    );
  }

  // Submitting state
  if (stage === 'submitting') {
    return (
      <div className="space-y-6 text-center py-8">
        <Loader2 className="w-12 h-12 animate-spin text-purple-400 mx-auto" />
        <div>
          <h3 className="text-xl font-bold mb-1">Submitting...</h3>
          <p className="text-white/60 text-sm">
            {narrationAudioBase64
              ? 'Merging narration and uploading your clip'
              : 'Transferring video and registering your clip'}
          </p>
        </div>
      </div>
    );
  }

  // Done state
  if (stage === 'done') {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-6 text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', damping: 10 }}
          className="w-20 h-20 rounded-full bg-gradient-to-br from-green-400 to-cyan-500 flex items-center justify-center"
        >
          <Check className="w-10 h-10 text-white" />
        </motion.div>
        <div>
          <h3 className="text-xl font-bold">Clip Submitted!</h3>
          <p className="text-white/60 text-sm">Pending admin review. Redirecting...</p>
        </div>
      </div>
    );
  }

  // Failed state
  if (stage === 'failed') {
    return (
      <div className="space-y-6 text-center py-8">
        <div className="w-16 h-16 mx-auto rounded-full bg-red-500/20 flex items-center justify-center">
          <AlertCircle className="w-8 h-8 text-red-400" />
        </div>
        <div>
          <h3 className="text-lg font-bold mb-1">Generation Failed</h3>
          <p className="text-white/60 text-sm">{error || 'Something went wrong'}</p>
        </div>
        <button
          onClick={handleReset}
          className="px-6 py-3 bg-white/10 border border-white/10 rounded-xl hover:bg-white/20 transition flex items-center gap-2 mx-auto"
        >
          <RefreshCw className="w-4 h-4" /> Try Again
        </button>
      </div>
    );
  }

  // Idle — continuation choice (if lastFrameUrl available)
  if (lastFrameUrl && continuationMode === null && stage === 'idle') {
    return (
      <div className="space-y-5">
        <div className="text-center">
          <p className="text-sm text-white/60 mb-3">The previous scene ended with this frame</p>
        </div>
        <div className="relative aspect-video max-w-sm mx-auto rounded-xl overflow-hidden border border-white/20">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lastFrameUrl} alt="Last frame from previous clip" className="w-full h-full object-cover" />
          <div className="absolute bottom-2 left-2 px-2 py-1 rounded bg-black/60 text-xs text-white/80">
            Previous scene
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <button
            onClick={() => {
              setContinuationMode('continue');
              if (!I2V_SUPPORTED_MODELS.has(model)) setModel('kling-2.6');
            }}
            className="w-full py-4 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl font-bold text-lg flex items-center justify-center gap-2"
          >
            <Film className="w-5 h-5" />
            Continue from last scene
          </button>
          <button
            onClick={() => setContinuationMode('fresh')}
            className="w-full py-4 bg-white/10 border border-white/20 rounded-xl font-bold text-lg flex items-center justify-center gap-2"
          >
            <Zap className="w-5 h-5" />
            Start fresh
          </button>
        </div>
      </div>
    );
  }

  // Idle — prompt form
  return (
    <div className="space-y-5">
      {/* Reference frame banner when continuing */}
      {continuationMode === 'continue' && lastFrameUrl && (
        <div className="flex items-center gap-3 p-3 bg-purple-500/10 border border-purple-500/20 rounded-xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lastFrameUrl} alt="Reference frame" className="w-14 h-14 rounded-lg object-cover flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-purple-300">Continuing from last scene</p>
            <p className="text-xs text-white/50">AI will generate video starting from this frame</p>
          </div>
          <button onClick={() => setContinuationMode('fresh')} className="text-xs text-white/40 hover:text-white/60 flex-shrink-0">
            Switch
          </button>
        </div>
      )}

      {/* Switch-back banner when in fresh mode but last frame is available */}
      {continuationMode === 'fresh' && lastFrameUrl && (
        <div className="flex items-center gap-3 p-3 bg-white/5 border border-white/10 rounded-xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lastFrameUrl} alt="Reference frame" className="w-10 h-10 rounded-lg object-cover flex-shrink-0 opacity-50" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white/40">Starting fresh (ignoring previous scene)</p>
          </div>
          <button
            onClick={() => {
              setContinuationMode('continue');
              if (!I2V_SUPPORTED_MODELS.has(model)) setModel('kling-2.6');
            }}
            className="text-xs text-white/40 hover:text-white/60 flex-shrink-0"
          >
            Switch
          </button>
        </div>
      )}

      {/* Clear All — reset form to defaults */}
      {hasFormState && (
        <div className="flex justify-end">
          <button
            onClick={handleClearAll}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Clear All
          </button>
        </div>
      )}

      {/* Pinned characters browser */}
      {pinnedCharacters.length > 0 && (
        <div className="border border-yellow-500/20 rounded-xl overflow-hidden bg-yellow-500/5">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-yellow-500/10">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-yellow-300">
                Pinned Characters
              </span>
              <span className="text-xs text-white/50">
                ({selectedCharacterIds.size} active)
              </span>
            </div>
            <div className="flex items-center gap-2">
              {selectedCharacterIds.size < pinnedCharacters.length && (
                <button
                  onClick={selectAllCharacters}
                  className="text-xs text-yellow-500/70 hover:text-yellow-400 transition-colors"
                >
                  Use All
                </button>
              )}
              {selectedCharacterIds.size > 0 && (
                <button
                  onClick={deselectAllCharacters}
                  className="text-xs text-white/40 hover:text-white/60 transition-colors"
                >
                  Skip All
                </button>
              )}
            </div>
          </div>

          {/* Character grid - responsive: 2 cols on mobile, 3 on sm, 4 on md+ */}
          <div className="p-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {pinnedCharacters.map((char) => {
                const isSelected = selectedCharacterIds.has(char.id);
                return (
                  <button
                    key={char.id}
                    onClick={() => setPreviewCharacter(char)}
                    className={`flex flex-col items-center p-2 sm:p-3 rounded-lg transition-all ${
                      isSelected
                        ? 'bg-yellow-500/20 border-2 border-yellow-500'
                        : 'bg-white/5 border-2 border-transparent opacity-50 hover:opacity-75'
                    }`}
                  >
                    {/* Thumbnail - larger on desktop */}
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={char.frontal_image_url}
                        alt={char.label || `Element ${char.element_index}`}
                        className={`w-14 h-14 sm:w-16 sm:h-16 rounded-lg object-cover ${
                          isSelected ? 'ring-2 ring-yellow-500' : 'grayscale'
                        }`}
                      />
                      {/* Toggle button - stops propagation to prevent opening modal */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleCharacter(char.id);
                        }}
                        className={`absolute -top-1 -right-1 w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center transition-colors ${
                          isSelected
                            ? 'bg-yellow-500 text-black hover:bg-yellow-400'
                            : 'bg-white/30 text-white/60 hover:bg-white/50'
                        }`}
                        aria-label={isSelected ? `Deselect ${char.label || `Element ${char.element_index}`}` : `Select ${char.label || `Element ${char.element_index}`}`}
                      >
                        {isSelected ? <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <span className="text-sm font-bold">+</span>}
                      </button>
                    </div>
                    {/* Label */}
                    <p className={`text-xs sm:text-sm mt-1.5 font-medium truncate w-full text-center ${
                      isSelected ? 'text-yellow-300' : 'text-white/40'
                    }`}>
                      {char.label || `Element ${char.element_index}`}
                    </p>
                    <p className="text-[10px] sm:text-xs text-white/30">
                      @Element{char.element_index}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Info text */}
            <p className="text-xs text-white/40 mt-3">
              {selectedCharacterIds.size > 0
                ? 'Tap character to preview · Selected will maintain consistent appearance'
                : 'Tap to preview · Toggle checkbox to select characters'}
            </p>
          </div>

          {/* Character Preview Modal */}
          <AnimatePresence>
            {previewCharacter && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
                onClick={() => setPreviewCharacter(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setPreviewCharacter(null);
                }}
                role="dialog"
                aria-modal="true"
                aria-labelledby="preview-character-title"
              >
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-gray-900 rounded-2xl p-4 max-w-sm w-full border border-yellow-500/30 shadow-2xl"
                >
                  {/* Large Image */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewCharacter.frontal_image_url}
                    alt={previewCharacter.label || `Element ${previewCharacter.element_index}`}
                    className="w-full aspect-square object-cover rounded-xl mb-4"
                  />

                  {/* Character Info */}
                  <div className="text-center mb-4">
                    <h3 id="preview-character-title" className="text-lg font-bold text-yellow-300">
                      {previewCharacter.label || `Element ${previewCharacter.element_index}`}
                    </h3>
                    <p className="text-sm text-white/50">@Element{previewCharacter.element_index}</p>
                    {previewCharacter.reference_count > 0 && (
                      <p className="text-xs text-white/40 mt-1">
                        {previewCharacter.reference_count} reference angle{previewCharacter.reference_count !== 1 ? 's' : ''}
                      </p>
                    )}
                    {previewCharacter.appearance_description && (
                      <p className="text-sm text-white/50 italic mt-2">
                        {previewCharacter.appearance_description}
                      </p>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        toggleCharacter(previewCharacter.id);
                        setPreviewCharacter(null);
                      }}
                      className={`flex-1 py-3 rounded-xl font-medium transition-colors text-sm ${
                        selectedCharacterIds.has(previewCharacter.id)
                          ? 'bg-white/10 text-white/70 hover:bg-white/20'
                          : 'bg-yellow-500 text-black hover:bg-yellow-400'
                      }`}
                    >
                      {selectedCharacterIds.has(previewCharacter.id) ? 'Deselect' : 'Select'}
                    </button>
                    {pinnedSeasonId && (
                      <button
                        onClick={() => {
                          const charForSuggest = previewCharacter;
                          setPreviewCharacter(null);
                          setSuggestingForCharacter(charForSuggest);
                        }}
                        className="flex-1 py-3 rounded-xl bg-purple-500/20 text-purple-300 border border-purple-500/30 hover:bg-purple-500/30 transition-colors text-sm"
                      >
                        Suggest Ref
                      </button>
                    )}
                    <button
                      onClick={() => setPreviewCharacter(null)}
                      className="flex-1 py-3 rounded-xl bg-white/10 text-white/70 hover:bg-white/20 transition-colors text-sm"
                    >
                      Close
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Character Reference Suggest Modal */}
          <AnimatePresence>
            {suggestingForCharacter && pinnedSeasonId && (
              <CharacterReferenceSuggestModal
                character={suggestingForCharacter}
                seasonId={pinnedSeasonId}
                onClose={() => setSuggestingForCharacter(null)}
                onSubmitted={() => {
                  // Refresh pinned characters to update reference counts
                  fetch('/api/story/pinned-characters')
                    .then(r => r.json())
                    .then(data => {
                      if (data.ok && data.characters) {
                        setPinnedCharacters(data.characters);
                      }
                    })
                    .catch(() => {});
                }}
              />
            )}
          </AnimatePresence>
        </div>
      )}

      {/* User Characters (My Characters) */}
      {userCharsEnabled && (
        <>
          <UserCharacterManager
            characters={userCharacters}
            selectedIds={selectedUserCharIds}
            onToggle={toggleUserChar}
            onDelete={(id) => {
              setUserCharacters(prev => prev.filter(c => c.id !== id));
              setSelectedUserCharIds(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
              });
            }}
            onUploadClick={() => setShowUploadModal(true)}
            onAngleAdded={(charId, newCount, urls) => {
              setUserCharacters(prev =>
                prev.map(c => c.id === charId ? { ...c, reference_count: newCount, reference_image_urls: urls } : c)
              );
            }}
            maxSelectable={maxSelectableUserChars}
          />

          {/* Upload Modal */}
          <AnimatePresence>
            {showUploadModal && (
              <UserCharacterUploadModal
                onClose={() => setShowUploadModal(false)}
                onCreated={(newChar) => {
                  setUserCharacters(prev => [newChar, ...prev]);
                  // Auto-select the newly uploaded character if within limits
                  setSelectedUserCharIds(prev => {
                    const totalSelected = selectedCharacterIds.size + prev.size;
                    if (totalSelected < 4) {
                      const next = new Set(prev);
                      next.add(newChar.id);
                      return next;
                    }
                    return prev;
                  });
                  setShowUploadModal(false);
                }}
                autoAnglesEnabled={autoAnglesEnabled}
              />
            )}
          </AnimatePresence>
        </>
      )}

      {/* Combined character count warning */}
      {(selectedCharacterIds.size + selectedUserCharIds.size) > 4 && (
        <div className="p-2 bg-yellow-500/20 border border-yellow-500/40 rounded-lg text-yellow-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-3 h-3 shrink-0" />
          Maximum 4 characters per video. Only the first 4 will be used.
        </div>
      )}

      {/* Cost indicator when characters selected */}
      {(selectedCharacterIds.size > 0 || selectedUserCharIds.size > 0) && modelCreditCosts['kling-o1-ref'] && (
        <div className="p-2 bg-purple-500/10 border border-purple-500/20 rounded-lg text-purple-300 text-xs">
          Characters selected — will use reference-to-video ({modelCreditCosts['kling-o1-ref']} credits)
        </div>
      )}

      {/* AI Prompt Suggestion Toggle */}
      {promptLearningEnabled && (
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-purple-400" />
            <span className="text-sm text-white/70">AI Prompt Suggestion</span>
            {suggestionBasis?.brief_title && (
              <span className="text-xs text-purple-400/70">
                (based on: {suggestionBasis.brief_title})
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {autoSuggestEnabled && (
              <button
                onClick={async () => {
                  setIsLoadingSuggestion(true);
                  try {
                    const genreQ = genre ? `&genre=${encodeURIComponent(genre)}` : '';
                    const res = await fetch(`/api/clip/suggest-prompt?model=${encodeURIComponent(model)}${genreQ}`);
                    if (res.ok) {
                      const data = await res.json();
                      if (data.ok && data.prompt) {
                        setPrompt(data.prompt);
                        setSuggestionBasis(data.based_on || null);
                      }
                    }
                  } catch { /* non-critical */ } finally {
                    setIsLoadingSuggestion(false);
                  }
                }}
                disabled={isLoadingSuggestion}
                className="px-2.5 py-1 bg-purple-500/20 border border-purple-500/40 rounded-lg text-xs text-purple-300 hover:bg-purple-500/30 transition flex items-center gap-1 disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${isLoadingSuggestion ? 'animate-spin' : ''}`} />
                Regenerate
              </button>
            )}
            <button
              onClick={() => setAutoSuggestEnabled(!autoSuggestEnabled)}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                autoSuggestEnabled ? 'bg-purple-600' : 'bg-white/20'
              }`}
              aria-label={autoSuggestEnabled ? 'Disable AI prompt suggestions' : 'Enable AI prompt suggestions'}
            >
              <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                autoSuggestEnabled ? 'left-6' : 'left-1'
              }`} />
            </button>
          </div>
        </div>
      )}

      {/* Prompt input */}
      <div className="relative">
        {isLoadingSuggestion && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-xl z-10">
            <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
          </div>
        )}
        <textarea
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value.slice(0, 800));
            // Clear suggestion basis when user edits
            if (suggestionBasis) setSuggestionBasis(null);
          }}
          placeholder="Describe a dramatic scene — include camera movement, action, and lighting..."
          rows={compact ? 3 : 5}
          className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:border-purple-500 resize-none"
        />
        <p className="text-xs text-white/40 mt-1 text-right">{prompt.length}/800</p>
      </div>

      {/* Suggestion chips */}
      {!compact && (
        <div className="flex flex-wrap gap-2">
          {(SUGGESTION_CHIPS[genre] || SUGGESTION_CHIPS['']).map((chip, i) => (
            <button
              key={i}
              onClick={() => setPrompt(chip)}
              className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-full text-xs text-white/60 hover:bg-white/10 hover:text-white/80 transition truncate max-w-[200px]"
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      {/* Style pills */}
      <div>
        <p className="text-sm text-white/60 mb-2">Style (optional):</p>
        <div className="flex flex-wrap gap-2">
          {STYLES.map((s) => (
            <button
              key={s.id}
              onClick={() => setStyle(style === s.id ? undefined : s.id)}
              className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                style === s.id
                  ? 'bg-purple-500/30 border border-purple-500 text-purple-300'
                  : 'bg-white/5 border border-white/10 text-white/60 hover:bg-white/10'
              }`}
            >
              {s.emoji} {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Model picker (non-compact) */}
      {!compact && (
        <div>
          <p className="text-sm text-white/60 mb-2">Model:{continuationMode === 'continue' ? ' (image-to-video compatible)' : ''}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {MODELS.filter(m => continuationMode !== 'continue' || I2V_SUPPORTED_MODELS.has(m.id)).map((m) => {
              const creditCost = modelCreditCosts[m.id];
              return (
                <button
                  key={m.id}
                  onClick={() => setModel(m.id)}
                  className={`p-3 rounded-xl text-left transition-all ${
                    model === m.id
                      ? 'bg-purple-500/20 border border-purple-500'
                      : 'bg-white/5 border border-white/10 hover:bg-white/10'
                  }`}
                >
                  <p className="font-bold text-sm">{m.label}</p>
                  <p className="text-xs text-white/40">{m.desc}</p>
                  {creditCost ? (
                    <p className="text-xs text-yellow-400 mt-1">{creditCost} credits</p>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Genre selector (if not preselected) */}
      {!preselectedGenre && !compact && (
        <div>
          <p className="text-sm text-white/60 mb-2">Genre (optional):</p>
          <div className="flex flex-wrap gap-2">
            {GENRES.map((g) => (
              <button
                key={g.id}
                onClick={() => setGenre(genre === g.id ? '' : g.id)}
                className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                  genre === g.id
                    ? 'bg-purple-500/30 border border-purple-500 text-purple-300'
                    : 'bg-white/5 border border-white/10 text-white/60 hover:bg-white/10'
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="p-3 bg-red-500/20 border border-red-500/40 rounded-xl text-sm space-y-2">
          <div className="flex items-center gap-2 text-red-400">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </div>
          {/* Actionable buttons for credit/cooldown errors */}
          {(error.includes('Insufficient credits') || error.includes('Buy credits')) && (
            <button
              onClick={() => setPurchaseModalOpen(true)}
              className="w-full py-2 bg-gradient-to-r from-yellow-500/20 to-amber-500/20 border border-yellow-500/30 rounded-lg text-yellow-300 text-xs font-medium hover:border-yellow-500/50 transition"
            >
              Get Credits
            </button>
          )}
        </div>
      )}

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={!prompt.trim() || prompt.trim().length < 10}
        className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition ${
          prompt.trim().length >= 10
            ? 'bg-gradient-to-r from-purple-500 to-pink-500 hover:opacity-90'
            : 'bg-white/10 text-white/40 cursor-not-allowed'
        }`}
      >
        <Sparkles className="w-5 h-5" />
        {(selectedCharacterIds.size > 0 || selectedUserCharIds.size > 0) && modelCreditCosts['kling-o1-ref']
          ? `Generate (${modelCreditCosts['kling-o1-ref']} credits)`
          : modelCreditCosts[model]
          ? `Generate (${modelCreditCosts[model]} credits)`
          : 'Generate Video'}
      </button>

      {/* Credit Purchase Modal */}
      <CreditPurchaseModal
        isOpen={purchaseModalOpen}
        onClose={() => {
          setPurchaseModalOpen(false);
          refetchCredits();
        }}
        currentBalance={creditBalance}
      />
    </div>
  );
}
