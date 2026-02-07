'use client';

// ============================================================================
// ADMIN — AI Co-Director Management
// Story analysis, direction voting, and creative briefs
// ============================================================================

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Brain,
  Vote,
  FileText,
  Loader2,
  RefreshCw,
  Play,
  Check,
  AlertCircle,
  Clock,
  Users,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Edit,
  Send,
} from 'lucide-react';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { useCsrf } from '@/hooks/useCsrf';

// ============================================================================
// TYPES
// ============================================================================

interface Season {
  id: string;
  label: string;
  status: string;
  total_slots: number;
}

interface StoryAnalysis {
  id: string;
  slot_position: number;
  analysis: {
    characters: Array<{
      name: string;
      description: string;
      first_appearance_slot: number;
      traits: string[];
    }>;
    plot_threads: Array<{
      title: string;
      status: string;
      description: string;
    }>;
    setting: {
      location: string;
      time_period: string;
      atmosphere: string;
    };
    tone: string;
    themes: string[];
    visual_style: string;
    act_structure: {
      current_act: number;
      act_description: string;
    };
  };
  cost_cents: number;
  created_at: string;
}

interface DirectionOption {
  id: string;
  option_number: number;
  title: string;
  description: string;
  mood: string | null;
  suggested_genre: string | null;
  visual_hints: string | null;
  vote_count: number;
}

interface SlotBrief {
  id: string;
  slot_position: number;
  brief_title: string;
  scene_description: string;
  visual_requirements: string;
  tone_guidance: string;
  continuity_notes: string | null;
  do_list: string | null;
  dont_list: string | null;
  example_prompts: string[];
  status: string;
  cost_cents: number | null;
  published_at: string | null;
}

interface SlotInfo {
  slot_position: number;
  direction_voting_status: string | null;
  direction_voting_ends_at: string | null;
  winning_direction_id: string | null;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function CoDirectorPage() {
  const { isLoading: authLoading, isAdmin } = useAdminAuth();
  const { getHeaders } = useCsrf();

  // State
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null);
  const [currentSlot, setCurrentSlot] = useState<number>(1);
  const [slotInfo, setSlotInfo] = useState<SlotInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Analysis state
  const [analysis, setAnalysis] = useState<StoryAnalysis | null>(null);
  const [analysisExpanded, setAnalysisExpanded] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  // Directions state
  const [directions, setDirections] = useState<DirectionOption[]>([]);
  const [generatingDirections, setGeneratingDirections] = useState(false);
  const [openingVote, setOpeningVote] = useState(false);
  const [closingVote, setClosingVote] = useState(false);
  const [voteDuration, setVoteDuration] = useState(48);

  // Brief state
  const [brief, setBrief] = useState<SlotBrief | null>(null);
  const [generatingBrief, setGeneratingBrief] = useState(false);
  const [editingBrief, setEditingBrief] = useState(false);
  const [briefForm, setBriefForm] = useState<Partial<SlotBrief>>({});
  const [savingBrief, setSavingBrief] = useState(false);

  // ============================================================================
  // DATA FETCHING
  // ============================================================================

  useEffect(() => {
    if (!isAdmin) return;
    fetchSeasons();
  }, [isAdmin]);

  useEffect(() => {
    if (selectedSeason) {
      fetchSlotInfo();
      fetchAnalysis();
      fetchDirections();
      fetchBrief();
    }
  }, [selectedSeason, currentSlot]);

  async function fetchSeasons() {
    try {
      const res = await fetch('/api/admin/seasons', { headers: await getHeaders() });
      const data = await res.json();
      if (data.seasons) {
        setSeasons(data.seasons);
        const active = data.seasons.find((s: Season) => s.status === 'active');
        if (active) {
          setSelectedSeason(active.id);
          // Find current voting slot
          const slotsRes = await fetch(`/api/admin/slots?season_id=${active.id}`, {
            headers: await getHeaders(),
          });
          const slotsData = await slotsRes.json();
          if (slotsData.slots) {
            const votingSlot = slotsData.slots.find((s: { status: string }) => s.status === 'voting');
            if (votingSlot) setCurrentSlot(votingSlot.slot_position);
          }
        } else if (data.seasons.length > 0) {
          setSelectedSeason(data.seasons[0].id);
        }
      }
    } catch {
      setError('Failed to load seasons');
    } finally {
      setLoading(false);
    }
  }

  async function fetchSlotInfo() {
    if (!selectedSeason) return;
    try {
      const res = await fetch(`/api/admin/slots?season_id=${selectedSeason}`, {
        headers: await getHeaders(),
      });
      const data = await res.json();
      if (data.slots) {
        const slot = data.slots.find((s: { slot_position: number }) => s.slot_position === currentSlot);
        if (slot) {
          setSlotInfo({
            slot_position: slot.slot_position,
            direction_voting_status: slot.direction_voting_status,
            direction_voting_ends_at: slot.direction_voting_ends_at,
            winning_direction_id: slot.winning_direction_id,
          });
        }
      }
    } catch (err) {
      console.error('Failed to fetch slot info:', err);
    }
  }

  async function fetchAnalysis() {
    if (!selectedSeason) return;
    try {
      const res = await fetch(`/api/admin/co-director/analyses?season_id=${selectedSeason}`, {
        headers: await getHeaders(),
      });
      const data = await res.json();
      if (data.ok && data.analyses && data.analyses.length > 0) {
        setAnalysis(data.analyses[0]);
      } else {
        setAnalysis(null);
      }
    } catch (err) {
      console.error('Failed to fetch analysis:', err);
    }
  }

  async function fetchDirections() {
    if (!selectedSeason) return;
    try {
      const res = await fetch(`/api/co-director/directions?season_id=${selectedSeason}&slot_position=${currentSlot}`);
      const data = await res.json();
      if (data.ok) {
        setDirections(data.directions || []);
      }
    } catch (err) {
      console.error('Failed to fetch directions:', err);
    }
  }

  async function fetchBrief() {
    if (!selectedSeason) return;
    try {
      const res = await fetch(`/api/admin/co-director/brief?season_id=${selectedSeason}&slot_position=${currentSlot}`, {
        headers: await getHeaders(),
      });
      const data = await res.json();
      if (data.ok && data.briefs && data.briefs.length > 0) {
        const slotBrief = data.briefs.find((b: SlotBrief) => b.slot_position === currentSlot);
        setBrief(slotBrief || null);
        if (slotBrief) {
          setBriefForm(slotBrief);
        }
      } else {
        setBrief(null);
      }
    } catch (err) {
      console.error('Failed to fetch brief:', err);
    }
  }

  // ============================================================================
  // ACTIONS
  // ============================================================================

  async function handleAnalyze() {
    if (!selectedSeason) return;
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/co-director/analyze', {
        method: 'POST',
        headers: await getHeaders(),
        body: JSON.stringify({ season_id: selectedSeason }),
      });
      const data = await res.json();
      if (data.ok) {
        await fetchAnalysis();
      } else {
        setError(data.error || 'Failed to analyze story');
      }
    } catch {
      setError('Failed to analyze story');
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleGenerateDirections() {
    if (!selectedSeason) return;
    setGeneratingDirections(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/co-director/generate-directions', {
        method: 'POST',
        headers: await getHeaders(),
        body: JSON.stringify({ season_id: selectedSeason, slot_position: currentSlot }),
      });
      const data = await res.json();
      if (data.ok) {
        await fetchDirections();
      } else {
        setError(data.error || 'Failed to generate directions');
      }
    } catch {
      setError('Failed to generate directions');
    } finally {
      setGeneratingDirections(false);
    }
  }

  async function handleOpenVoting() {
    if (!selectedSeason) return;
    setOpeningVote(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/co-director/open-direction-vote', {
        method: 'POST',
        headers: await getHeaders(),
        body: JSON.stringify({
          season_id: selectedSeason,
          slot_position: currentSlot,
          duration_hours: voteDuration,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        await fetchSlotInfo();
        await fetchDirections();
      } else {
        setError(data.error || 'Failed to open voting');
      }
    } catch {
      setError('Failed to open voting');
    } finally {
      setOpeningVote(false);
    }
  }

  async function handleCloseVoting() {
    if (!selectedSeason) return;
    setClosingVote(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/co-director/close-direction-vote', {
        method: 'POST',
        headers: await getHeaders(),
        body: JSON.stringify({
          season_id: selectedSeason,
          slot_position: currentSlot,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        await fetchSlotInfo();
        await fetchDirections();
      } else {
        setError(data.error || 'Failed to close voting');
      }
    } catch {
      setError('Failed to close voting');
    } finally {
      setClosingVote(false);
    }
  }

  async function handleGenerateBrief() {
    if (!selectedSeason) return;
    setGeneratingBrief(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/co-director/generate-brief', {
        method: 'POST',
        headers: await getHeaders(),
        body: JSON.stringify({
          season_id: selectedSeason,
          slot_position: currentSlot,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        await fetchBrief();
      } else {
        setError(data.error || 'Failed to generate brief');
      }
    } catch {
      setError('Failed to generate brief');
    } finally {
      setGeneratingBrief(false);
    }
  }

  async function handleSaveBrief(publish: boolean = false) {
    if (!brief) return;
    setSavingBrief(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/co-director/brief', {
        method: 'PUT',
        headers: await getHeaders(),
        body: JSON.stringify({
          brief_id: brief.id,
          brief_title: briefForm.brief_title,
          scene_description: briefForm.scene_description,
          visual_requirements: briefForm.visual_requirements,
          tone_guidance: briefForm.tone_guidance,
          continuity_notes: briefForm.continuity_notes,
          do_list: briefForm.do_list,
          dont_list: briefForm.dont_list,
          example_prompts: briefForm.example_prompts,
          publish,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        await fetchBrief();
        setEditingBrief(false);
      } else {
        setError(data.error || 'Failed to save brief');
      }
    } catch {
      setError('Failed to save brief');
    } finally {
      setSavingBrief(false);
    }
  }

  // ============================================================================
  // RENDER
  // ============================================================================

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <p className="text-red-500">Access denied</p>
      </div>
    );
  }

  const season = seasons.find(s => s.id === selectedSeason);
  const totalVotes = directions.reduce((sum, d) => sum + (d.vote_count || 0), 0);

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-gray-900 to-black text-white">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link href="/admin" className="text-gray-400 hover:text-white">
              <ArrowLeft className="w-6 h-6" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Brain className="w-6 h-6 text-purple-500" />
                AI Co-Director
              </h1>
              <p className="text-gray-400 text-sm">Story analysis, direction voting, and creative briefs</p>
            </div>
          </div>

          {/* Season & Slot Selector */}
          <div className="flex items-center gap-4">
            <select
              value={selectedSeason || ''}
              onChange={(e) => setSelectedSeason(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
            >
              {seasons.map(s => (
                <option key={s.id} value={s.id}>
                  {s.label} {s.status === 'active' ? '(Active)' : ''}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <span className="text-gray-400 text-sm">Slot:</span>
              <input
                type="number"
                min={1}
                max={season?.total_slots || 75}
                value={currentSlot}
                onChange={(e) => setCurrentSlot(parseInt(e.target.value, 10) || 1)}
                className="w-16 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-sm text-center"
              />
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg flex items-center gap-2 text-red-300">
            <AlertCircle className="w-5 h-5" />
            {error}
          </div>
        )}

        {/* Main Content */}
        <div className="space-y-6">
          {/* Story Analysis Section */}
          <section className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-yellow-500" />
                Story Analysis
              </h2>
              <button
                onClick={handleAnalyze}
                disabled={analyzing}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 rounded-lg text-sm font-medium"
              >
                {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {analyzing ? 'Analyzing...' : 'Analyze Story'}
              </button>
            </div>

            {analysis ? (
              <div>
                <div className="flex items-center gap-4 text-sm text-gray-400 mb-4">
                  <span>Up to slot {analysis.slot_position}</span>
                  <span>Cost: ${(analysis.cost_cents / 100).toFixed(2)}</span>
                  <span>{new Date(analysis.created_at).toLocaleString()}</span>
                </div>

                <button
                  onClick={() => setAnalysisExpanded(!analysisExpanded)}
                  className="flex items-center gap-2 text-purple-400 hover:text-purple-300 text-sm"
                >
                  {analysisExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  {analysisExpanded ? 'Hide Details' : 'Show Details'}
                </button>

                {analysisExpanded && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="mt-4 space-y-4"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="bg-gray-900/50 rounded-lg p-4">
                        <h3 className="text-sm font-medium text-gray-300 mb-2">Characters</h3>
                        <ul className="space-y-2">
                          {analysis.analysis.characters.map((c, i) => (
                            <li key={i} className="text-sm text-gray-400">
                              <strong className="text-white">{c.name}</strong>: {c.description}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="bg-gray-900/50 rounded-lg p-4">
                        <h3 className="text-sm font-medium text-gray-300 mb-2">Plot Threads</h3>
                        <ul className="space-y-2">
                          {analysis.analysis.plot_threads.map((t, i) => (
                            <li key={i} className="text-sm text-gray-400">
                              <span className={`inline-block px-2 py-0.5 rounded text-xs mr-2 ${
                                t.status === 'active' ? 'bg-green-500/20 text-green-400' :
                                t.status === 'resolved' ? 'bg-gray-500/20 text-gray-400' :
                                'bg-yellow-500/20 text-yellow-400'
                              }`}>
                                {t.status}
                              </span>
                              <strong className="text-white">{t.title}</strong>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <div className="bg-gray-900/50 rounded-lg p-4">
                      <p className="text-sm"><strong>Tone:</strong> {analysis.analysis.tone}</p>
                      <p className="text-sm"><strong>Visual Style:</strong> {analysis.analysis.visual_style}</p>
                      <p className="text-sm"><strong>Themes:</strong> {analysis.analysis.themes.join(', ')}</p>
                    </div>
                  </motion.div>
                )}
              </div>
            ) : (
              <p className="text-gray-400 text-sm">No analysis yet. Click &quot;Analyze Story&quot; to generate.</p>
            )}
          </section>

          {/* Directions Section */}
          <section className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Vote className="w-5 h-5 text-blue-500" />
                Direction Options (Slot {currentSlot})
              </h2>
              <div className="flex items-center gap-2">
                {slotInfo?.direction_voting_status !== 'open' && (
                  <button
                    onClick={handleGenerateDirections}
                    disabled={generatingDirections || !analysis}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-sm font-medium"
                  >
                    {generatingDirections ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    Generate
                  </button>
                )}
              </div>
            </div>

            {directions.length > 0 ? (
              <div className="space-y-4">
                {/* Voting Status */}
                <div className="flex items-center gap-4 text-sm">
                  {slotInfo?.direction_voting_status === 'open' ? (
                    <>
                      <span className="flex items-center gap-1 text-green-400">
                        <Play className="w-4 h-4" /> Voting Open
                      </span>
                      {slotInfo.direction_voting_ends_at && (
                        <span className="flex items-center gap-1 text-gray-400">
                          <Clock className="w-4 h-4" />
                          Ends: {new Date(slotInfo.direction_voting_ends_at).toLocaleString()}
                        </span>
                      )}
                      <span className="flex items-center gap-1 text-gray-400">
                        <Users className="w-4 h-4" />
                        {totalVotes} votes
                      </span>
                    </>
                  ) : slotInfo?.direction_voting_status === 'closed' ? (
                    <span className="flex items-center gap-1 text-gray-400">
                      <Check className="w-4 h-4" /> Voting Closed
                    </span>
                  ) : (
                    <span className="text-gray-400">Voting not started</span>
                  )}
                </div>

                {/* Direction Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {directions.map(d => (
                    <div
                      key={d.id}
                      className={`bg-gray-900/50 rounded-lg p-4 border ${
                        slotInfo?.winning_direction_id === d.id
                          ? 'border-green-500'
                          : 'border-gray-700/50'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-gray-400">Option {d.option_number}</span>
                        <span className="text-sm font-medium text-purple-400">{d.vote_count} votes</span>
                      </div>
                      <h3 className="font-medium mb-2">{d.title}</h3>
                      <p className="text-sm text-gray-400 mb-3">{d.description}</p>
                      {d.mood && (
                        <span className="inline-block px-2 py-1 bg-purple-500/20 text-purple-300 rounded text-xs">
                          {d.mood}
                        </span>
                      )}
                      {slotInfo?.winning_direction_id === d.id && (
                        <div className="mt-2 flex items-center gap-1 text-green-400 text-sm">
                          <Check className="w-4 h-4" /> Winner
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Voting Controls */}
                <div className="flex items-center gap-4 pt-4 border-t border-gray-700">
                  {slotInfo?.direction_voting_status !== 'open' && slotInfo?.direction_voting_status !== 'closed' && (
                    <>
                      <div className="flex items-center gap-2">
                        <label className="text-sm text-gray-400">Duration:</label>
                        <select
                          value={voteDuration}
                          onChange={(e) => setVoteDuration(parseInt(e.target.value, 10))}
                          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm"
                        >
                          <option value={24}>24 hours</option>
                          <option value={48}>48 hours</option>
                          <option value={72}>72 hours</option>
                        </select>
                      </div>
                      <button
                        onClick={handleOpenVoting}
                        disabled={openingVote}
                        className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg text-sm font-medium"
                      >
                        {openingVote ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                        Open Voting
                      </button>
                    </>
                  )}
                  {slotInfo?.direction_voting_status === 'open' && (
                    <button
                      onClick={handleCloseVoting}
                      disabled={closingVote}
                      className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg text-sm font-medium"
                    >
                      {closingVote ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      Close & Pick Winner
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-gray-400 text-sm">
                No directions generated. {!analysis && 'Run story analysis first, then generate directions.'}
              </p>
            )}
          </section>

          {/* Brief Section */}
          <section className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <FileText className="w-5 h-5 text-green-500" />
                Creative Brief (Slot {currentSlot})
              </h2>
              <div className="flex items-center gap-2">
                {!brief && slotInfo?.winning_direction_id && (
                  <button
                    onClick={handleGenerateBrief}
                    disabled={generatingBrief}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg text-sm font-medium"
                  >
                    {generatingBrief ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    Generate Brief
                  </button>
                )}
                {brief && !editingBrief && (
                  <button
                    onClick={() => setEditingBrief(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium"
                  >
                    <Edit className="w-4 h-4" />
                    Edit
                  </button>
                )}
              </div>
            </div>

            {brief ? (
              <div>
                <div className="flex items-center gap-4 text-sm text-gray-400 mb-4">
                  <span className={`px-2 py-1 rounded text-xs ${
                    brief.status === 'published' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
                  }`}>
                    {brief.status}
                  </span>
                  {brief.cost_cents && <span>Cost: ${(brief.cost_cents / 100).toFixed(2)}</span>}
                  {brief.published_at && <span>Published: {new Date(brief.published_at).toLocaleString()}</span>}
                </div>

                {editingBrief ? (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">Title</label>
                      <input
                        type="text"
                        value={briefForm.brief_title || ''}
                        onChange={(e) => setBriefForm({ ...briefForm, brief_title: e.target.value })}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">Scene Description</label>
                      <textarea
                        value={briefForm.scene_description || ''}
                        onChange={(e) => setBriefForm({ ...briefForm, scene_description: e.target.value })}
                        rows={4}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">Visual Requirements</label>
                      <textarea
                        value={briefForm.visual_requirements || ''}
                        onChange={(e) => setBriefForm({ ...briefForm, visual_requirements: e.target.value })}
                        rows={3}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">Tone Guidance</label>
                      <textarea
                        value={briefForm.tone_guidance || ''}
                        onChange={(e) => setBriefForm({ ...briefForm, tone_guidance: e.target.value })}
                        rows={2}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2"
                      />
                    </div>
                    <div className="flex items-center gap-4 pt-4">
                      <button
                        onClick={() => handleSaveBrief(false)}
                        disabled={savingBrief}
                        className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded-lg text-sm font-medium"
                      >
                        {savingBrief ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        Save Draft
                      </button>
                      <button
                        onClick={() => handleSaveBrief(true)}
                        disabled={savingBrief}
                        className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg text-sm font-medium"
                      >
                        {savingBrief ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        Publish
                      </button>
                      <button
                        onClick={() => {
                          setEditingBrief(false);
                          setBriefForm(brief);
                        }}
                        className="text-gray-400 hover:text-white text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-xl font-medium">{brief.brief_title}</h3>
                    </div>
                    <div className="bg-gray-900/50 rounded-lg p-4">
                      <h4 className="text-sm font-medium text-gray-300 mb-2">Scene Description</h4>
                      <p className="text-sm text-gray-400">{brief.scene_description}</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="bg-gray-900/50 rounded-lg p-4">
                        <h4 className="text-sm font-medium text-gray-300 mb-2">Visual Requirements</h4>
                        <p className="text-sm text-gray-400">{brief.visual_requirements}</p>
                      </div>
                      <div className="bg-gray-900/50 rounded-lg p-4">
                        <h4 className="text-sm font-medium text-gray-300 mb-2">Tone Guidance</h4>
                        <p className="text-sm text-gray-400">{brief.tone_guidance}</p>
                      </div>
                    </div>
                    {brief.example_prompts && brief.example_prompts.length > 0 && (
                      <div className="bg-gray-900/50 rounded-lg p-4">
                        <h4 className="text-sm font-medium text-gray-300 mb-2">Example Prompts</h4>
                        <ul className="space-y-2">
                          {brief.example_prompts.map((p, i) => (
                            <li key={i} className="text-sm text-gray-400 bg-gray-800 rounded px-3 py-2">
                              &ldquo;{p}&rdquo;
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-400 text-sm">
                No brief generated. {!slotInfo?.winning_direction_id && 'Close direction voting first to pick a winner.'}
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
