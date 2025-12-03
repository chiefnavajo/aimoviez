'use client';

import { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Mail,
  MessageSquare,
  HelpCircle,
  AlertTriangle,
  Bug,
  Lightbulb,
  Send,
  Check,
  Loader2,
  ExternalLink,
} from 'lucide-react';

type ContactReason = 'general' | 'support' | 'bug' | 'feature' | 'report' | 'business';

interface ContactForm {
  reason: ContactReason;
  email: string;
  subject: string;
  message: string;
}

const CONTACT_REASONS = [
  { id: 'general' as const, label: 'General Inquiry', icon: MessageSquare },
  { id: 'support' as const, label: 'Technical Support', icon: HelpCircle },
  { id: 'bug' as const, label: 'Report a Bug', icon: Bug },
  { id: 'feature' as const, label: 'Feature Request', icon: Lightbulb },
  { id: 'report' as const, label: 'Report Content/User', icon: AlertTriangle },
  { id: 'business' as const, label: 'Business Inquiry', icon: Mail },
];

export default function ContactPage() {
  const [form, setForm] = useState<ContactForm>({
    reason: 'general',
    email: '',
    subject: '',
    message: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send message');
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    }

    setSubmitting(false);
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-black text-white">
        <div className="max-w-2xl mx-auto px-4 py-12">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center py-20"
          >
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-green-500/20 flex items-center justify-center">
              <Check className="w-10 h-10 text-green-400" />
            </div>
            <h1 className="text-3xl font-bold mb-4">Message Sent!</h1>
            <p className="text-white/60 mb-8">
              Thank you for contacting us. We'll get back to you as soon as possible.
            </p>
            <Link href="/dashboard">
              <motion.button
                whileTap={{ scale: 0.95 }}
                className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-purple-500 rounded-xl font-bold"
              >
                Back to Dashboard
              </motion.button>
            </Link>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-black/80 backdrop-blur-lg border-b border-white/10">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Link href="/dashboard">
              <motion.button
                whileTap={{ scale: 0.95 }}
                className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </motion.button>
            </Link>
            <div>
              <h1 className="text-xl font-bold">Contact & Support</h1>
              <p className="text-sm text-white/60">Get help or send us feedback</p>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Quick Links */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          <Link href="/terms">
            <motion.div
              whileHover={{ scale: 1.02 }}
              className="p-4 bg-white/5 rounded-xl border border-white/10 hover:border-white/20 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-cyan-500/20">
                  <ExternalLink className="w-4 h-4 text-cyan-400" />
                </div>
                <span className="font-medium">Terms of Service</span>
              </div>
            </motion.div>
          </Link>
          <Link href="/privacy">
            <motion.div
              whileHover={{ scale: 1.02 }}
              className="p-4 bg-white/5 rounded-xl border border-white/10 hover:border-white/20 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-500/20">
                  <ExternalLink className="w-4 h-4 text-purple-400" />
                </div>
                <span className="font-medium">Privacy Policy</span>
              </div>
            </motion.div>
          </Link>
        </div>

        {/* Contact Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Reason Selection */}
          <div>
            <label className="block text-sm font-medium text-white/90 mb-3">
              What can we help you with?
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {CONTACT_REASONS.map((reason) => {
                const Icon = reason.icon;
                const isSelected = form.reason === reason.id;
                return (
                  <motion.button
                    key={reason.id}
                    type="button"
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setForm({ ...form, reason: reason.id })}
                    className={`p-3 rounded-xl border transition-all text-left ${
                      isSelected
                        ? 'bg-cyan-500/20 border-cyan-500/50'
                        : 'bg-white/5 border-white/10 hover:border-white/20'
                    }`}
                  >
                    <Icon className={`w-5 h-5 mb-2 ${isSelected ? 'text-cyan-400' : 'text-white/60'}`} />
                    <p className={`text-sm font-medium ${isSelected ? 'text-white' : 'text-white/80'}`}>
                      {reason.label}
                    </p>
                  </motion.button>
                );
              })}
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-white/90 mb-2">
              Your Email *
            </label>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white
                       placeholder-white/40 focus:border-cyan-400 focus:outline-none transition-colors"
              placeholder="your@email.com"
            />
          </div>

          {/* Subject */}
          <div>
            <label className="block text-sm font-medium text-white/90 mb-2">
              Subject *
            </label>
            <input
              type="text"
              required
              maxLength={100}
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white
                       placeholder-white/40 focus:border-cyan-400 focus:outline-none transition-colors"
              placeholder="Brief description of your inquiry"
            />
          </div>

          {/* Message */}
          <div>
            <label className="block text-sm font-medium text-white/90 mb-2">
              Message *
            </label>
            <textarea
              required
              rows={6}
              maxLength={2000}
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white
                       placeholder-white/40 focus:border-cyan-400 focus:outline-none transition-colors resize-none"
              placeholder="Please describe your issue or question in detail..."
            />
            <p className="text-xs text-white/40 mt-1">{form.message.length}/2000</p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-4 bg-red-500/20 border border-red-500/40 rounded-xl">
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          )}

          {/* Submit Button */}
          <motion.button
            type="submit"
            disabled={submitting}
            whileTap={{ scale: 0.95 }}
            className="w-full py-4 bg-gradient-to-r from-cyan-500 to-purple-500 rounded-xl font-bold
                     flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="w-5 h-5" />
                Send Message
              </>
            )}
          </motion.button>
        </form>

        {/* FAQ Section */}
        <div className="mt-12">
          <h2 className="text-lg font-bold mb-4">Frequently Asked Questions</h2>
          <div className="space-y-4">
            <div className="p-4 bg-white/5 rounded-xl border border-white/10">
              <h3 className="font-medium mb-2">How do I upload a clip?</h3>
              <p className="text-sm text-white/60">
                Go to the Upload page from your dashboard. Select a video file (max 30 seconds),
                add a title and genre, then submit for review.
              </p>
            </div>
            <div className="p-4 bg-white/5 rounded-xl border border-white/10">
              <h3 className="font-medium mb-2">How does voting work?</h3>
              <p className="text-sm text-white/60">
                Each voting round features clips competing for a story slot. Vote for your
                favorite clips to help them win and become part of the AI-generated movie story.
              </p>
            </div>
            <div className="p-4 bg-white/5 rounded-xl border border-white/10">
              <h3 className="font-medium mb-2">How do I delete my account?</h3>
              <p className="text-sm text-white/60">
                Go to Settings from your profile, scroll down to the Danger Zone section,
                and follow the account deletion process. This action is permanent.
              </p>
            </div>
            <div className="p-4 bg-white/5 rounded-xl border border-white/10">
              <h3 className="font-medium mb-2">How do I report inappropriate content?</h3>
              <p className="text-sm text-white/60">
                Click the report button on any clip or user profile. You can also use this
                contact form with the "Report Content/User" option selected.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
