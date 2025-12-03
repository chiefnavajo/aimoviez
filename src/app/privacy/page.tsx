'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { motion } from 'framer-motion';

export default function PrivacyPolicy() {
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
            <h1 className="text-xl font-bold">Privacy Policy</h1>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="prose prose-invert prose-sm max-w-none">
          <p className="text-white/60 mb-8">Last updated: December 3, 2024</p>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">1. Introduction</h2>
            <p className="text-white/80 leading-relaxed">
              AiMoviez ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy
              explains how we collect, use, disclose, and safeguard your information when you use our service.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">2. Information We Collect</h2>

            <h3 className="text-lg font-semibold mb-2 mt-4">2.1 Information You Provide</h3>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>Account information (name, email) from Google Sign-In</li>
              <li>Profile information (username, avatar)</li>
              <li>Content you upload (videos, comments)</li>
              <li>Communications with us</li>
            </ul>

            <h3 className="text-lg font-semibold mb-2 mt-4">2.2 Information Collected Automatically</h3>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>Device information (browser type, operating system)</li>
              <li>Usage data (pages visited, features used, voting activity)</li>
              <li>IP address and approximate location</li>
              <li>Cookies and similar technologies</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">3. How We Use Your Information</h2>
            <p className="text-white/80 leading-relaxed">We use collected information to:</p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4 mt-2">
              <li>Provide and maintain the Service</li>
              <li>Process your uploads and votes</li>
              <li>Display leaderboards and statistics</li>
              <li>Send notifications (with your consent)</li>
              <li>Prevent fraud and abuse</li>
              <li>Improve and personalize the Service</li>
              <li>Comply with legal obligations</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">4. Cookies and Tracking</h2>
            <p className="text-white/80 leading-relaxed mb-4">
              We use cookies and similar technologies to:
            </p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li><strong>Essential cookies:</strong> Required for the Service to function (authentication, security)</li>
              <li><strong>Functional cookies:</strong> Remember your preferences and settings</li>
              <li><strong>Analytics cookies:</strong> Help us understand how users interact with the Service</li>
            </ul>
            <p className="text-white/80 leading-relaxed mt-4">
              You can manage cookie preferences through our cookie consent banner or your browser settings.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">5. Data Sharing</h2>
            <p className="text-white/80 leading-relaxed mb-4">
              We do not sell your personal information. We may share data with:
            </p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li><strong>Service providers:</strong> Hosting, analytics, and infrastructure partners</li>
              <li><strong>Legal requirements:</strong> When required by law or to protect our rights</li>
              <li><strong>Business transfers:</strong> In connection with a merger or acquisition</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">6. Your Rights (GDPR)</h2>
            <p className="text-white/80 leading-relaxed mb-4">
              If you are in the European Economic Area (EEA), you have the following rights:
            </p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li><strong>Access:</strong> Request a copy of your personal data</li>
              <li><strong>Rectification:</strong> Correct inaccurate data</li>
              <li><strong>Erasure:</strong> Request deletion of your data ("right to be forgotten")</li>
              <li><strong>Portability:</strong> Export your data in a machine-readable format</li>
              <li><strong>Restriction:</strong> Limit how we use your data</li>
              <li><strong>Objection:</strong> Object to certain processing activities</li>
              <li><strong>Withdraw consent:</strong> Withdraw consent at any time</li>
            </ul>
            <p className="text-white/80 leading-relaxed mt-4">
              To exercise these rights, visit your{' '}
              <Link href="/profile" className="text-cyan-400 hover:underline">profile settings</Link>{' '}
              or contact us at{' '}
              <a href="mailto:privacy@aimoviez.com" className="text-cyan-400 hover:underline">
                privacy@aimoviez.com
              </a>
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">7. Data Retention</h2>
            <p className="text-white/80 leading-relaxed">
              We retain your data for as long as your account is active or as needed to provide the Service.
              You can delete your account at any time, which will remove your personal data within 30 days,
              except where we are required to retain it for legal purposes.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">8. Data Security</h2>
            <p className="text-white/80 leading-relaxed">
              We implement appropriate technical and organizational measures to protect your data, including
              encryption, secure servers, and access controls. However, no method of transmission over the
              Internet is 100% secure.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">9. Children's Privacy</h2>
            <p className="text-white/80 leading-relaxed">
              The Service is not intended for children under 13. We do not knowingly collect personal
              information from children under 13. If you believe a child has provided us with personal
              information, please contact us.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">10. International Transfers</h2>
            <p className="text-white/80 leading-relaxed">
              Your data may be transferred to and processed in countries outside your own. We ensure
              appropriate safeguards are in place for such transfers in compliance with applicable laws.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">11. Changes to This Policy</h2>
            <p className="text-white/80 leading-relaxed">
              We may update this Privacy Policy from time to time. We will notify you of significant changes
              by posting a notice on the Service or sending you an email.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">12. Contact Us</h2>
            <p className="text-white/80 leading-relaxed">
              For questions about this Privacy Policy or to exercise your rights, contact us at:
            </p>
            <ul className="list-none text-white/80 space-y-1 mt-2">
              <li>Email: <a href="mailto:privacy@aimoviez.com" className="text-cyan-400 hover:underline">privacy@aimoviez.com</a></li>
            </ul>
          </section>
        </div>
      </main>
    </div>
  );
}
