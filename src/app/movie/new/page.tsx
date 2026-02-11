'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Film, Upload, Sparkles, Clock, Coins } from 'lucide-react';
import toast from 'react-hot-toast';
import { AuthGuard } from '@/hooks/useAuth';
import { useMovieAccess } from '@/hooks/useMovieProject';
import { useCsrf } from '@/hooks/useCsrf';
import BottomNavigation from '@/components/BottomNavigation';

const AVAILABLE_MODELS = [
  { id: 'kling-2.6', name: 'Kling 2.6 Pro', cost: '7 credits/scene', description: 'Best balance of quality and cost' },
  { id: 'sora-2', name: 'Sora 2', cost: '15 credits/scene', description: 'Highest quality, cinematic output' },
] as const;

const STYLE_OPTIONS = [
  { id: '', label: 'Auto (AI decides)' },
  { id: 'cinematic', label: 'Cinematic' },
  { id: 'anime', label: 'Anime' },
  { id: 'documentary', label: 'Documentary' },
  { id: 'noir', label: 'Film Noir' },
  { id: 'fantasy', label: 'Fantasy' },
  { id: 'scifi', label: 'Sci-Fi' },
  { id: 'horror', label: 'Horror' },
  { id: 'comedy', label: 'Comedy' },
] as const;

function NewMovieContent() {
  const router = useRouter();
  const csrf = useCsrf();
  const { hasAccess, isLoading: accessLoading } = useMovieAccess();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [model, setModel] = useState('kling-2.6');
  const [style, setStyle] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(5);
  const [creating, setCreating] = useState(false);

  const textLength = sourceText.length;
  const minTextLength = 500;
  const maxTextLength = 100000;

  // Estimate scenes and credits
  const sceneDuration = model === 'sora-2' ? 8 : 5;
  const estimatedScenes = Math.ceil((durationMinutes * 60) / sceneDuration);
  const creditsPerScene = model === 'sora-2' ? 15 : 7;
  const estimatedCredits = estimatedScenes * creditsPerScene;

  useEffect(() => {
    if (!accessLoading && !hasAccess) {
      router.replace('/movie');
    }
  }, [accessLoading, hasAccess, router]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 1024 * 1024) {
      toast.error('File too large (max 1MB)');
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (text) {
        setSourceText(text.slice(0, maxTextLength));
        if (!title) {
          setTitle(file.name.replace(/\.[^/.]+$/, '').slice(0, 200));
        }
      }
    };
    reader.readAsText(file);
  }, [title]);

  const handleCreate = async () => {
    if (!title.trim()) { toast.error('Please enter a title'); return; }
    if (textLength < minTextLength) { toast.error(`Text must be at least ${minTextLength} characters`); return; }

    setCreating(true);
    try {
      const res = await csrf.fetch('/api/movie/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          source_text: sourceText,
          model,
          style: style || undefined,
          target_duration_minutes: durationMinutes,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to create project');
        return;
      }

      toast.success('Project created!');
      router.push(`/movie/${data.project.id}`);
    } catch {
      toast.error('Failed to create project');
    } finally {
      setCreating(false);
    }
  };

  if (accessLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!hasAccess) {
    return null;
  }

  return (
    <div className="min-h-screen bg-black text-white pb-24">
      <div className="max-w-2xl mx-auto px-4 pt-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link href="/movie" className="text-white/50 hover:text-white transition">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl font-bold">New Movie</h1>
            <p className="text-sm text-white/40">Upload text and configure your movie</p>
          </div>
        </div>

        <div className="space-y-6">
          {/* Title */}
          <div>
            <label className="text-sm font-medium text-white/70 mb-2 block">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:border-purple-500/50 focus:outline-none transition"
              placeholder="My Movie Title"
              maxLength={200}
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-sm font-medium text-white/70 mb-2 block">Description <span className="text-white/30">(optional)</span></label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:border-purple-500/50 focus:outline-none transition"
              placeholder="A short description of your movie"
              maxLength={500}
            />
          </div>

          {/* Source Text */}
          <div>
            <label className="text-sm font-medium text-white/70 mb-2 block">Source Text</label>
            <p className="text-xs text-white/40 mb-2">Paste your story, script, or text material. AI will generate a movie script from this.</p>

            {/* File upload option */}
            <label className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-dashed border-white/20 rounded-lg cursor-pointer hover:border-white/30 transition mb-3 w-fit">
              <Upload className="w-4 h-4 text-white/40" />
              <span className="text-sm text-white/50">Upload .txt file</span>
              <input
                type="file"
                accept=".txt,.md,.text"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>

            <textarea
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value.slice(0, maxTextLength))}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:border-purple-500/50 focus:outline-none transition min-h-[200px] resize-y text-sm"
              placeholder="Paste your text here... (min 500 characters)"
              maxLength={maxTextLength}
            />
            <div className="flex justify-between mt-1">
              <span className={`text-xs ${textLength < minTextLength ? 'text-red-400/60' : 'text-white/30'}`}>
                {textLength < minTextLength ? `${minTextLength - textLength} more characters needed` : 'Ready'}
              </span>
              <span className="text-xs text-white/30">{textLength.toLocaleString()} / {maxTextLength.toLocaleString()}</span>
            </div>
          </div>

          {/* Model Selection */}
          <div>
            <label className="text-sm font-medium text-white/70 mb-2 block">AI Model</label>
            <div className="grid grid-cols-2 gap-3">
              {AVAILABLE_MODELS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setModel(m.id)}
                  className={`p-4 rounded-xl border text-left transition ${
                    model === m.id
                      ? 'border-purple-500/50 bg-purple-500/10'
                      : 'border-white/10 bg-white/5 hover:border-white/20'
                  }`}
                >
                  <p className="text-sm font-medium">{m.name}</p>
                  <p className="text-xs text-white/40 mt-1">{m.cost}</p>
                  <p className="text-xs text-white/30 mt-0.5">{m.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Style */}
          <div>
            <label className="text-sm font-medium text-white/70 mb-2 block">Visual Style</label>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 focus:outline-none transition appearance-none"
            >
              {STYLE_OPTIONS.map((s) => (
                <option key={s.id} value={s.id} className="bg-black">{s.label}</option>
              ))}
            </select>
          </div>

          {/* Duration */}
          <div>
            <label className="text-sm font-medium text-white/70 mb-2 block">
              Movie Duration: {durationMinutes} minute{durationMinutes !== 1 ? 's' : ''}
            </label>
            <input
              type="range"
              min={1}
              max={10}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
              className="w-full accent-purple-500"
            />
            <div className="flex justify-between text-xs text-white/30 mt-1">
              <span>1 min</span>
              <span>10 min</span>
            </div>
          </div>

          {/* Estimate Card */}
          <div className="bg-white/5 rounded-xl p-4 border border-white/10">
            <p className="text-xs text-white/40 uppercase tracking-wider mb-3 font-medium">Estimate</p>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <Sparkles className="w-4 h-4 text-purple-400 mx-auto mb-1" />
                <p className="text-sm font-medium">{estimatedScenes}</p>
                <p className="text-xs text-white/40">scenes</p>
              </div>
              <div className="text-center">
                <Clock className="w-4 h-4 text-cyan-400 mx-auto mb-1" />
                <p className="text-sm font-medium">{durationMinutes} min</p>
                <p className="text-xs text-white/40">duration</p>
              </div>
              <div className="text-center">
                <Coins className="w-4 h-4 text-yellow-400 mx-auto mb-1" />
                <p className="text-sm font-medium">{estimatedCredits}</p>
                <p className="text-xs text-white/40">credits</p>
              </div>
            </div>
          </div>

          {/* Create Button */}
          <button
            onClick={handleCreate}
            disabled={creating || textLength < minTextLength || !title.trim()}
            className="w-full py-4 bg-gradient-to-r from-purple-600 to-cyan-600 rounded-xl font-medium text-lg disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition flex items-center justify-center gap-2"
          >
            {creating ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Film className="w-5 h-5" />
                Create Project
              </>
            )}
          </button>
        </div>
      </div>
      <BottomNavigation />
    </div>
  );
}

export default function NewMoviePage() {
  return (
    <AuthGuard>
      <NewMovieContent />
    </AuthGuard>
  );
}
