'use client';

import { createContext, useContext, useEffect, useState, useCallback, useMemo, ReactNode } from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';

type Theme = 'dark' | 'light' | 'system';

interface ThemeContextType {
  theme: Theme;
  resolvedTheme: 'dark' | 'light';
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark');
  const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    // Load saved theme from localStorage
    const saved = localStorage.getItem('theme') as Theme | null;
    if (saved) {
      setThemeState(saved);
    }
  }, []);

  useEffect(() => {
    // Resolve system theme
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const updateResolvedTheme = () => {
      if (theme === 'system') {
        setResolvedTheme(mediaQuery.matches ? 'dark' : 'light');
      } else {
        setResolvedTheme(theme);
      }
    };

    updateResolvedTheme();
    mediaQuery.addEventListener('change', updateResolvedTheme);

    return () => mediaQuery.removeEventListener('change', updateResolvedTheme);
  }, [theme]);

  useEffect(() => {
    // Apply theme to document
    const root = document.documentElement;

    if (resolvedTheme === 'light') {
      root.classList.add('light-theme');
      root.classList.remove('dark-theme');
    } else {
      root.classList.add('dark-theme');
      root.classList.remove('light-theme');
    }
  }, [resolvedTheme]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem('theme', newTheme);
  }, []);

  const contextValue = useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme]);

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

// Theme toggle button component
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Suppress rendering until client-side to prevent hydration flash
  if (!mounted) return null;

  const cycleTheme = () => {
    if (theme === 'dark') setTheme('light');
    else if (theme === 'light') setTheme('system');
    else setTheme('dark');
  };

  return (
    <button
      onClick={cycleTheme}
      className={`p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors ${className}`}
      title={`Theme: ${theme}`}
      aria-label={`Current theme: ${theme}. Click to change.`}
    >
      {theme === 'dark' && <Moon className="w-5 h-5 text-white" />}
      {theme === 'light' && <Sun className="w-5 h-5 text-yellow-400" />}
      {theme === 'system' && <Monitor className="w-5 h-5 text-white" />}
    </button>
  );
}

// Compact toggle for mobile
export function ThemeToggleCompact() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex items-center gap-1 p-1 rounded-full bg-white/5 border border-white/10">
      <button
        onClick={() => setTheme('dark')}
        className={`p-1.5 rounded-full transition-colors ${
          theme === 'dark' ? 'bg-white/20' : 'hover:bg-white/10'
        }`}
        aria-label="Dark theme"
      >
        <Moon className="w-4 h-4 text-white" />
      </button>
      <button
        onClick={() => setTheme('light')}
        className={`p-1.5 rounded-full transition-colors ${
          theme === 'light' ? 'bg-white/20' : 'hover:bg-white/10'
        }`}
        aria-label="Light theme"
      >
        <Sun className="w-4 h-4 text-white" />
      </button>
      <button
        onClick={() => setTheme('system')}
        className={`p-1.5 rounded-full transition-colors ${
          theme === 'system' ? 'bg-white/20' : 'hover:bg-white/10'
        }`}
        aria-label="System theme"
      >
        <Monitor className="w-4 h-4 text-white" />
      </button>
    </div>
  );
}
