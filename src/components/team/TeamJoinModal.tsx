// components/team/TeamJoinModal.tsx
// Modal for joining a team via invite code

'use client';

import { useState } from 'react';
import { X, UserPlus, Loader2 } from 'lucide-react';
import { useJoinTeam } from '@/hooks/useTeam';

interface TeamJoinModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  initialCode?: string;
}

export function TeamJoinModal({
  isOpen,
  onClose,
  onSuccess,
  initialCode = '',
}: TeamJoinModalProps) {
  const [code, setCode] = useState(initialCode);
  const [error, setError] = useState<string | null>(null);

  const joinMutation = useJoinTeam();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedCode = code.trim().toUpperCase().replace(/\s/g, '');
    if (trimmedCode.length < 6 || trimmedCode.length > 12) {
      setError('Invalid invite code format');
      return;
    }

    try {
      await joinMutation.mutateAsync(trimmedCode);
      onSuccess?.();
      onClose();
      setCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join team');
    }
  };

  // Format code for display (add spaces every 4 characters)
  const formatCode = (value: string) => {
    const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return cleaned.slice(0, 12);
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
      <div className="relative w-full max-w-md bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <UserPlus className="text-green-400" size={20} />
            <h2 className="text-lg font-semibold text-white">Join a Team</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X size={20} className="text-gray-400" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Invite Code
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(formatCode(e.target.value))}
              placeholder="Enter invite code..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-4 text-white text-center text-xl font-mono tracking-widest placeholder-gray-500 focus:outline-none focus:border-purple-500 transition-colors uppercase"
            />
            <p className="text-center text-xs text-gray-500 mt-2">
              Ask a team member for their invite code
            </p>
          </div>

          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
            <h4 className="font-medium text-blue-400 mb-2">Before Joining</h4>
            <ul className="text-sm text-gray-300 space-y-1">
              <li>- You can only be in one team at a time</li>
              <li>- Teams are limited to 5 members</li>
              <li>- Your activity contributes to team streaks</li>
            </ul>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 px-4 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={joinMutation.isPending || !code.trim()}
              className="flex-1 py-3 px-4 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
            >
              {joinMutation.isPending ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Joining...
                </>
              ) : (
                'Join Team'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
