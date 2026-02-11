'use client';

import { useState, useCallback } from 'react';
import { Edit3, Save, X, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useCsrf } from '@/hooks/useCsrf';
import type { MovieScene } from '@/hooks/useMovieProject';

interface MovieScriptEditorProps {
  projectId: string;
  scenes: MovieScene[];
  onSaved: () => void;
}

export default function MovieScriptEditor({ projectId, scenes, onSaved }: MovieScriptEditorProps) {
  const csrf = useCsrf();
  const [editingScene, setEditingScene] = useState<number | null>(null);
  const [editPrompt, setEditPrompt] = useState('');
  const [editNarration, setEditNarration] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [expandedScene, setExpandedScene] = useState<number | null>(null);

  const startEdit = useCallback((scene: MovieScene) => {
    setEditingScene(scene.scene_number);
    setEditPrompt(scene.video_prompt);
    setEditNarration(scene.narration_text || '');
    setEditTitle(scene.scene_title || '');
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingScene(null);
    setEditPrompt('');
    setEditNarration('');
    setEditTitle('');
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingScene) return;
    setSaving(true);
    try {
      const res = await csrf.fetch(`/api/movie/projects/${projectId}/scenes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenes: [{
            scene_number: editingScene,
            video_prompt: editPrompt,
            narration_text: editNarration || null,
            scene_title: editTitle,
          }],
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Failed to save');
        return;
      }

      toast.success('Scene updated');
      setEditingScene(null);
      onSaved();
    } catch {
      toast.error('Failed to save changes');
    } finally {
      setSaving(false);
    }
  }, [editingScene, editPrompt, editNarration, editTitle, projectId, csrf, onSaved]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold">Script ({scenes.length} scenes)</h3>
        <span className="text-xs text-white/40">Click a scene to edit</span>
      </div>

      {scenes.map((scene) => (
        <div
          key={scene.id}
          className={`rounded-lg border transition ${
            editingScene === scene.scene_number
              ? 'border-purple-500/50 bg-purple-500/5'
              : 'border-white/10 bg-white/5 hover:border-white/20'
          }`}
        >
          {/* Scene Header */}
          <button
            onClick={() => {
              if (editingScene === scene.scene_number) return;
              setExpandedScene(expandedScene === scene.scene_number ? null : scene.scene_number);
            }}
            className="w-full flex items-center gap-3 px-4 py-3"
          >
            <span className="text-xs font-mono text-white/40 w-8">#{scene.scene_number}</span>
            <span className="flex-1 text-sm text-left truncate">
              {scene.scene_title || `Scene ${scene.scene_number}`}
            </span>
            {editingScene !== scene.scene_number && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); startEdit(scene); }}
                  className="text-white/40 hover:text-purple-400 p-1"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
                {expandedScene === scene.scene_number ? (
                  <ChevronUp className="w-4 h-4 text-white/30" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-white/30" />
                )}
              </>
            )}
          </button>

          {/* Expanded View (read-only) */}
          {expandedScene === scene.scene_number && editingScene !== scene.scene_number && (
            <div className="px-4 pb-3 space-y-2 border-t border-white/5">
              <p className="text-xs text-white/60 mt-2">{scene.video_prompt}</p>
              {scene.narration_text && (
                <p className="text-xs text-purple-300/60 italic">&ldquo;{scene.narration_text}&rdquo;</p>
              )}
            </div>
          )}

          {/* Edit Mode */}
          {editingScene === scene.scene_number && (
            <div className="px-4 pb-4 space-y-3 border-t border-purple-500/20">
              <div>
                <label className="text-xs text-white/50 mb-1 block">Scene Title</label>
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                  maxLength={200}
                />
              </div>
              <div>
                <label className="text-xs text-white/50 mb-1 block">Video Prompt</label>
                <textarea
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white min-h-[80px] resize-y"
                  maxLength={2000}
                />
              </div>
              <div>
                <label className="text-xs text-white/50 mb-1 block">Narration Text (optional)</label>
                <textarea
                  value={editNarration}
                  onChange={(e) => setEditNarration(e.target.value)}
                  className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white min-h-[60px] resize-y"
                  maxLength={500}
                  placeholder="Leave empty for no narration"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={cancelEdit} className="px-3 py-1.5 text-sm text-white/60 hover:text-white">
                  <X className="w-4 h-4 inline mr-1" />Cancel
                </button>
                <button
                  onClick={saveEdit}
                  disabled={saving}
                  className="px-4 py-1.5 text-sm bg-purple-500 hover:bg-purple-600 rounded-lg disabled:opacity-50"
                >
                  <Save className="w-4 h-4 inline mr-1" />{saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
