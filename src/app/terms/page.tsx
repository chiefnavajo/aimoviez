'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { motion } from 'framer-motion';

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-black/80 backdrop-blur-lg border-b border-white/10">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Link href="/dashboard">
              <motion.button
                whileTap={{ scale: 0.95 }}
                className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
                aria-label="Go back"
              >
                <ArrowLeft className="w-5 h-5" />
              </motion.button>
            </Link>
            <h1 className="text-xl font-bold">Terms of Service</h1>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="prose prose-invert prose-sm max-w-none">
          <p className="text-white/60 mb-8">Last updated: December 3, 2024</p>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">1. Acceptance of Terms</h2>
            <p className="text-white/80 leading-relaxed">
              By accessing or using AiMoviez ("the Service"), you agree to be bound by these Terms of Service.
              If you do not agree to these terms, please do not use the Service.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">2. Description of Service</h2>
            <p className="text-white/80 leading-relaxed">
              AiMoviez is a platform that allows users to upload, share, and vote on short video clips.
              The Service includes features such as video tournaments, leaderboards, and social interactions.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">3. User Accounts</h2>
            <p className="text-white/80 leading-relaxed mb-4">
              To use certain features of the Service, you must create an account using Google Sign-In. You agree to:
            </p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>Provide accurate and complete information</li>
              <li>Maintain the security of your account</li>
              <li>Accept responsibility for all activities under your account</li>
              <li>Notify us immediately of any unauthorized use</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">4. User Content</h2>
            <p className="text-white/80 leading-relaxed mb-4">
              You retain ownership of content you upload. By uploading content, you grant us a non-exclusive,
              worldwide, royalty-free license to use, display, and distribute your content on the Service.
            </p>
            <p className="text-white/80 leading-relaxed">You agree not to upload content that:</p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4 mt-2">
              <li>Violates any laws or regulations</li>
              <li>Infringes on intellectual property rights</li>
              <li>Contains harmful, offensive, or inappropriate material</li>
              <li>Includes personal information of others without consent</li>
              <li>Contains malware or harmful code</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">5. Prohibited Activities</h2>
            <p className="text-white/80 leading-relaxed">You may not:</p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4 mt-2">
              <li>Manipulate votes or gaming systems</li>
              <li>Create multiple accounts to gain unfair advantages</li>
              <li>Harass, abuse, or harm other users</li>
              <li>Attempt to access unauthorized areas of the Service</li>
              <li>Use automated systems to interact with the Service</li>
              <li>Reverse engineer or copy the Service</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">6. Intellectual Property</h2>
            <p className="text-white/80 leading-relaxed">
              The Service and its original content (excluding user content) are owned by AiMoviez and are
              protected by copyright, trademark, and other intellectual property laws.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">7. Termination</h2>
            <p className="text-white/80 leading-relaxed">
              We reserve the right to suspend or terminate your account at any time for violations of these
              Terms or for any other reason at our discretion. You may also delete your account at any time
              through your profile settings.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">8. Disclaimers</h2>
            <p className="text-white/80 leading-relaxed">
              THE SERVICE IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND. WE DO NOT GUARANTEE THAT THE
              SERVICE WILL BE UNINTERRUPTED, SECURE, OR ERROR-FREE.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">9. Limitation of Liability</h2>
            <p className="text-white/80 leading-relaxed">
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, AIMOVIEZ SHALL NOT BE LIABLE FOR ANY INDIRECT,
              INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES ARISING FROM YOUR USE OF THE SERVICE.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">10. Changes to Terms</h2>
            <p className="text-white/80 leading-relaxed">
              We may modify these Terms at any time. We will notify users of significant changes.
              Continued use of the Service after changes constitutes acceptance of the new Terms.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">11. Contact</h2>
            <p className="text-white/80 leading-relaxed">
              For questions about these Terms, please contact us at{' '}
              <a href="mailto:support@aimoviez.com" className="text-cyan-400 hover:underline">
                support@aimoviez.com
              </a>
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
