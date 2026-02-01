'use client';

// ============================================================================
// AI GENERATE PANEL
// Prompt-to-video generation flow with polling and submission.
// All gated behind ai_video_generation feature flag.
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
  Play,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useCsrf } from '@/hooks/useCsrf';
import { useFeature } from '@/hooks/useFeatureFlags';

// ============================================================================
// TYPES
// ============================================================================

type Stage = 'idle' | 'queued' | 'generating' | 'ready' | 'submitting' | 'done' | 'failed';

interface AIGeneratePanelProps {
  preselectedGenre?: string;
  onComplete?: () => void;
  compact?: boolean;
}

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

const SUGGESTION_CHIPS = [
  'A lone astronaut discovers a glowing artifact on Mars',
  'A cat becomes a street samurai in a cyberpunk city',
  'Time-lapse of a city being reclaimed by nature',
  'A dancer performs on the edge of a volcano at sunset',
  'An ancient library where books come alive',
];

const STORAGE_KEY = 'ai_active_generation_id';

// ============================================================================
// COMPONENT
// ============================================================================

export default function AIGeneratePanel({
  preselectedGenre,
  onComplete,
  compact = false,
}: AIGeneratePanelProps) {
  const router = useRouter();
  const { post: csrfPost, ensureToken, fetch: secureFetch } = useCsrf();
  const { enabled: aiEnabled, isLoading: flagLoading } = useFeature('ai_video_generation');

  // Form state
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState<string | undefined>();
  const [model, setModel] = useState('kling-2.6');
  const [genre, setGenre] = useState(preselectedGenre || '');
  const [title, setTitle] = useState('');

  // Generation state
  const [stage, setStage] = useState<Stage>('idle');
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(true);

  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const completeResultRef = useRef<{
    generationId: string;
    falVideoUrl: string;
    signedUploadUrl: string;
  } | null>(null);

  // Resume from localStorage on mount
  useEffect(() => {
    const savedId = localStorage.getItem(STORAGE_KEY);
    if (savedId) {
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
        if (pollRef.current) clearInterval(pollRef.current);
      } else if (data.stage === 'failed') {
        setStage('failed');
        setError(data.error || 'Generation failed');
        localStorage.removeItem(STORAGE_KEY);
        if (pollRef.current) clearInterval(pollRef.current);
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
      // Poll immediately, then every 3s
      pollStatus();
      pollRef.current = setInterval(pollStatus, 3000);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }
  }, [generationId, stage, pollStatus]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
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

      const result = await csrfPost<{
        success: boolean;
        generationId?: string;
        error?: string;
      }>('/api/ai/generate', {
        prompt: prompt.trim(),
        model,
        style: style || undefined,
        genre: genre || undefined,
      });

      if (!result.success || !result.generationId) {
        throw new Error(result.error || 'Failed to start generation');
      }

      setGenerationId(result.generationId);
      localStorage.setItem(STORAGE_KEY, result.generationId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Generation failed';
      setError(message);
      setStage('failed');
    }
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

      // Step 1: Get signed upload URL (reuse cached result on retry)
      let falVideoUrl: string;
      let signedUploadUrl: string;

      if (completeResultRef.current && completeResultRef.current.generationId === generationId) {
        falVideoUrl = completeResultRef.current.falVideoUrl;
        signedUploadUrl = completeResultRef.current.signedUploadUrl;
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
        completeResultRef.current = { generationId, falVideoUrl, signedUploadUrl };
      }

      // Step 2: Fetch video from fal.ai
      const videoRes = await fetch(falVideoUrl);
      if (!videoRes.ok) throw new Error('Failed to download video');
      const videoBlob = await videoRes.blob();

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

      setStage('done');
      localStorage.removeItem(STORAGE_KEY);
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
    localStorage.removeItem(STORAGE_KEY);
    if (pollRef.current) clearInterval(pollRef.current);
  };

  const handleCancel = async () => {
    if (!generationId) {
      handleReset();
      return;
    }

    try {
      await ensureToken();
      await csrfPost<{ success: boolean; error?: string }>('/api/ai/cancel', {
        generationId,
      });
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

  // Ready — video preview + submit form
  if (stage === 'ready' && videoUrl) {
    return (
      <div className="space-y-6">
        {/* Video preview */}
        <div className="relative aspect-[9/16] max-h-[60vh] mx-auto rounded-xl overflow-hidden bg-black">
          <video
            ref={videoRef}
            src={videoUrl}
            className="w-full h-full object-contain"
            autoPlay
            loop
            muted={isMuted}
            playsInline
          />
          <button
            onClick={() => setIsMuted(!isMuted)}
            className="absolute bottom-3 right-3 w-9 h-9 rounded-full bg-black/50 flex items-center justify-center"
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
        </div>

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
          <p className="text-white/60 text-sm">Transferring video and registering your clip</p>
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

  // Idle — prompt form
  return (
    <div className="space-y-5">
      {/* Prompt input */}
      <div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value.slice(0, 500))}
          placeholder="Describe your 8-second video clip..."
          rows={compact ? 3 : 4}
          className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:border-purple-500 resize-none"
        />
        <p className="text-xs text-white/40 mt-1 text-right">{prompt.length}/500</p>
      </div>

      {/* Suggestion chips */}
      {!compact && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTION_CHIPS.map((chip, i) => (
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
          <p className="text-sm text-white/60 mb-2">Model:</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {MODELS.map((m) => (
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
              </button>
            ))}
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
        <div className="p-3 bg-red-500/20 border border-red-500/40 rounded-xl text-red-400 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
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
        <Sparkles className="w-5 h-5" /> Generate Video
      </button>
    </div>
  );
}
