// components/team/TeamInviteModal.tsx
// Modal for generating and sharing team invite links

'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Link2, Copy, Check, Share2, Loader2, Trash2 } from 'lucide-react';
import { useTeamInvites, useCreateInvite, useRevokeInvite } from '@/hooks/useTeam';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import type { TeamInvite } from '@/types';

interface TeamInviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  teamId: string;
  teamName: string;
  memberCount: number;
}

export function TeamInviteModal({
  isOpen,
  onClose,
  teamId,
  teamName,
  memberCount,
}: TeamInviteModalProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // FIX: Track timeout ref for cleanup on unmount
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // FIX: Add focus trap for accessibility (WCAG 2.1 compliance)
  const modalRef = useFocusTrap<HTMLDivElement>({
    isActive: isOpen,
    onEscape: onClose,
  });

  // FIX: Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const { data, isLoading } = useTeamInvites(teamId);
  const createMutation = useCreateInvite();
  const revokeMutation = useRevokeInvite();

  const invites = data?.invites || [];
  const isFull = memberCount >= 5;

  const handleCreateInvite = async () => {
    try {
      await createMutation.mutateAsync({ teamId });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create invite');
    }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    if (!confirm('Are you sure you want to revoke this invite?')) return;
    try {
      await revokeMutation.mutateAsync({ teamId, inviteId });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to revoke invite');
    }
  };

  const handleCopy = async (invite: TeamInvite) => {
    // FIX: Clear any existing timeout before setting new one
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }
    const shareLink = invite.share_link || `${window.location.origin}/team/join?code=${invite.code}`;
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopiedId(invite.id);
      copyTimeoutRef.current = setTimeout(() => setCopiedId(null), 2000);
    } catch {
      alert('Failed to copy to clipboard');
    }
  };

  const handleShare = async (invite: TeamInvite) => {
    const shareLink = invite.share_link || `${window.location.origin}/team/join?code=${invite.code}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Join ${teamName} on aimoviez`,
          text: `Join my team "${teamName}" and let's dominate the leaderboard together!`,
          url: shareLink,
        });
      } catch {
        // User cancelled or share failed
      }
    } else {
      handleCopy(invite);
    }
  };

  const formatExpiry = (expiresAt: string | null) => {
    if (!expiresAt) return 'Never expires';
    const date = new Date(expiresAt);
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    if (days > 0) return `Expires in ${days}d ${hours}h`;
    if (hours > 0) return `Expires in ${hours}h`;
    return 'Expires soon';
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        ref={modalRef}
        className="relative w-full max-w-md bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl max-h-[80vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Link2 className="text-purple-400" size={20} />
            <h2 className="text-lg font-semibold text-white">Invite Members</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X size={20} className="text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {isFull ? (
            <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-yellow-400 text-sm text-center">
              Your team is full (5/5 members). You cannot invite more members.
            </div>
          ) : (
            <>
              {/* Create new invite */}
              <button
                onClick={handleCreateInvite}
                disabled={createMutation.isPending}
                className="w-full py-3 px-4 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                {createMutation.isPending ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Link2 size={18} />
                    Generate New Invite Link
                  </>
                )}
              </button>

              {/* Existing invites */}
              {isLoading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="animate-spin text-purple-500" size={24} />
                </div>
              ) : invites.length === 0 ? (
                <div className="text-center py-6 text-gray-500 text-sm">
                  No active invites. Generate one to invite members.
                </div>
              ) : (
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-gray-400">Active Invites</h3>
                  {invites.map((invite) => (
                    <div
                      key={invite.id}
                      className="p-3 bg-gray-800/50 border border-gray-700 rounded-lg"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <code className="text-sm font-mono text-purple-400 bg-purple-500/10 px-2 py-1 rounded">
                          {invite.code}
                        </code>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleCopy(invite)}
                            className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
                            title="Copy link"
                          >
                            {copiedId === invite.id ? (
                              <Check size={16} className="text-green-400" />
                            ) : (
                              <Copy size={16} className="text-gray-400" />
                            )}
                          </button>
                          <button
                            onClick={() => handleShare(invite)}
                            className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
                            title="Share"
                          >
                            <Share2 size={16} className="text-gray-400" />
                          </button>
                          <button
                            onClick={() => handleRevokeInvite(invite.id)}
                            disabled={revokeMutation.isPending}
                            className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
                            title="Revoke"
                          >
                            <Trash2 size={16} className="text-red-400" />
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-xs text-gray-500">
                        <span>
                          Used: {invite.uses}/{invite.max_uses || '-'}
                        </span>
                        <span>{formatExpiry(invite.expires_at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Info */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3">
            <p className="text-xs text-gray-400">
              Share the invite link with friends. Each link can be used up to 5
              times and expires after 7 days.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-800">
          <button
            onClick={onClose}
            className="w-full py-3 px-4 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
