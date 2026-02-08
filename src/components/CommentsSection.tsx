'use client';

import { useState, useEffect, useRef, memo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';
import Image from 'next/image';
import {
  MessageCircle, Heart, Send, X, MoreHorizontal,
  Trash2, Flag, ChevronDown, ChevronUp, Loader2,
  Reply, Smile
} from 'lucide-react';
import { useCsrf } from '@/hooks/useCsrf';
import { useRealtimeComments } from '@/hooks/useRealtimeComments';
import type { NewCommentPayload, CommentLikedPayload, CommentDeletedPayload } from '@/hooks/useRealtimeComments';
import ReportModal from '@/components/ReportModal';

// ============================================================================
// COMMENTS SECTION COMPONENT
// ============================================================================
// Features:
// - Real-time comment posting
// - Like/unlike comments
// - Reply to comments
// - Delete own comments
// - Load more pagination
// - Emoji picker (basic)
// - TikTok-style slide-up panel on mobile
// ============================================================================

interface Comment {
  id: string;
  clip_id: string;
  user_key: string;
  username: string;
  avatar_url: string;
  comment_text: string;
  likes_count: number;
  parent_comment_id?: string;
  created_at: string;
  is_own: boolean;
  is_liked: boolean;
  replies?: Comment[];
  total_replies?: number;
}

interface CommentsSectionProps {
  clipId: string;
  isOpen: boolean;
  onClose: () => void;
  clipUsername?: string;
  onCommentAdded?: () => void; // Called when a new comment is successfully posted
}

// Emoji picker options with accessible labels for screen readers
const EMOJIS: { emoji: string; label: string }[] = [
  { emoji: '❤️', label: 'heart' },
  { emoji: '🔥', label: 'fire' },
  { emoji: '😂', label: 'laughing' },
  { emoji: '😮', label: 'surprised' },
  { emoji: '👏', label: 'clapping' },
  { emoji: '💯', label: '100' },
  { emoji: '🎬', label: 'movie' },
  { emoji: '👻', label: 'ghost' },
  { emoji: '🚀', label: 'rocket' },
  { emoji: '✨', label: 'sparkles' },
];

function timeAgo(dateString: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return `${Math.floor(seconds / 604800)}w`;
}

function CommentsSectionComponent({ clipId, isOpen, onClose, clipUsername: _clipUsername, onCommentAdded }: CommentsSectionProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [replyingTo, setReplyingTo] = useState<Comment | null>(null);
  const [loading, setLoading] = useState(false);
  // FIX: Use ref for synchronous loading check to prevent stale closure in fetchComments
  const loadingRef = useRef(false);
  const [posting, setPosting] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
  const [showEmojis, setShowEmojis] = useState(false);
  const [expandedReplies, setExpandedReplies] = useState<Set<string>>(new Set());
  const [reportComment, setReportComment] = useState<Comment | null>(null);
  const [loadingReplies, setLoadingReplies] = useState<Set<string>>(new Set());

  // Use ref for synchronous race condition prevention (state is async)
  const likingCommentsRef = useRef<Set<string>>(new Set());

  const inputRef = useRef<HTMLInputElement>(null);
  const commentsContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const loadedClipIdRef = useRef<string | null>(null); // Track which clipId we loaded comments for
  const wasOpenRef = useRef(false); // Track previous isOpen state
  const onCloseRef = useRef(onClose); // Stable ref for onClose to avoid effect re-runs
  onCloseRef.current = onClose;

  // CSRF protection for API calls
  const { getHeaders } = useCsrf();

  // Real-time comments via Supabase Broadcast
  const handleRealtimeNewComment = useCallback((payload: NewCommentPayload) => {
    const incomingComment: Comment = {
      id: payload.id,
      clip_id: payload.clipId,
      user_key: '',
      username: payload.username,
      avatar_url: payload.avatarUrl,
      comment_text: payload.commentText,
      likes_count: 0,
      parent_comment_id: payload.parentCommentId,
      created_at: new Date(payload.timestamp).toISOString(),
      is_own: false,
      is_liked: false,
      replies: [],
    };

    if (payload.parentCommentId) {
      setComments(prev => prev.map(c => {
        if (c.id === payload.parentCommentId) {
          if (c.replies?.some(r => r.id === payload.id)) return c;
          return { ...c, replies: [...(c.replies || []), incomingComment] };
        }
        return c;
      }));
    } else {
      setComments(prev => {
        if (prev.some(c => c.id === payload.id)) return prev;
        return [incomingComment, ...prev];
      });
      setTotal(prev => prev + 1);
    }
  }, []);

  const handleRealtimeCommentLiked = useCallback((payload: CommentLikedPayload) => {
    const updateLikes = (c: Comment): Comment => {
      if (c.id === payload.commentId) {
        return { ...c, likes_count: payload.likesCount };
      }
      if (c.replies) {
        return { ...c, replies: c.replies.map(updateLikes) };
      }
      return c;
    };
    setComments(prev => prev.map(updateLikes));
  }, []);

  const handleRealtimeCommentDeleted = useCallback((payload: CommentDeletedPayload) => {
    setComments(prev => prev
      .filter(c => c.id !== payload.commentId)
      .map(c => ({
        ...c,
        replies: c.replies?.filter(r => r.id !== payload.commentId),
      }))
    );
  }, []);

  useRealtimeComments(clipId, {
    enabled: isOpen,
    onNewComment: handleRealtimeNewComment,
    onCommentLiked: handleRealtimeCommentLiked,
    onCommentDeleted: handleRealtimeCommentDeleted,
  });

  // Focus trap and keyboard handling
  useEffect(() => {
    if (!isOpen) return;

    // Store previously focused element to restore on close
    const previouslyFocusedElement = document.activeElement as HTMLElement;

    // Lock body scroll when modal is open - use touch-action for better mobile support
    const originalOverflow = document.body.style.overflow;
    const originalPosition = document.body.style.position;
    const originalTop = document.body.style.top;
    const scrollY = window.scrollY;

    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';

    // Only auto-focus on desktop to avoid mobile keyboard scroll issues
    const isMobile = window.innerWidth < 768;
    if (!isMobile) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Close on Escape
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }

      // Focus trap on Tab only - don't interfere with other keys
      if (e.key === 'Tab' && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );

        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      // Restore body scroll and position
      document.body.style.overflow = originalOverflow;
      document.body.style.position = originalPosition;
      document.body.style.top = originalTop;
      document.body.style.width = '';
      window.scrollTo(0, scrollY);
      // Restore focus when modal closes
      previouslyFocusedElement?.focus?.();
    };
  }, [isOpen]); // Removed onClose from deps - using ref instead

  // Fetch comments
  // FIX: Use loadingRef for synchronous check to prevent stale closure issues
  const fetchComments = async (pageNum: number = 1, append: boolean = false) => {
    // Use ref for synchronous check (state is async and can cause stale closure)
    if (loadingRef.current) return;

    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new AbortController for this request
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Update both ref (synchronous) and state (for UI)
    loadingRef.current = true;
    setLoading(true);

    try {
      const res = await fetch(`/api/comments?clipId=${clipId}&page=${pageNum}&limit=20&sort=newest`, {
        signal: abortController.signal,
      });

      if (!res.ok) {
        const data = await res.json();
        const errorMessage = data.error || 'Failed to load comments. Please try again.';
        toast.error(errorMessage);
        return;
      }

      const data = await res.json();

      if (data.comments) {
        if (append) {
          setComments(prev => [...prev, ...data.comments]);
        } else {
          setComments(data.comments);
        }
        setTotal(data.total);
        setHasMore(data.has_more);
        setPage(pageNum);
      }
    } catch (err) {
      // Ignore aborted requests
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      console.error('Failed to fetch comments:', err);
      const errorMessage = err instanceof Error ? err.message : 'Network error. Please check your connection and try again.';
      toast.error(errorMessage);
    } finally {
      // Update both ref and state
      loadingRef.current = false;
      setLoading(false);
    }
  };

  // Load comments when opened - only fetch on open transition, not on clipId change while open
  useEffect(() => {
    const justOpened = isOpen && !wasOpenRef.current;
    wasOpenRef.current = isOpen;

    // Only fetch if we just opened AND (clipId is new OR we haven't loaded anything yet)
    if (justOpened && clipId && loadedClipIdRef.current !== clipId) {
      loadedClipIdRef.current = clipId;
      fetchComments(1, false);
    }

    // Reset loaded clipId when closing so next open will reload
    if (!isOpen) {
      loadedClipIdRef.current = null;
    }

    // Cleanup: abort pending request on unmount or when modal closes
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, clipId]);

  // Post new comment
  const handlePostComment = async () => {
    if (!newComment.trim() || posting) return;
    
    setPosting(true);
    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: getHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          clipId,
          comment_text: newComment.trim(),
          parent_comment_id: replyingTo?.id || null,
        }),
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        const errorMessage = data.error || data.details || 'Failed to post comment. Please try again.';
        console.error('Failed to post comment:', errorMessage);
        toast.error(errorMessage);
        return;
      }
      
      if (data.success && data.comment && data.comment.id) {
        if (replyingTo) {
          // Add reply to parent comment
          setComments(prev => prev.map(c => {
            if (c.id === replyingTo.id) {
              return {
                ...c,
                replies: [...(c.replies || []), data.comment],
              };
            }
            return c;
          }));
          setExpandedReplies(prev => new Set([...prev, replyingTo.id]));
        } else {
          // Add new top-level comment
          setComments(prev => [data.comment, ...prev]);
          setTotal(prev => prev + 1);
          // Notify parent that a comment was added (for comment count update)
          onCommentAdded?.();
        }

        setNewComment('');
        setReplyingTo(null);
        setShowEmojis(false);
      } else {
        toast.error('Failed to post comment. Please try again.');
      }
    } catch (err) {
      console.error('Failed to post comment:', err);
      const errorMessage = err instanceof Error ? err.message : 'Network error. Please check your connection and try again.';
      toast.error(errorMessage);
    } finally {
      setPosting(false);
    }
  };

  // Like/unlike comment
  const handleLike = async (comment: Comment) => {
    // Prevent race condition: use ref for synchronous check (state is async)
    if (likingCommentsRef.current.has(comment.id)) return;

    // Immediately mark as in-flight using ref (synchronous)
    likingCommentsRef.current.add(comment.id);

    // Capture original state for rollback
    const originalIsLiked = comment.is_liked;
    const originalLikesCount = comment.likes_count;
    const action = originalIsLiked ? 'unlike' : 'like';

    // Optimistic update
    const updateComment = (c: Comment): Comment => {
      if (c.id === comment.id) {
        return {
          ...c,
          is_liked: !c.is_liked,
          likes_count: c.is_liked ? c.likes_count - 1 : c.likes_count + 1,
        };
      }
      if (c.replies) {
        return { ...c, replies: c.replies.map(updateComment) };
      }
      return c;
    };

    setComments(prev => prev.map(updateComment));

    try {
      const res = await fetch('/api/comments', {
        method: 'PATCH',
        headers: getHeaders(),
        credentials: 'include',
        body: JSON.stringify({ comment_id: comment.id, action }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update like');
      }
    } catch (err) {
      // Revert on error using captured original state
      setComments(prev => prev.map(c => {
        if (c.id === comment.id) {
          return { ...c, is_liked: originalIsLiked, likes_count: originalLikesCount };
        }
        return c;
      }));
      const errorMessage = err instanceof Error ? err.message : 'Failed to update like. Please try again.';
      toast.error(errorMessage);
    } finally {
      // Clear in-flight status from ref
      likingCommentsRef.current.delete(comment.id);
    }
  };

  // Delete comment
  const handleDelete = async (comment: Comment) => {
    if (!confirm('Delete this comment?')) return;

    try {
      const res = await fetch('/api/comments', {
        method: 'DELETE',
        headers: getHeaders(),
        credentials: 'include',
        body: JSON.stringify({ comment_id: comment.id }),
      });
      
      if (res.ok) {
        // Remove from list
        setComments(prev => prev.filter(c => c.id !== comment.id).map(c => ({
          ...c,
          replies: c.replies?.filter(r => r.id !== comment.id),
        })));
        setTotal(prev => prev - 1);
      } else {
        const data = await res.json();
        const errorMessage = data.error || 'Failed to delete comment. Please try again.';
        toast.error(errorMessage);
      }
    } catch (err) {
      console.error('Failed to delete comment:', err);
      const errorMessage = err instanceof Error ? err.message : 'Network error. Please check your connection and try again.';
      toast.error(errorMessage);
    }
  };

  // Reply to comment
  const handleReply = (comment: Comment) => {
    setReplyingTo(comment);
    setNewComment(`@${comment.username} `);
    inputRef.current?.focus();
  };

  // Add emoji to comment
  const addEmoji = (emoji: string) => {
    setNewComment(prev => prev + emoji);
    inputRef.current?.focus();
  };

  // Toggle replies visibility
  const toggleReplies = (commentId: string) => {
    setExpandedReplies(prev => {
      const next = new Set(prev);
      if (next.has(commentId)) next.delete(commentId);
      else next.add(commentId);
      return next;
    });
  };

  // Load more
  const loadMore = () => {
    if (hasMore && !loading) {
      fetchComments(page + 1, true);
    }
  };

  // Fetch more replies for a parent comment beyond the initial 5
  const fetchMoreReplies = async (parentCommentId: string) => {
    if (loadingReplies.has(parentCommentId)) return;

    setLoadingReplies(prev => new Set([...prev, parentCommentId]));
    try {
      const currentReplies = comments.find(c => c.id === parentCommentId)?.replies || [];
      const offset = currentReplies.length;

      const res = await fetch(
        `/api/comments?clipId=${clipId}&parentId=${parentCommentId}&offset=${offset}&limit=50`
      );

      if (!res.ok) {
        toast.error('Failed to load more replies');
        return;
      }

      const data = await res.json();
      if (data.replies && data.replies.length > 0) {
        setComments(prev => prev.map(c => {
          if (c.id === parentCommentId) {
            // Dedupe by id
            const existingIds = new Set((c.replies || []).map(r => r.id));
            const newReplies = data.replies.filter((r: Comment) => !existingIds.has(r.id));
            return {
              ...c,
              replies: [...(c.replies || []), ...newReplies],
            };
          }
          return c;
        }));
      }
    } catch (err) {
      console.error('Failed to fetch more replies:', err);
      toast.error('Failed to load more replies');
    } finally {
      setLoadingReplies(prev => {
        const next = new Set(prev);
        next.delete(parentCommentId);
        return next;
      });
    }
  };

  // Infinite scroll: observe sentinel at bottom of comments list
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const container = commentsContainerRef.current;
    if (!sentinel || !container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loading) {
          loadMore();
        }
      },
      { root: container, rootMargin: '200px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, loading, page]);

  // Use portal to render outside of any z-index stacking context
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const content = (
    <>
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="comments-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/60 z-[100] md:bg-transparent md:pointer-events-none"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Comments Panel */}
          <motion.div
            ref={modalRef}
            key="comments-panel"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 md:left-auto md:bottom-auto md:top-1/2 md:right-24 md:-translate-y-1/2 md:w-[400px] md:max-h-[600px] z-[100] bg-[#1a1a1a] rounded-t-3xl md:rounded-2xl overflow-hidden flex flex-col max-h-[80vh]"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="comments-modal-title"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <MessageCircle className="w-5 h-5" aria-hidden="true" />
                <span id="comments-modal-title" className="font-bold">{total} Comments</span>
              </div>
              <button
                ref={closeButtonRef}
                onClick={onClose}
                className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 focus:ring-offset-[#1a1a1a]"
                aria-label="Close comments"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            {/* Comments List */}
            <div
              ref={commentsContainerRef}
              className="flex-1 overflow-y-auto px-4 py-3 space-y-4"
            >
              {loading && comments.length === 0 ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-white/60" />
                </div>
              ) : comments.length === 0 ? (
                <div className="text-center py-12 text-white/50">
                  <MessageCircle className="w-12 h-12 mx-auto mb-3 text-white/60" />
                  <p>No comments yet</p>
                  <p className="text-sm">Be the first to comment!</p>
                </div>
              ) : (
                <>
                  {comments.filter(c => c.id).map((comment) => (
                    <CommentItem
                      key={comment.id}
                      comment={comment}
                      onLike={() => handleLike(comment)}
                      onReply={() => handleReply(comment)}
                      onDelete={() => handleDelete(comment)}
                      onReport={() => setReportComment(comment)}
                      isExpanded={expandedReplies.has(comment.id)}
                      onToggleReplies={() => toggleReplies(comment.id)}
                      onLikeReply={(reply) => handleLike(reply)}
                      onReplyToReply={(reply) => handleReply(reply)}
                      onDeleteReply={(reply) => handleDelete(reply)}
                      onReportReply={(reply) => setReportComment(reply)}
                      onLoadMoreReplies={() => fetchMoreReplies(comment.id)}
                      isLoadingMoreReplies={loadingReplies.has(comment.id)}
                    />
                  ))}

                  {/* Infinite scroll sentinel */}
                  {hasMore && <div ref={sentinelRef} className="h-1" aria-hidden="true" />}

                  {/* Loading indicator for infinite scroll */}
                  {hasMore && loading && (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="w-5 h-5 animate-spin text-white/60" />
                    </div>
                  )}

                  {/* Manual load more (screen reader fallback) */}
                  {hasMore && !loading && (
                    <button
                      onClick={loadMore}
                      className="sr-only focus:not-sr-only w-full py-3 mt-2 text-sm font-medium text-cyan-400"
                    >
                      Load more comments ({total - comments.length} remaining)
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Reply indicator */}
            {replyingTo && (
              <div className="px-4 py-2 bg-white/5 border-t border-white/10 flex items-center justify-between">
                <span className="text-sm text-white/60">
                  Replying to <span className="text-cyan-400">@{replyingTo.username}</span>
                </span>
                <button onClick={() => { setReplyingTo(null); setNewComment(''); }} className="text-white/60 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Emoji Picker */}
            <AnimatePresence>
              {showEmojis && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="px-4 py-2 bg-white/5 border-t border-white/10 flex gap-2 overflow-x-auto"
                >
                  {EMOJIS.map(({ emoji, label }) => (
                    <button
                      key={emoji}
                      onClick={() => addEmoji(emoji)}
                      className="text-2xl hover:scale-125 transition-transform"
                      aria-label={`Add ${label} emoji`}
                      title={label}
                    >
                      {emoji}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Input - pb-20 adds space for bottom navigation on mobile */}
            <div className="p-4 pb-20 md:pb-4 border-t border-white/10 bg-[#1a1a1a]">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowEmojis(!showEmojis)}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition ${showEmojis ? 'bg-white/20' : 'hover:bg-white/10'}`}
                >
                  <Smile className="w-5 h-5" />
                </button>

                <input
                  ref={inputRef}
                  type="text"
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handlePostComment();
                    }
                    // Prevent space from bubbling up and triggering button clicks
                    e.stopPropagation();
                  }}
                  placeholder={replyingTo ? `Reply to @${replyingTo.username}...` : 'Add a comment...'}
                  maxLength={500}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck="false"
                  className="flex-1 bg-white/10 border border-white/20 rounded-full px-4 py-2 text-sm placeholder:text-white/60 focus:outline-none focus:ring-0"
                />

                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={handlePostComment}
                  disabled={!newComment.trim() || posting}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition ${
                    newComment.trim() && !posting
                      ? 'bg-gradient-to-r from-cyan-500 to-purple-500'
                      : 'bg-white/10 text-white/60'
                  }`}
                >
                  {posting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                </motion.button>
              </div>

              {/* Character count */}
              {newComment.length > 400 && (
                <div className="text-right text-xs text-white/60 mt-1">
                  {newComment.length}/500
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>

    {/* Report Modal - z-[200] wrapper to appear above comments panel (z-[100]) */}
    <div className="relative z-[200]">
      <ReportModal
        isOpen={!!reportComment}
        onClose={() => setReportComment(null)}
        type="comment"
        targetId={reportComment?.id || ''}
        targetName={reportComment?.comment_text?.slice(0, 50)}
      />
    </div>
    </>
  );

  // Render via portal to escape any z-index stacking context
  if (!mounted) return null;
  return createPortal(content, document.body);
}

// Memoize to prevent re-renders from parent component's currentTime updates
const CommentsSection = memo(CommentsSectionComponent);
export default CommentsSection;

// ============================================================================
// COMMENT ITEM COMPONENT
// ============================================================================

interface CommentItemProps {
  comment: Comment;
  onLike: () => void;
  onReply: () => void;
  onDelete: () => void;
  onReport: () => void;
  isExpanded: boolean;
  onToggleReplies: () => void;
  onLikeReply: (reply: Comment) => void;
  onReplyToReply: (reply: Comment) => void;
  onDeleteReply: (reply: Comment) => void;
  onReportReply: (reply: Comment) => void;
  onLoadMoreReplies?: () => void;
  isLoadingMoreReplies?: boolean;
  isReply?: boolean;
}

function CommentItem({
  comment,
  onLike,
  onReply,
  onDelete,
  onReport,
  isExpanded,
  onToggleReplies,
  onLikeReply,
  onReplyToReply,
  onDeleteReply,
  onReportReply,
  onLoadMoreReplies,
  isLoadingMoreReplies,
  isReply = false,
}: CommentItemProps) {
  const [showMenu, setShowMenu] = useState(false);
  
  const replies = comment.replies || [];
  const hasReplies = replies.length > 0;

  return (
    <div className={`${isReply ? 'ml-10 mt-3' : ''}`}>
      <div className="flex gap-3">
        {/* Avatar */}
        <Image
          src={comment.avatar_url}
          alt={comment.username}
          width={isReply ? 32 : 40}
          height={isReply ? 32 : 40}
          className={`rounded-full bg-white/10 flex-shrink-0 ${isReply ? 'w-8 h-8' : 'w-10 h-10'}`}
          unoptimized={comment.avatar_url?.includes('dicebear')}
        />

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <span className={`font-bold ${isReply ? 'text-sm' : ''}`}>
                @{comment.username}
              </span>
              <span className="text-white/60 text-xs ml-2">
                {timeAgo(comment.created_at)}
              </span>
              {comment.is_own && (
                <span className="text-cyan-400 text-xs ml-2">• You</span>
              )}
            </div>

            {/* Menu */}
            <div className="relative">
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="w-6 h-6 rounded-full hover:bg-white/10 flex items-center justify-center"
              >
                <MoreHorizontal className="w-4 h-4 text-white/60" />
              </button>

              <AnimatePresence>
                {showMenu && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="absolute right-0 top-8 bg-[#2a2a2a] rounded-lg shadow-lg overflow-hidden z-10 min-w-[120px]"
                  >
                    {comment.is_own ? (
                      <button
                        onClick={() => { onDelete(); setShowMenu(false); }}
                        className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-white/10 flex items-center gap-2"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete
                      </button>
                    ) : (
                      <button
                        onClick={() => { onReport(); setShowMenu(false); }}
                        className="w-full px-4 py-2 text-left text-sm text-white/70 hover:bg-white/10 flex items-center gap-2"
                      >
                        <Flag className="w-4 h-4" />
                        Report
                      </button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Comment Text */}
          <p className={`text-white/90 mt-1 break-words ${isReply ? 'text-sm' : ''}`}>
            {comment.comment_text}
          </p>

          {/* Actions */}
          <div className="flex items-center gap-4 mt-2">
            {/* Like */}
            <button
              onClick={onLike}
              className="flex items-center gap-1 text-xs text-white/50 hover:text-white transition"
            >
              <Heart
                className={`w-4 h-4 ${comment.is_liked ? 'text-pink-500 fill-pink-500' : ''}`}
              />
              {comment.likes_count > 0 && (
                <span className={comment.is_liked ? 'text-pink-500' : ''}>
                  {comment.likes_count}
                </span>
              )}
            </button>

            {/* Reply */}
            {!isReply && (
              <button
                onClick={onReply}
                className="flex items-center gap-1 text-xs text-white/50 hover:text-white transition"
              >
                <Reply className="w-4 h-4" />
                Reply
              </button>
            )}
          </div>

          {/* Replies Toggle */}
          {!isReply && hasReplies && (
            <button
              onClick={onToggleReplies}
              className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 mt-2"
            >
              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              {isExpanded ? 'Hide' : 'View'} {comment.total_replies || replies.length} {(comment.total_replies || replies.length) === 1 ? 'reply' : 'replies'}
            </button>
          )}

          {/* Replies List */}
          <AnimatePresence>
            {!isReply && isExpanded && hasReplies && (
              <motion.div
                key={`replies-${comment.id}`}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-2"
              >
                {replies.filter(r => r.id).map((reply) => (
                  <CommentItem
                    key={reply.id}
                    comment={reply}
                    onLike={() => onLikeReply(reply)}
                    onReply={() => onReplyToReply(reply)}
                    onDelete={() => onDeleteReply(reply)}
                    onReport={() => onReportReply(reply)}
                    isExpanded={false}
                    onToggleReplies={() => {}}
                    onLikeReply={() => {}}
                    onReplyToReply={() => {}}
                    onDeleteReply={() => {}}
                    onReportReply={() => {}}
                    isReply
                  />
                ))}

                {/* Load more replies */}
                {(comment.total_replies || 0) > replies.length && (
                  <button
                    onClick={onLoadMoreReplies}
                    disabled={isLoadingMoreReplies}
                    className="ml-10 mt-2 flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 disabled:opacity-50"
                  >
                    {isLoadingMoreReplies ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-3 h-3" />
                        View {(comment.total_replies || 0) - replies.length} more {(comment.total_replies || 0) - replies.length === 1 ? 'reply' : 'replies'}
                      </>
                    )}
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
