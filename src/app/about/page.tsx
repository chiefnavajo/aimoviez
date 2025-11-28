'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, useScroll, useTransform } from 'framer-motion';
import {
  Play, Users, Film, Trophy, Zap, Globe, Heart,
  Twitter, Instagram, Youtube, Github, ArrowRight
} from 'lucide-react';
import BottomNavigation from '@/components/BottomNavigation';

// ============================================================================
// ABOUT / LANDING PAGE
// ============================================================================
// Marketing page explaining the product, team, and vision
// ============================================================================

export default function AboutPage() {
  const router = useRouter();
  const { scrollY } = useScroll();
  const heroOpacity = useTransform(scrollY, [0, 300], [1, 0]);
  const heroScale = useTransform(scrollY, [0, 300], [1, 0.9]);

  const stats = [
    { icon: Users, value: '1M+', label: 'Active Creators' },
    { icon: Film, value: '75', label: 'Slots per Movie' },
    { icon: Trophy, value: '50M+', label: 'Votes Cast' },
    { icon: Globe, value: '150+', label: 'Countries' },
  ];

  const features = [
    {
      icon: 'ðŸŽ¬',
      title: 'Collaborative Creation',
      description: 'One million people, one movie. Every 8 seconds counts.',
    },
    {
      icon: 'ðŸ—³ï¸',
      title: 'Democratic Voting',
      description: 'The community decides. 200 votes per day, pure democracy.',
    },
    {
      icon: 'ðŸ†',
      title: 'Fair Competition',
      description: 'Best clips win. No algorithms, no favoritism, just votes.',
    },
    {
      icon: 'âš¡',
      title: 'Real-Time Updates',
      description: 'Watch rankings change live as votes pour in.',
    },
  ];

  const team = [
    { name: 'Alex Chen', role: 'Founder & CEO', avatar: 'ðŸ‘¨â€ðŸ’»' },
    { name: 'Sarah Kim', role: 'Head of Product', avatar: 'ðŸ‘©â€ðŸŽ¨' },
    { name: 'Marcus Johnson', role: 'Lead Engineer', avatar: 'ðŸ‘¨â€ðŸ’¼' },
    { name: 'Elena Rodriguez', role: 'Community Manager', avatar: 'ðŸ‘©â€ðŸ’¼' },
  ];

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
        {/* Animated Background */}
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-900/20 via-purple-900/20 to-pink-900/20" />
          <motion.div
            className="absolute top-0 left-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl"
            animate={{ x: [0, 100, 0], y: [0, 50, 0] }}
            transition={{ duration: 20, repeat: Infinity }}
          />
          <motion.div
            className="absolute bottom-0 right-0 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl"
            animate={{ x: [0, -100, 0], y: [0, -50, 0] }}
            transition={{ duration: 25, repeat: Infinity }}
          />
        </div>

        {/* Content */}
        <motion.div
          style={{ opacity: heroOpacity, scale: heroScale }}
          className="relative z-10 text-center px-4 max-w-5xl"
        >
          {/* Logo */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="mb-8"
          >
            <div className="inline-flex items-center gap-4 text-6xl md:text-8xl font-black">
              <span className="bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                AiMoviez
              </span>
            </div>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="text-4xl md:text-6xl font-black mb-6"
          >
            One Million People.
            <br />
            One Movie.
            <br />
            <span className="bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
              Your 8 Seconds Count.
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="text-xl md:text-2xl text-white/70 mb-12 max-w-3xl mx-auto"
          >
            The world's first collaborative movie platform.
            Create 8-second clips, vote for your favorites,
            and watch as 1 million creators build a 10-minute masterpiece together.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 }}
            className="flex flex-col sm:flex-row gap-4 justify-center"
          >
            <button
              onClick={() => router.push('/dashboard')}
              className="px-8 py-4 bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500 rounded-2xl text-white font-bold text-lg shadow-lg shadow-purple-500/50 hover:shadow-purple-500/70 transition-all flex items-center justify-center gap-2"
            >
              <Play className="w-6 h-6" />
              Start Voting
              <ArrowRight className="w-6 h-6" />
            </button>
            <button
              onClick={() => router.push('/upload')}
              className="px-8 py-4 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-2xl text-white font-bold text-lg border border-white/20 transition-all"
            >
              Upload Your Clip
            </button>
          </motion.div>

          {/* Scroll Indicator */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.2 }}
            className="mt-20"
          >
            <motion.div
              animate={{ y: [0, 10, 0] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="text-white/40 text-sm"
            >
              Scroll to learn more
              <div className="w-px h-12 bg-gradient-to-b from-white/40 to-transparent mx-auto mt-2" />
            </motion.div>
          </motion.div>
        </motion.div>
      </section>

      {/* Stats Section */}
      <section className="py-20 border-y border-white/10 bg-white/5">
        <div className="max-w-6xl mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat, idx) => {
              const Icon = stat.icon;
              return (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.1 }}
                  viewport={{ once: true }}
                  className="text-center"
                >
                  <Icon className="w-12 h-12 text-cyan-500 mx-auto mb-4" />
                  <div className="text-4xl font-black mb-2 bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
                    {stat.value}
                  </div>
                  <div className="text-white/60">{stat.label}</div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-4xl font-black text-center mb-12">How It Works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                step: '01',
                title: 'Create',
                description: 'Upload your 8-second vertical video. Choose your slot, genre, and submit.',
                icon: 'ðŸŽ¬',
              },
              {
                step: '02',
                title: 'Vote',
                description: 'Swipe through clips and vote for your favorites. 200 votes per day.',
                icon: 'ðŸ—³ï¸',
              },
              {
                step: '03',
                title: 'Win',
                description: 'Most-voted clips lock into the final movie. Your creation lives forever.',
                icon: 'ðŸ†',
              },
            ].map((item, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.2 }}
                viewport={{ once: true }}
                className="relative p-8 bg-white/5 rounded-2xl border border-white/10 hover:bg-white/10 transition-all"
              >
                <div className="text-6xl mb-4">{item.icon}</div>
                <div className="text-sm text-white/40 font-bold mb-2">{item.step}</div>
                <h3 className="text-2xl font-bold mb-3">{item.title}</h3>
                <p className="text-white/70">{item.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 bg-white/5">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-4xl font-black text-center mb-12">Why AiMoviez?</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {features.map((feature, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.1 }}
                viewport={{ once: true }}
                className="flex gap-4 p-6 bg-black/50 rounded-xl border border-white/10"
              >
                <div className="text-4xl">{feature.icon}</div>
                <div>
                  <h3 className="text-xl font-bold mb-2">{feature.title}</h3>
                  <p className="text-white/70">{feature.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Team */}
      <section className="py-20">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-4xl font-black text-center mb-12">Meet the Team</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {team.map((member, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                transition={{ delay: idx * 0.1 }}
                viewport={{ once: true }}
                className="text-center"
              >
                <div className="w-32 h-32 mx-auto mb-4 text-6xl flex items-center justify-center bg-gradient-to-r from-cyan-500/20 to-purple-500/20 rounded-full border-2 border-white/10">
                  {member.avatar}
                </div>
                <div className="font-bold">{member.name}</div>
                <div className="text-sm text-white/60">{member.role}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-gradient-to-r from-cyan-500/10 to-purple-500/10 border-y border-cyan-500/30">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-4xl md:text-5xl font-black mb-6">
            Ready to Make History?
          </h2>
          <p className="text-xl text-white/70 mb-8">
            Join 1 million creators building the world's first collaborative movie.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button
              onClick={() => router.push('/dashboard')}
              className="px-8 py-4 bg-gradient-to-r from-cyan-500 to-purple-500 rounded-2xl text-white font-bold text-lg shadow-lg shadow-purple-500/50 hover:shadow-purple-500/70 transition-all"
            >
              Start Voting Now
            </button>
            <button
              onClick={() => router.push('/upload')}
              className="px-8 py-4 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-2xl text-white font-bold text-lg border border-white/20 transition-all"
            >
              Upload Your First Clip
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-white/10">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="text-center md:text-left">
              <div className="text-2xl font-black mb-2">AiMoviez</div>
              <div className="text-white/60 text-sm">
                Â© 2025 AiMoviez. All rights reserved.
              </div>
            </div>

            <div className="flex gap-4">
              {[
                { icon: Twitter, href: '#' },
                { icon: Instagram, href: '#' },
                { icon: Youtube, href: '#' },
                { icon: Github, href: '#' },
              ].map((social, idx) => {
                const Icon = social.icon;
                return (
                  <a
                    key={idx}
                    href={social.href}
                    className="w-12 h-12 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center transition-all"
                  >
                    <Icon className="w-5 h-5" />
                  </a>
                );
              })}
            </div>
          </div>

          <div className="mt-8 flex flex-wrap justify-center gap-6 text-sm text-white/60">
            <a href="#" className="hover:text-white/80">Privacy Policy</a>
            <a href="#" className="hover:text-white/80">Terms of Service</a>
            <a href="#" className="hover:text-white/80">Community Guidelines</a>
            <a href="/help" className="hover:text-white/80">Help</a>
            <a href="#" className="hover:text-white/80">Contact</a>
          </div>
        </div>
      </footer>

      <BottomNavigation />
    </div>
  );
}
