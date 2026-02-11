'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Film, Upload, Sparkles, Clock, Coins, RotateCcw, ChevronDown, ChevronUp, Edit3, Check } from 'lucide-react';
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

interface PreviewScene {
  scene_number: number;
  scene_title: string;
  video_prompt: string;
  narration_text: string | null;
}

interface ScriptPreview {
  scenes: PreviewScene[];
  total_scenes: number;
  estimated_duration_seconds: number;
  estimated_credits: number;
  summary: string;
}

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
  const [generating, setGenerating] = useState(false);
  const [creating, setCreating] = useState(false);
  const [scriptPreview, setScriptPreview] = useState<ScriptPreview | null>(null);
  const [expandedScene, setExpandedScene] = useState<number | null>(null);
  const [editingScene, setEditingScene] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
  const [editNarration, setEditNarration] = useState('');

  const startEditScene = (scene: PreviewScene) => {
    setEditingScene(scene.scene_number);
    setEditTitle(scene.scene_title);
    setEditPrompt(scene.video_prompt);
    setEditNarration(scene.narration_text || '');
    setExpandedScene(scene.scene_number);
  };

  const saveEditScene = () => {
    if (!scriptPreview || editingScene === null) return;
    setScriptPreview({
      ...scriptPreview,
      scenes: scriptPreview.scenes.map((s) =>
        s.scene_number === editingScene
          ? { ...s, scene_title: editTitle, video_prompt: editPrompt, narration_text: editNarration || null }
          : s
      ),
    });
    setEditingScene(null);
  };

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

  const handleGenerateScript = async () => {
    if (textLength < minTextLength) { toast.error(`Text must be at least ${minTextLength} characters`); return; }

    setGenerating(true);
    try {
      const res = await csrf.fetch('/api/movie/preview-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_text: sourceText,
          model,
          style: style || undefined,
          target_duration_minutes: durationMinutes,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to generate script');
        return;
      }

      setScriptPreview(data);
      toast.success(`Script generated: ${data.total_scenes} scenes`);
    } catch {
      toast.error('Failed to generate script');
    } finally {
      setGenerating(false);
    }
  };

  const handleCreate = async () => {
    if (!title.trim()) { toast.error('Please enter a title'); return; }
    if (!scriptPreview) { toast.error('Generate a script first'); return; }

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
          scenes: scriptPreview.scenes,
          script_data: {
            scenes: scriptPreview.scenes,
            total_scenes: scriptPreview.total_scenes,
            estimated_duration_seconds: scriptPreview.estimated_duration_seconds,
            summary: scriptPreview.summary,
          },
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
            <p className="text-sm text-white/40">
              {scriptPreview ? 'Review your AI script, then create the project' : 'Upload text and configure your movie'}
            </p>
          </div>
        </div>

        {/* ============================================================ */}
        {/* STEP 2: Script Preview (shown when script is generated) */}
        {/* ============================================================ */}
        {scriptPreview ? (
          <div className="space-y-6">
            {/* Summary */}
            <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-4">
              <p className="text-sm text-purple-300 font-medium mb-1">AI Script Summary</p>
              <p className="text-sm text-white/70">{scriptPreview.summary}</p>
            </div>

            {/* Stats */}
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center">
                  <Sparkles className="w-4 h-4 text-purple-400 mx-auto mb-1" />
                  <p className="text-sm font-medium">{scriptPreview.total_scenes}</p>
                  <p className="text-xs text-white/40">scenes</p>
                </div>
                <div className="text-center">
                  <Clock className="w-4 h-4 text-cyan-400 mx-auto mb-1" />
                  <p className="text-sm font-medium">{Math.round(scriptPreview.estimated_duration_seconds / 60)} min</p>
                  <p className="text-xs text-white/40">duration</p>
                </div>
                <div className="text-center">
                  <Coins className="w-4 h-4 text-yellow-400 mx-auto mb-1" />
                  <p className="text-sm font-medium">{scriptPreview.estimated_credits}</p>
                  <p className="text-xs text-white/40">credits</p>
                </div>
              </div>
            </div>

            {/* Scene List */}
            <div>
              <p className="text-sm font-medium text-white/70 mb-3">Scenes ({scriptPreview.scenes.length}) <span className="text-white/30 font-normal">— tap to expand, pencil to edit</span></p>
              <div className="space-y-2">
                {scriptPreview.scenes.map((scene) => (
                  <div
                    key={scene.scene_number}
                    className={`bg-white/5 border rounded-xl p-3 transition ${
                      editingScene === scene.scene_number
                        ? 'border-purple-500/50 bg-purple-500/5'
                        : 'border-white/10 hover:border-white/20'
                    }`}
                  >
                    {/* Scene Header */}
                    <div
                      className="flex items-center justify-between cursor-pointer"
                      onClick={() => {
                        if (editingScene === scene.scene_number) return;
                        setExpandedScene(expandedScene === scene.scene_number ? null : scene.scene_number);
                      }}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-xs font-mono text-white/30 flex-shrink-0 w-6">{scene.scene_number}</span>
                        <span className="text-sm font-medium truncate">{scene.scene_title}</span>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {editingScene !== scene.scene_number && (
                          <button
                            onClick={(e) => { e.stopPropagation(); startEditScene(scene); }}
                            className="text-white/30 hover:text-purple-400 p-1 transition"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {expandedScene === scene.scene_number ? (
                          <ChevronUp className="w-4 h-4 text-white/30" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-white/30" />
                        )}
                      </div>
                    </div>

                    {/* Editing Mode */}
                    {editingScene === scene.scene_number && (
                      <div className="mt-3 space-y-3 border-t border-white/10 pt-3">
                        <div>
                          <label className="text-xs text-white/50 mb-1 block">Scene Title</label>
                          <input
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-purple-500/50 focus:outline-none"
                            maxLength={200}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-purple-400 mb-1 block">Video Prompt</label>
                          <textarea
                            value={editPrompt}
                            onChange={(e) => setEditPrompt(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:border-purple-500/50 focus:outline-none min-h-[80px] resize-y"
                            maxLength={2000}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-cyan-400 mb-1 block">Narration <span className="text-white/30">(optional)</span></label>
                          <textarea
                            value={editNarration}
                            onChange={(e) => setEditNarration(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:border-purple-500/50 focus:outline-none min-h-[50px] resize-y"
                            maxLength={500}
                            placeholder="Leave empty for no narration"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={saveEditScene}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 rounded-lg text-xs font-medium hover:bg-purple-700 transition"
                          >
                            <Check className="w-3.5 h-3.5" />
                            Save
                          </button>
                          <button
                            onClick={() => setEditingScene(null)}
                            className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-white/50 hover:bg-white/10 transition"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Expanded Read-Only View */}
                    {expandedScene === scene.scene_number && editingScene !== scene.scene_number && (
                      <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
                        <div>
                          <p className="text-xs text-purple-400 font-medium mb-1">Video Prompt</p>
                          <p className="text-xs text-white/60 leading-relaxed">{scene.video_prompt}</p>
                        </div>
                        {scene.narration_text && (
                          <div>
                            <p className="text-xs text-cyan-400 font-medium mb-1">Narration</p>
                            <p className="text-xs text-white/60 leading-relaxed">{scene.narration_text}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Title (if not set yet) */}
            {!title.trim() && (
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
            )}

            {/* Action Buttons */}
            <div className="space-y-3">
              <button
                onClick={handleCreate}
                disabled={creating || !title.trim()}
                className="w-full py-4 bg-gradient-to-r from-purple-600 to-cyan-600 rounded-xl font-medium text-lg disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition flex items-center justify-center gap-2"
              >
                {creating ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Creating Project...
                  </>
                ) : (
                  <>
                    <Film className="w-5 h-5" />
                    Create Project
                  </>
                )}
              </button>

              <button
                onClick={() => { setScriptPreview(null); setExpandedScene(null); }}
                disabled={creating}
                className="w-full py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white/60 hover:bg-white/10 transition flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <RotateCcw className="w-4 h-4" />
                Re-generate Script
              </button>
            </div>
          </div>
        ) : (
          /* ============================================================ */
          /* STEP 1: Configuration Form */
          /* ============================================================ */
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

            {/* Generate Script Button */}
            <button
              onClick={handleGenerateScript}
              disabled={generating || textLength < minTextLength}
              className="w-full py-4 bg-gradient-to-r from-purple-600 to-cyan-600 rounded-xl font-medium text-lg disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition flex items-center justify-center gap-2"
            >
              {generating ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Generating AI Script...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  Generate AI Script
                </>
              )}
            </button>

            {generating && (
              <p className="text-xs text-white/30 text-center">
                AI is analyzing your text and creating scenes. This may take up to 30 seconds...
              </p>
            )}
          </div>
        )}
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
