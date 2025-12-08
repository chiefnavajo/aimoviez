'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { motion } from 'framer-motion';
import Image from 'next/image';
import { User, Sparkles, ArrowRight, Check, AlertCircle } from 'lucide-react';

export default function OnboardingPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);

  // Redirect if not authenticated
  if (status === 'unauthenticated') {
    router.push('/');
    return null;
  }

  // Show loading while checking session
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#050510] via-[#0a0a18] to-[#050510] flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-white/60 text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  const validateUsername = (value: string) => {
    if (value.length < 3) {
      return 'Username must be at least 3 characters';
    }
    if (value.length > 20) {
      return 'Username must be 20 characters or less';
    }
    if (!/^[a-z0-9_]+$/.test(value)) {
      return 'Only lowercase letters, numbers, and underscores allowed';
    }
    return null;
  };

  const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
    setUsername(value);
    setUsernameError(validateUsername(value));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validationError = validateUsername(username);
    if (validationError) {
      setUsernameError(validationError);
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/user/create-profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username,
          display_name: displayName || username,
          bio: bio || null,
          avatar_url: session?.user?.image || `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 409) {
          // Profile already exists - redirect to dashboard
          router.push('/dashboard');
          return;
        }
        throw new Error(data.error || 'Failed to create profile');
      }

      // Store profile in localStorage for quick access
      if (data.user) {
        localStorage.setItem('user_profile', JSON.stringify(data.user));
        localStorage.setItem('username', data.user.username);
      }

      // Redirect to dashboard
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const avatarUrl = session?.user?.image || `https://api.dicebear.com/7.x/avataaars/svg?seed=${username || 'default'}`;

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#050510] via-[#0a0a18] to-[#050510] flex items-center justify-center p-4">
      {/* Background effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 w-full max-w-md"
      >
        {/* Header */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-cyan-500/20 to-purple-500/20 rounded-full border border-cyan-500/30 mb-4"
          >
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <span className="text-sm font-medium text-cyan-400">Welcome to AiMoviez!</span>
          </motion.div>
          <h1 className="text-3xl font-black text-white mb-2">Create Your Profile</h1>
          <p className="text-white/60">Choose a unique username to get started</p>
        </div>

        {/* Form Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3 }}
          className="bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 p-6 space-y-6"
        >
          {/* Avatar Preview */}
          <div className="flex justify-center">
            <div className="relative">
              <div className="w-24 h-24 rounded-full overflow-hidden border-4 border-cyan-500/50 bg-white/10">
                <Image
                  src={avatarUrl}
                  alt="Your avatar"
                  width={96}
                  height={96}
                  className="w-full h-full object-cover"
                  unoptimized={avatarUrl?.includes('dicebear')}
                />
              </div>
              <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-gradient-to-r from-cyan-500 to-purple-500 rounded-full flex items-center justify-center">
                <User className="w-4 h-4 text-white" />
              </div>
            </div>
          </div>

          {/* Email Display */}
          <div className="text-center">
            <p className="text-sm text-white/40">Signed in as</p>
            <p className="text-white font-medium">{session?.user?.email}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username Input */}
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-white/80 mb-2">
                Username <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40">@</span>
                <input
                  type="text"
                  id="username"
                  value={username}
                  onChange={handleUsernameChange}
                  placeholder="your_username"
                  maxLength={20}
                  className={`w-full pl-8 pr-10 py-3 bg-white/5 border rounded-xl text-white placeholder-white/30 focus:outline-none focus:ring-2 transition-all ${
                    usernameError
                      ? 'border-red-500/50 focus:ring-red-500/50'
                      : username.length >= 3
                      ? 'border-green-500/50 focus:ring-green-500/50'
                      : 'border-white/10 focus:ring-cyan-500/50'
                  }`}
                />
                {username.length >= 3 && !usernameError && (
                  <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-green-500" />
                )}
              </div>
              {usernameError && (
                <p className="mt-1 text-sm text-red-400 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  {usernameError}
                </p>
              )}
              <p className="mt-1 text-xs text-white/40">
                3-20 characters, lowercase letters, numbers, and underscores only
              </p>
            </div>

            {/* Display Name Input (Optional) */}
            <div>
              <label htmlFor="displayName" className="block text-sm font-medium text-white/80 mb-2">
                Display Name <span className="text-white/40">(optional)</span>
              </label>
              <input
                type="text"
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={username || 'Your display name'}
                maxLength={50}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 transition-all"
              />
            </div>

            {/* Bio Input (Optional) */}
            <div>
              <label htmlFor="bio" className="block text-sm font-medium text-white/80 mb-2">
                Bio <span className="text-white/40">(optional)</span>
              </label>
              <textarea
                id="bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell us about yourself..."
                maxLength={200}
                rows={3}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 transition-all resize-none"
              />
              <p className="mt-1 text-xs text-white/40 text-right">{bio.length}/200</p>
            </div>

            {/* Error Message */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 bg-red-500/20 border border-red-500/30 rounded-xl text-red-400 text-sm flex items-center gap-2"
              >
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </motion.div>
            )}

            {/* Submit Button */}
            <motion.button
              type="submit"
              disabled={isSubmitting || !username || !!usernameError}
              whileTap={{ scale: 0.98 }}
              className={`w-full py-4 rounded-xl font-bold text-white flex items-center justify-center gap-2 transition-all ${
                isSubmitting || !username || !!usernameError
                  ? 'bg-white/10 cursor-not-allowed'
                  : 'bg-gradient-to-r from-cyan-500 to-purple-500 hover:from-cyan-600 hover:to-purple-600 shadow-lg shadow-cyan-500/25'
              }`}
            >
              {isSubmitting ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Creating Profile...
                </>
              ) : (
                <>
                  Continue
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </motion.button>
          </form>
        </motion.div>

        {/* Footer */}
        <p className="text-center text-white/40 text-xs mt-6">
          By creating a profile, you agree to our Terms of Service and Privacy Policy
        </p>
      </motion.div>
    </div>
  );
}
