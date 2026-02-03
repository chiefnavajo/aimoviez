// app/team/join/page.tsx
// Handle team invite links with code in URL

'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Users, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { AuthGuard } from '@/hooks/useAuth';
import { useJoinTeam, useUserTeam } from '@/hooks/useTeam';

function JoinTeamContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const code = searchParams.get('code');

  const { data: teamData, isLoading: checkingTeam } = useUserTeam();
  const joinMutation = useJoinTeam();

  const [status, setStatus] = useState<'loading' | 'joining' | 'success' | 'error' | 'has_team'>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [teamName, setTeamName] = useState<string>('');

  useEffect(() => {
    if (checkingTeam) return;

    // Check if user already has a team
    if (teamData?.team) {
      setStatus('has_team');
      return;
    }

    // No code provided
    if (!code) {
      router.replace('/team');
      return;
    }

    // Join the team
    const joinTeam = async () => {
      setStatus('joining');
      try {
        const result = await joinMutation.mutateAsync(code);
        setTeamName(result.team?.name || 'your new team');
        setStatus('success');
        // Redirect to team page after a moment
        setTimeout(() => router.replace('/team'), 2000);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Failed to join team');
        setStatus('error');
      }
    };

    joinTeam();
  }, [code, checkingTeam, teamData, router, joinMutation]);

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {status === 'loading' || status === 'joining' ? (
          <div className="text-center">
            <div className="w-16 h-16 mx-auto bg-purple-600/20 rounded-full flex items-center justify-center mb-4">
              <Loader2 className="animate-spin text-purple-400" size={32} />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">
              {status === 'loading' ? 'Checking...' : 'Joining Team...'}
            </h2>
            <p className="text-gray-400">Please wait a moment</p>
          </div>
        ) : status === 'success' ? (
          <div className="text-center">
            <div className="w-16 h-16 mx-auto bg-green-600/20 rounded-full flex items-center justify-center mb-4">
              <CheckCircle className="text-green-400" size={32} />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Welcome!</h2>
            <p className="text-gray-400 mb-4">
              You&apos;ve successfully joined <span className="text-green-400 font-medium">{teamName}</span>
            </p>
            <p className="text-sm text-gray-500">Redirecting to your team...</p>
          </div>
        ) : status === 'has_team' ? (
          <div className="text-center">
            <div className="w-16 h-16 mx-auto bg-yellow-600/20 rounded-full flex items-center justify-center mb-4">
              <Users className="text-yellow-400" size={32} />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Already in a Team</h2>
            <p className="text-gray-400 mb-6">
              You&apos;re already a member of a team. Leave your current team first to join another.
            </p>
            <button
              onClick={() => router.push('/team')}
              className="px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-medium transition-colors"
            >
              Go to My Team
            </button>
          </div>
        ) : (
          <div className="text-center">
            <div className="w-16 h-16 mx-auto bg-red-600/20 rounded-full flex items-center justify-center mb-4">
              <XCircle className="text-red-400" size={32} />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Couldn&apos;t Join</h2>
            <p className="text-gray-400 mb-6">{errorMessage}</p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => router.push('/team')}
                className="px-6 py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg font-medium transition-colors"
              >
                Go Back
              </button>
              <button
                onClick={() => {
                  setStatus('loading');
                  setErrorMessage('');
                }}
                className="px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-medium transition-colors"
              >
                Try Again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function JoinTeamPageInner() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="animate-spin text-purple-500" size={32} />
      </div>
    }>
      <JoinTeamContent />
    </Suspense>
  );
}

export default function JoinTeamPage() {
  return (
    <AuthGuard>
      <JoinTeamPageInner />
    </AuthGuard>
  );
}
