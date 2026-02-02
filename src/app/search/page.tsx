'use client';

// ============================================================================
// SEARCH PAGE - Discover clips and creators
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import {
  Search,
  X,
  Filter,
  TrendingUp,
  Clock,
  Flame,
  Heart,
  Play,
  User,
  Film,
  Trophy,
  Loader2,
  BookOpen,
  Plus,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import BottomNavigation from '@/components/BottomNavigation';

// ============================================================================
// TYPES
// ============================================================================

interface DiscoverClip {
  id: string;
  thumbnail_url: string;
  video_url: string;
  username: string;
  avatar_url: string;
  genre: string;
  vote_count: number;
  slot_position: number;
  created_at: string;
}

interface DiscoverCreator {
  user_id: string;
  username: string;
  avatar_url: string;
  total_clips: number;
  total_votes: number;
  locked_in_clips: number;
}

type SortType = 'trending' | 'newest' | 'top';
type TabType = 'all' | 'clips' | 'creators';

const GENRES = ['All', 'Action', 'Comedy', 'Drama', 'Horror', 'Sci-Fi', 'Thriller', 'Romance', 'Animation'];

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

// Debounce hook
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function SearchPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [selectedGenre, setSelectedGenre] = useState('All');
  const [sortBy, setSortBy] = useState<SortType>('trending');
  const [showFilters, setShowFilters] = useState(false);

  const [clips, setClips] = useState<DiscoverClip[]>([]);
  const [creators, setCreators] = useState<DiscoverCreator[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const debouncedQuery = useDebounce(searchQuery, 300);

  // Fetch data
  const fetchData = useCallback(async (resetPage = false) => {
    setLoading(true);
    setError(null);

    const currentPage = resetPage ? 1 : page;
    if (resetPage) setPage(1);

    try {
      const params = new URLSearchParams({
        q: debouncedQuery,
        type: activeTab,
        sort: sortBy,
        page: currentPage.toString(),
        limit: '20',
      });

      if (selectedGenre !== 'All') {
        params.set('genre', selectedGenre);
      }

      const response = await fetch(`/api/discover?${params}`);
      if (!response.ok) throw new Error('Failed to fetch');

      const data = await response.json();

      if (resetPage || currentPage === 1) {
        setClips(data.clips || []);
        setCreators(data.creators || []);
      } else {
        setClips((prev) => [...prev, ...(data.clips || [])]);
        setCreators((prev) => [...prev, ...(data.creators || [])]);
      }

      setHasMore(data.has_more || false);
    } catch (err) {
      console.error('Search error:', err);
      setError('Failed to load results');
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, activeTab, selectedGenre, sortBy, page]);

  // Fetch on filter changes
  useEffect(() => {
    fetchData(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, activeTab, selectedGenre, sortBy]);

  // Load more
  const loadMore = () => {
    if (!loading && hasMore) {
      setPage((p) => p + 1);
      fetchData(false);
    }
  };

  // Sort options
  const sortOptions: { value: SortType; label: string; icon: React.ReactNode }[] = [
    { value: 'trending', label: 'Trending', icon: <Flame className="w-4 h-4" /> },
    { value: 'newest', label: 'Newest', icon: <Clock className="w-4 h-4" /> },
    { value: 'top', label: 'Top', icon: <TrendingUp className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Desktop Layout */}
      <div className="hidden md:flex h-screen">
        {/* Left Sidebar */}
        <div className="w-56 h-full flex flex-col py-4 px-3 border-r border-white/10">
          <Link href="/dashboard" className="flex items-center gap-2 px-3 py-2 mb-4">
            <span className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-[#3CF2FF] to-[#FF00C7]">
              AiMoviez
            </span>
          </Link>

          <nav className="flex-1 space-y-1">
            <Link href="/dashboard"><div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition"><Heart className="w-6 h-6" /><span>Vote Now</span></div></Link>
            <Link href="/story"><div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition"><BookOpen className="w-6 h-6" /><span>Story</span></div></Link>
            <Link href="/watch"><div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition"><Play className="w-6 h-6" /><span>Watch</span></div></Link>
            <Link href="/upload"><div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition"><Plus className="w-6 h-6" /><span>Upload</span></div></Link>
            <Link href="/create"><div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition"><Sparkles className="w-6 h-6" /><span>AI Create</span></div></Link>
            <Link href="/leaderboard"><div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition"><Trophy className="w-6 h-6" /><span>Leaderboard</span></div></Link>
            <Link href="/profile"><div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition"><User className="w-6 h-6" /><span>Profile</span></div>
            </Link>
          </nav>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto px-6 py-8">
            {/* Search Header */}
            <div className="mb-8">
              <h1 className="text-3xl font-black mb-6">Discover</h1>

              {/* Search Input */}
              <div className="relative mb-6">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/60" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search clips, creators, genres..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-12 pr-12 py-4 bg-white/5 border border-white/10 rounded-2xl text-white placeholder-white/40 focus:outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20 transition-all"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-4 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-white/10 transition"
                  >
                    <X className="w-5 h-5 text-white/60" />
                  </button>
                )}
              </div>

              {/* Tabs */}
              <div className="flex items-center gap-6 mb-6">
                <div className="flex bg-white/5 rounded-xl p-1">
                  {(['all', 'clips', 'creators'] as TabType[]).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-4 py-2 rounded-lg font-medium capitalize transition-all ${
                        activeTab === tab
                          ? 'bg-white/10 text-white'
                          : 'text-white/60 hover:text-white'
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                {/* Sort */}
                <div className="flex items-center gap-2">
                  {sortOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => setSortBy(option.value)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                        sortBy === option.value
                          ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                          : 'bg-white/5 text-white/60 hover:text-white border border-transparent'
                      }`}
                    >
                      {option.icon}
                      <span className="text-sm">{option.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Genre Pills */}
              <div className="flex flex-wrap gap-2">
                {GENRES.map((genre) => (
                  <button
                    key={genre}
                    onClick={() => setSelectedGenre(genre)}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                      selectedGenre === genre
                        ? 'bg-gradient-to-r from-cyan-500 to-purple-500 text-white'
                        : 'bg-white/5 text-white/70 hover:bg-white/10'
                    }`}
                  >
                    {genre}
                  </button>
                ))}
              </div>
            </div>

            {/* Results */}
            {loading && clips.length === 0 && creators.length === 0 ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
              </div>
            ) : error ? (
              <div className="text-center py-20">
                <p className="text-white/60 mb-4">{error}</p>
                <button
                  onClick={() => fetchData(true)}
                  className="px-6 py-3 bg-white/10 rounded-xl hover:bg-white/20 transition"
                >
                  Try Again
                </button>
              </div>
            ) : (
              <>
                {/* Clips Grid */}
                {(activeTab === 'all' || activeTab === 'clips') && clips.length > 0 && (
                  <div className="mb-10">
                    {activeTab === 'all' && (
                      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                        <Film className="w-5 h-5 text-cyan-500" />
                        Clips
                      </h2>
                    )}
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                      {clips.map((clip) => (
                        <ClipCard key={clip.id} clip={clip} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Creators Grid */}
                {(activeTab === 'all' || activeTab === 'creators') && creators.length > 0 && (
                  <div className="mb-10">
                    {activeTab === 'all' && (
                      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                        <User className="w-5 h-5 text-purple-500" />
                        Creators
                      </h2>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {creators.map((creator) => (
                        <CreatorCard key={creator.user_id} creator={creator} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Empty State */}
                {clips.length === 0 && creators.length === 0 && !loading && (
                  <div className="text-center py-20">
                    <Search className="w-16 h-16 mx-auto mb-4 text-white/60" />
                    <h3 className="text-xl font-bold mb-2">No results found</h3>
                    <p className="text-white/60">
                      {searchQuery
                        ? `No results for "${searchQuery}"`
                        : 'Start searching to discover clips and creators'}
                    </p>
                  </div>
                )}

                {/* Load More */}
                {hasMore && (
                  <div className="text-center py-8">
                    <button
                      onClick={loadMore}
                      disabled={loading}
                      className="px-8 py-3 bg-white/10 rounded-xl hover:bg-white/20 transition disabled:opacity-50"
                    >
                      {loading ? (
                        <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                      ) : (
                        'Load More'
                      )}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Layout */}
      <div className="md:hidden pb-24">
        {/* Sticky Search Header */}
        <div className="sticky top-0 z-30 bg-black/90 backdrop-blur-xl border-b border-white/10">
          <div className="px-4 pt-4 pb-3">
            {/* Search Input */}
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/60" />
              <input
                type="text"
                placeholder="Search clips, creators..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-10 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/40 focus:outline-none focus:border-cyan-500/50 transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                >
                  <X className="w-5 h-5 text-white/40" />
                </button>
              )}
            </div>

            {/* Tabs & Filter Toggle */}
            <div className="flex items-center justify-between">
              <div className="flex bg-white/5 rounded-lg p-1">
                {(['all', 'clips', 'creators'] as TabType[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium capitalize transition-all ${
                      activeTab === tab
                        ? 'bg-white/10 text-white'
                        : 'text-white/60'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`p-2 rounded-lg transition ${
                  showFilters ? 'bg-cyan-500/20 text-cyan-400' : 'bg-white/5 text-white/60'
                }`}
              >
                <Filter className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Expandable Filters */}
          <AnimatePresence>
            {showFilters && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden border-t border-white/10"
              >
                <div className="px-4 py-3 space-y-3">
                  {/* Sort */}
                  <div className="flex items-center gap-2">
                    {sortOptions.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => setSortBy(option.value)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all ${
                          sortBy === option.value
                            ? 'bg-cyan-500/20 text-cyan-400'
                            : 'bg-white/5 text-white/60'
                        }`}
                      >
                        {option.icon}
                        {option.label}
                      </button>
                    ))}
                  </div>

                  {/* Genres */}
                  <div className="flex flex-wrap gap-2">
                    {GENRES.map((genre) => (
                      <button
                        key={genre}
                        onClick={() => setSelectedGenre(genre)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                          selectedGenre === genre
                            ? 'bg-gradient-to-r from-cyan-500 to-purple-500 text-white'
                            : 'bg-white/5 text-white/70'
                        }`}
                      >
                        {genre}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Results */}
        <div className="px-4 py-4">
          {loading && clips.length === 0 && creators.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
            </div>
          ) : error ? (
            <div className="text-center py-20">
              <p className="text-white/60 mb-4">{error}</p>
              <button
                onClick={() => fetchData(true)}
                className="px-6 py-3 bg-white/10 rounded-xl"
              >
                Try Again
              </button>
            </div>
          ) : (
            <>
              {/* Clips Grid */}
              {(activeTab === 'all' || activeTab === 'clips') && clips.length > 0 && (
                <div className="mb-6">
                  {activeTab === 'all' && (
                    <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
                      <Film className="w-4 h-4 text-cyan-500" />
                      Clips
                    </h2>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
                    {clips.map((clip) => (
                      <ClipCard key={clip.id} clip={clip} />
                    ))}
                  </div>
                </div>
              )}

              {/* Creators */}
              {(activeTab === 'all' || activeTab === 'creators') && creators.length > 0 && (
                <div className="mb-6">
                  {activeTab === 'all' && (
                    <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
                      <User className="w-4 h-4 text-purple-500" />
                      Creators
                    </h2>
                  )}
                  <div className="space-y-2">
                    {creators.map((creator) => (
                      <CreatorCard key={creator.user_id} creator={creator} />
                    ))}
                  </div>
                </div>
              )}

              {/* Empty State */}
              {clips.length === 0 && creators.length === 0 && !loading && (
                <div className="text-center py-16">
                  <Search className="w-12 h-12 mx-auto mb-3 text-white/60" />
                  <h3 className="text-lg font-bold mb-1">No results</h3>
                  <p className="text-sm text-white/60">
                    {searchQuery ? `Nothing found for "${searchQuery}"` : 'Search to discover'}
                  </p>
                </div>
              )}

              {/* Load More */}
              {hasMore && (
                <div className="text-center py-6">
                  <button
                    onClick={loadMore}
                    disabled={loading}
                    className="px-6 py-2.5 bg-white/10 rounded-xl text-sm"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Load More'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <BottomNavigation />
      </div>
    </div>
  );
}

// ============================================================================
// CLIP CARD COMPONENT
// ============================================================================

function ClipCard({ clip }: { clip: DiscoverClip }) {
  return (
    <Link href={`/clip/${clip.id}`}>
      <motion.div
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className="relative aspect-[9/16] rounded-xl overflow-hidden bg-white/5 group"
      >
        {/* Thumbnail/Video - only use Image for actual images, not video URLs */}
        {clip.thumbnail_url && !clip.thumbnail_url.match(/\.(mp4|webm|mov|quicktime)$/i) ? (
          <Image
            src={clip.thumbnail_url}
            alt={`Clip by ${clip.username}`}
            fill
            sizes="(max-width: 768px) 50vw, 25vw"
            className="object-cover"
          />
        ) : clip.video_url ? (
          <video
            src={clip.video_url}
            className="w-full h-full object-cover"
            muted
            preload="metadata"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Film className="w-8 h-8 text-white/60" />
          </div>
        )}

        {/* Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />

        {/* Play Icon */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
            <Play className="w-6 h-6 text-white" fill="white" />
          </div>
        </div>

        {/* Genre Badge */}
        <div className="absolute top-2 left-2">
          <span className="px-2 py-1 bg-black/50 backdrop-blur-sm rounded-full text-[10px] font-medium">
            {clip.genre}
          </span>
        </div>

        {/* Bottom Info */}
        <div className="absolute bottom-0 left-0 right-0 p-3">
          <div className="flex items-center gap-2 mb-1">
            <Image
              src={clip.avatar_url}
              alt={clip.username}
              width={24}
              height={24}
              className="w-6 h-6 rounded-full bg-white/10"
              unoptimized={clip.avatar_url?.includes('dicebear') || clip.avatar_url?.endsWith('.svg')}
            />
            <span className="text-xs font-medium truncate">@{clip.username}</span>
          </div>
          <div className="flex items-center gap-1 text-xs text-white/70">
            <Heart className="w-3 h-3" fill="#ec4899" />
            <span>{formatNumber(clip.vote_count)}</span>
          </div>
        </div>
      </motion.div>
    </Link>
  );
}

// ============================================================================
// CREATOR CARD COMPONENT
// ============================================================================

function CreatorCard({ creator }: { creator: DiscoverCreator }) {
  return (
    <Link href={`/profile/${creator.username}`}>
      <motion.div
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
        className="flex items-center gap-4 p-4 bg-white/5 rounded-xl hover:bg-white/10 transition-all"
      >
        {/* Avatar */}
        <Image
          src={creator.avatar_url}
          alt={creator.username}
          width={56}
          height={56}
          className="w-14 h-14 rounded-full bg-white/10"
          unoptimized={creator.avatar_url?.includes('dicebear') || creator.avatar_url?.endsWith('.svg')}
        />

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="font-bold truncate">@{creator.username}</div>
          <div className="flex items-center gap-3 text-sm text-white/60 mt-1">
            <span className="flex items-center gap-1">
              <Film className="w-3.5 h-3.5" />
              {creator.total_clips} clips
            </span>
            <span className="flex items-center gap-1">
              <Heart className="w-3.5 h-3.5" />
              {formatNumber(creator.total_votes)}
            </span>
          </div>
        </div>

        {/* Winner Badge */}
        {creator.locked_in_clips > 0 && (
          <div className="flex items-center gap-1 px-2 py-1 bg-yellow-500/20 rounded-full">
            <Trophy className="w-3.5 h-3.5 text-yellow-500" />
            <span className="text-xs font-bold text-yellow-500">{creator.locked_in_clips}</span>
          </div>
        )}

        <ChevronRight className="w-5 h-5 text-white/60" />
      </motion.div>
    </Link>
  );
}
