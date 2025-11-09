'use client';
import '../../public/landing.css';
import { useEffect } from 'react';
import { signIn } from 'next-auth/react';

export default function Home() {
  useEffect(() => {
    // === INTRO skip logic ===
    const overlay = document.getElementById('introOverlay');
    const mainContent = document.getElementById('mainContent');

    function skipIntro() {
      overlay.classList.add('skip');
      mainContent.style.animation = 'fadeInContent 0.3s ease forwards';
      mainContent.style.opacity = '1';
      sessionStorage.setItem('introSkipped', 'true');
    }

    if (sessionStorage.getItem('introSkipped') === 'true') skipIntro();
    window.skipIntro = skipIntro;
  }, []);

  return (
    <main>
      {/* INTRO OVERLAY */}
      <div className="intro-overlay" id="introOverlay">
        <button className="skip-intro" onClick={() => window.skipIntro()}>
          Skip →
        </button>
        <div className="scanline"></div>
        <div className="grid-overlay"></div>
        <div className="intro-logo-container">
          <div className="intro-logo-main">AiMoviez</div>
          <div className="intro-logo-separator"></div>
          <div className="intro-logo-tagline">8SEC MADNESS</div>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div className="main-content" id="mainContent">
        <section className="hero">
          <div className="cyber-grid"></div>
          <div className="glow-orb orb-1"></div>
          <div className="glow-orb orb-2"></div>
          <div className="glow-orb orb-3"></div>

          <div className="container">
            {/* LOGO */}
            <div className="logo">
              <div className="logo-main">AiMoviez</div>
              <div className="logo-separator"></div>
              <div className="logo-tagline">8SEC MADNESS</div>
            </div>

            {/* HEADLINE */}
            <div className="headline">
              <h1>
                <span className="highlight">75 creators</span>. 8 secs. 1 film.
              </h1>
              <p>let&apos;s make history.</p>
            </div>

            {/* SIGNUP CARD */}
            <div className="signup">
              <h2>join beta</h2>

              <div className="social-proof">
                <div className="avatar-stack">
                  <div className="avatar">🎬</div>
                  <div className="avatar">🎭</div>
                  <div className="avatar">🎥</div>
                </div>
                <div className="social-proof-text">
                  <strong>127</strong> creators joined
                </div>
              </div>

              <p className="signup-subtitle">limited spots. move fast.</p>

              <div className="trending-badges">
                <span className="badge pulse">🔥 Trending</span>
                <span className="badge pink">⚡ 247 joined today</span>
              </div>

              {/* ✅ Usunięto formularz Name/Email i dzielnik "or".
                  Zostaje wyłącznie logowanie Google. */}
              <button
                className="google-btn"
                onClick={() => signIn('google', { callbackUrl: '/dashboard' })}
              >
                <svg className="google-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                Google
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
