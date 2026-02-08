// components/team/TeamMemberCard.tsx
// Individual team member display card

'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { Crown, Shield, MoreVertical, UserMinus, ArrowUp, ArrowDown } from 'lucide-react';
import type { TeamMember, TeamRole } from '@/types';

interface TeamMemberCardProps {
  member: TeamMember;
  isLeader: boolean;
  canManage: boolean;
  currentUserId?: string;
  onKick?: (userId: string) => void;
  onPromote?: (userId: string, newRole: TeamRole) => void;
}

export function TeamMemberCard({
  member,
  isLeader,
  canManage,
  currentUserId,
  onKick,
  onPromote,
}: TeamMemberCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const isCurrentUser = member.user.id === currentUserId;
  const isActive =
    member.last_active_date === new Date().toISOString().split('T')[0];

  // FIX: Add keyboard support for Escape key to close menu
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape' && showMenu) {
      setShowMenu(false);
    }
  }, [showMenu]);

  useEffect(() => {
    if (showMenu) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [showMenu, handleKeyDown]);

  const roleIcons: Record<TeamRole, React.ReactNode> = {
    leader: <Crown size={14} className="text-yellow-500" />,
    officer: <Shield size={14} className="text-blue-400" />,
    member: null,
  };

  const roleColors: Record<TeamRole, string> = {
    leader: 'text-yellow-500',
    officer: 'text-blue-400',
    member: 'text-gray-400',
  };

  return (
    <div
      className={`flex items-center justify-between p-3 rounded-xl ${
        isCurrentUser ? 'bg-purple-900/30 border border-purple-500/30' : 'bg-gray-800/50'
      }`}
    >
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <div className="relative">
          <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-700">
            {member.user.avatar_url ? (
              <Image
                src={member.user.avatar_url}
                alt={member.user.username}
                width={40}
                height={40}
                className="object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-400 text-lg font-bold">
                {member.user.username[0]?.toUpperCase()}
              </div>
            )}
          </div>
          {/* Activity indicator */}
          <div
            className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-gray-900 ${
              isActive ? 'bg-green-500' : 'bg-gray-500'
            }`}
          />
        </div>

        {/* Info */}
        <div>
          <div className="flex items-center gap-1.5">
            {roleIcons[member.role]}
            <span className="font-medium text-white">{member.user.username}</span>
            {isCurrentUser && (
              <span className="text-xs text-purple-400 bg-purple-500/20 px-1.5 py-0.5 rounded">
                You
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span className={roleColors[member.role]}>
              {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
            </span>
            <span>Lvl {member.user.level}</span>
            <span>{member.contribution_xp.toLocaleString()} XP</span>
          </div>
        </div>
      </div>

      {/* Actions */}
      {canManage && !isCurrentUser && member.role !== 'leader' && (
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
          >
            <MoreVertical size={16} className="text-gray-400" />
          </button>

          {showMenu && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowMenu(false)}
              />
              <div className="absolute right-0 top-full mt-1 z-20 bg-gray-800 border border-gray-700 rounded-lg shadow-xl min-w-[160px] py-1">
                {isLeader && (
                  <>
                    {member.role === 'member' ? (
                      <button
                        onClick={() => {
                          onPromote?.(member.user.id, 'officer');
                          setShowMenu(false);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-blue-400 hover:bg-gray-700 transition-colors"
                      >
                        <ArrowUp size={14} />
                        Promote to Officer
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          onPromote?.(member.user.id, 'member');
                          setShowMenu(false);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:bg-gray-700 transition-colors"
                      >
                        <ArrowDown size={14} />
                        Demote to Member
                      </button>
                    )}
                  </>
                )}
                <button
                  onClick={() => {
                    onKick?.(member.user.id);
                    setShowMenu(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-gray-700 transition-colors"
                >
                  <UserMinus size={14} />
                  Kick from Team
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
