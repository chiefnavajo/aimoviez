'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { User, Camera, Check, Loader2, Sparkles } from 'lucide-react';

// ============================================================================
// ONBOARDING PAGE - New User Profile Setup
// ============================================================================

const AVATAR_STYLES = [
  'adventurer', 'avataaars', 'big-ears', 'bottts', 'croodles',
  'fun-emoji', 'icons', 'identicon', 'lorelei', 'micah',
  'miniavs', 'open-peeps', 'personas', 'pixel-art', 'shapes'
];

const AVATAR_SEEDS = ['felix', 'luna', 'max', 'bella', 'charlie', 'milo', 'leo', 'nala', 'oscar', 'cleo', 'ruby', 'finn'];

export default function OnboardingPage() {
  const router = useRouter();
  
  const [step, setStep] = useState(1);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarStyle, setAvatarStyle] = useState('avataaars');
  const [avatarSeed, setAvatarSeed] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  // Generate random seed on mount
  useEffect(() => {
    setAvatarSeed(Math.random().toString(36).substring(7));
  }, []);

  // Check username availability
  useEffect(() => {
    if (username.length < 3) {
      setUsernameAvailable(null);
      return;
    }

    const timer = setTimeout(async () => {
      setIsChecking(true);
      try {
        const res = await fetch(`/api/user/check-username?username=${username}`);
        const data = await res.json();
        setUsernameAvailable(data.available);
      } catch {
        setUsernameAvailable(null);
      }
      setIsChecking(false);
    }, 500);

    return () => clearTimeout(timer);
  }, [username]);

  const avatarUrl = `https://api.dicebear.com/7.x/${avatarStyle}/svg?seed=${avatarSeed}`;

  const randomizeAvatar = () => {
    const randomStyle = AVATAR_STYLES[Math.floor(Math.random() * AVATAR_STYLES.length)];
    const randomSeed = AVATAR_SEEDS[Math.floor(Math.random() * AVATAR_SEEDS.length)] + Math.random().toString(36).substring(7);
    setAvatarStyle(randomStyle);
    setAvatarSeed(randomSeed);
  };

  const handleSubmit = async () => {
    if (!username || username.length < 3) {
      setError('Username must be at least 3 characters');
      return;
    }
    if (!usernameAvailable) {
      setError('Username is not available');
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      const res = await fetch('/api/user/create-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.toLowerCase().trim(),
          display_name: displayName.trim() || username,
          bio: bio.trim(),
          avatar_url: avatarUrl,
        }),
      });

      const data = await res.json();

      if (data.success) {
        // Store in localStorage for quick access
        localStorage.setItem('user_profile', JSON.stringify(data.user));
        localStorage.setItem('username', data.user.username);
        localStorage.setItem('avatar_url', data.user.avatar_url);
        router.push('/dashboard');
      } else {
        setError(data.error || 'Failed to create profile');
      }
    } catch (err) {
      setError('Something went wrong. Please try again.');
    }

    setIsSaving(false);
  };

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black bg-clip-text text-transparent bg-gradient-to-r from-[#3CF2FF] via-[#A020F0] to-[#FF00C7]">
            AiMoviez
          </h1>
          <p className="text-white/60 mt-2">Create your profile</p>
        </div>

        {/* Progress */}
        <div className="flex gap-2 mb-8">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`flex-1 h-1 rounded-full transition-all ${
                s <= step ? 'bg-gradient-to-r from-cyan-500 to-purple-500' : 'bg-white/20'
              }`}
            />
          ))}
        </div>

        {/* Step 1: Avatar */}
        {step === 1 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-6"
          >
            <h2 className="text-xl font-bold text-center">Choose your avatar</h2>
            
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <div className="w-32 h-32 rounded-full bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500 p-1">
                  <img
                    src={avatarUrl}
                    alt="Avatar"
                    className="w-full h-full rounded-full bg-black"
                  />
                </div>
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={randomizeAvatar}
                  className="absolute -bottom-2 -right-2 w-10 h-10 rounded-full bg-white/20 border border-white/20 flex items-center justify-center hover:bg-white/30"
                >
                  <Sparkles className="w-5 h-5" />
                </motion.button>
              </div>

              <p className="text-sm text-white/60">Tap ✨ to randomize</p>

              {/* Style selector */}
              <div className="flex flex-wrap gap-2 justify-center">
                {AVATAR_STYLES.slice(0, 8).map((style) => (
                  <button
                    key={style}
                    onClick={() => setAvatarStyle(style)}
                    className={`w-12 h-12 rounded-lg overflow-hidden border-2 transition ${
                      avatarStyle === style ? 'border-cyan-500' : 'border-white/10'
                    }`}
                  >
                    <img
                      src={`https://api.dicebear.com/7.x/${style}/svg?seed=${avatarSeed}`}
                      alt={style}
                      className="w-full h-full bg-white/10"
                    />
                  </button>
                ))}
              </div>
            </div>

            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => setStep(2)}
              className="w-full py-4 bg-gradient-to-r from-cyan-500 to-purple-500 rounded-xl font-bold text-lg"
            >
              Continue
            </motion.button>
          </motion.div>
        )}

        {/* Step 2: Username */}
        {step === 2 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-6"
          >
            <h2 className="text-xl font-bold text-center">Pick a username</h2>

            <div className="space-y-4">
              <div>
                <label className="text-sm text-white/60 mb-1 block">Username *</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40">@</span>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                    placeholder="your_username"
                    maxLength={20}
                    className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 pl-8 text-white placeholder:text-white/40 focus:outline-none focus:border-cyan-500"
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2">
                    {isChecking && <Loader2 className="w-5 h-5 animate-spin text-white/40" />}
                    {!isChecking && usernameAvailable === true && <Check className="w-5 h-5 text-green-500" />}
                    {!isChecking && usernameAvailable === false && <span className="text-red-500 text-sm">Taken</span>}
                  </div>
                </div>
                <p className="text-xs text-white/40 mt-1">Letters, numbers, and underscores only</p>
              </div>

              <div>
                <label className="text-sm text-white/60 mb-1 block">Display Name (optional)</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your Name"
                  maxLength={30}
                  className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder:text-white/40 focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep(1)}
                className="flex-1 py-4 bg-white/10 rounded-xl font-bold"
              >
                Back
              </button>
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={() => setStep(3)}
                disabled={!username || username.length < 3 || !usernameAvailable}
                className={`flex-1 py-4 rounded-xl font-bold ${
                  username && username.length >= 3 && usernameAvailable
                    ? 'bg-gradient-to-r from-cyan-500 to-purple-500'
                    : 'bg-white/10 text-white/40'
                }`}
              >
                Continue
              </motion.button>
            </div>
          </motion.div>
        )}

        {/* Step 3: Bio */}
        {step === 3 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-6"
          >
            <h2 className="text-xl font-bold text-center">Tell us about yourself</h2>

            <div className="flex items-center gap-4 p-4 bg-white/5 rounded-xl">
              <img src={avatarUrl} alt="Avatar" className="w-16 h-16 rounded-full" />
              <div>
                <p className="font-bold">{displayName || username}</p>
                <p className="text-white/60">@{username}</p>
              </div>
            </div>

            <div>
              <label className="text-sm text-white/60 mb-1 block">Bio (optional)</label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell the community about yourself..."
                maxLength={150}
                rows={3}
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder:text-white/40 focus:outline-none focus:border-cyan-500 resize-none"
              />
              <p className="text-xs text-white/40 mt-1 text-right">{bio.length}/150</p>
            </div>

            {error && (
              <p className="text-red-500 text-sm text-center">{error}</p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setStep(2)}
                className="flex-1 py-4 bg-white/10 rounded-xl font-bold"
              >
                Back
              </button>
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={handleSubmit}
                disabled={isSaving}
                className="flex-1 py-4 bg-gradient-to-r from-cyan-500 to-purple-500 rounded-xl font-bold flex items-center justify-center gap-2"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Check className="w-5 h-5" />
                    Complete
                  </>
                )}
              </motion.button>
            </div>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
