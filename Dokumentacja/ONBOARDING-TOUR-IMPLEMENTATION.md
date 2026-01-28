# Onboarding Tour Implementation Guide

## Overview

This document outlines the implementation plan for an improved onboarding tour that guides new users through the AiMoviez platform using interactive UI highlights instead of static modal text.

---

## Current State Analysis

### Existing Implementation (`src/components/OnboardingTour.tsx`)

**What exists:**
- 8-step modal tour with text + emoji icons
- Progress bar and step indicators
- Keyboard navigation (Arrow keys, Escape)
- localStorage persistence (`aimoviez_onboarding_completed`)
- Skip functionality
- `useOnboarding()` hook for state management

**Current Steps:**
1. Welcome - Introduction
2. Voting - Explain the infinity button
3. Double-Tap - Quick vote shortcut
4. Daily Limit - 200 votes per day
5. Story - Watch winning clips
6. Upload - Become a creator
7. Profile - Track progress
8. Ready - Start voting

**Problems:**
| Issue | Impact |
|-------|--------|
| Text-only modal | Users forget instructions after closing |
| No UI highlighting | Users don't connect text to actual buttons |
| Generic experience | Doesn't show actual interface |
| 8 steps too long | Users skip or lose interest |
| No contextual hints | No help after tour ends |

---

## Proposed Solution: Spotlight Tour

### Concept

Replace the modal-based tour with an **interactive spotlight tour** that:
1. Highlights actual UI elements with a dark overlay
2. Shows tooltips pointing to real buttons
3. Allows users to interact with highlighted elements
4. Provides contextual hints after tour completion

### Visual Design

```
┌────────────────────────────────────────────────────────┐
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓╔════════════╗▓▓▓▓▓▓▓▓▓▓▓▓▓│
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓║            ║▓▓▓▓▓▓▓▓▓▓▓▓▓│
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓║   ∞ Vote   ║◄── Spotlight│
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓║            ║    (cutout) │
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓╚════════════╝▓▓▓▓▓▓▓▓▓▓▓▓▓│
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓┌─────────┴──────────┐▓▓▓▓▓▓▓▓▓▓│
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│  Tap ∞ to vote!    │▓▓▓▓▓▓▓▓▓▓│
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│  ● ● ○ ○ ○  [Next]│◄── Tooltip│
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓└────────────────────┘▓▓▓▓▓▓▓▓▓▓│
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
└────────────────────────────────────────────────────────┘
```

---

## Architecture

### File Structure

```
src/
├── components/
│   ├── SpotlightTour/
│   │   ├── index.ts              # Exports
│   │   ├── SpotlightTour.tsx     # Main controller component
│   │   ├── SpotlightOverlay.tsx  # SVG overlay with cutout
│   │   ├── TourTooltip.tsx       # Positioned tooltip
│   │   ├── tourSteps.ts          # Step configurations
│   │   └── useSpotlightTour.ts   # Tour state management hook
│   └── OnboardingTour.tsx        # (Keep as fallback/alternative)
```

### Component Hierarchy

```
<SpotlightTour>
  ├── <SpotlightOverlay>          # Full-screen dark overlay with SVG mask
  │   └── <svg>                   # Cutout around target element
  │       └── <rect>              # Overlay
  │       └── <rect>              # Cutout (via mask)
  │       └── <rect>              # Pulse animation border
  └── <TourTooltip>               # Glass-style tooltip
      ├── <Arrow>                 # Pointer to target
      ├── <Title>                 # Step title
      ├── <Description>           # Step description
      ├── <ProgressDots>          # ● ● ○ ○ ○
      └── <NavigationButtons>     # Back / Next / Skip
```

---

## Step Configuration

### Reduced Steps (5 instead of 8)

```typescript
// src/components/SpotlightTour/tourSteps.ts

export interface TourStep {
  id: string;
  target: string;                    // CSS selector or data-tour attribute
  title: string;
  description: string;
  position: 'top' | 'bottom' | 'left' | 'right' | 'center';
  spotlightPadding?: number;         // Extra padding around element (default: 8)
  spotlightRadius?: number;          // Border radius of spotlight (default: 12)
  allowInteraction?: boolean;        // Can user click the highlighted element?
  advanceOnClick?: boolean;          // Auto-advance when element is clicked?
  pulseAnimation?: boolean;          // Show pulse effect on element?
}

export const DASHBOARD_TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    target: '[data-tour="video-player"]',
    title: 'Welcome to AiMoviez!',
    description: 'This clip is competing to become part of the movie. Watch and decide if it deserves your vote!',
    position: 'bottom',
    spotlightPadding: 0,
    spotlightRadius: 16,
  },
  {
    id: 'vote-button',
    target: '[data-tour="vote-button"]',
    title: 'Cast Your Vote',
    description: 'Tap the ∞ button to vote. You have 200 votes per day - use them wisely!',
    position: 'left',
    pulseAnimation: true,
    allowInteraction: true,
    advanceOnClick: true,
  },
  {
    id: 'navigation',
    target: '[data-tour="swipe-hint"]',
    title: 'Discover More Clips',
    description: 'Swipe up or use the arrows to see more clips competing for this slot.',
    position: 'center',
  },
  {
    id: 'story-tab',
    target: '[data-tour="story-tab"]',
    title: 'Watch the Story',
    description: 'See all the winning clips compiled into the movie so far.',
    position: 'top',
    pulseAnimation: true,
  },
  {
    id: 'upload-tab',
    target: '[data-tour="upload-tab"]',
    title: 'Become a Creator',
    description: 'Upload your own 8-second clips and compete for a spot in the movie!',
    position: 'top',
    pulseAnimation: true,
  },
];
```

### Data Attributes to Add

Add `data-tour` attributes to target elements in the dashboard:

```tsx
// src/app/dashboard/page.tsx

// Video player area
<div data-tour="video-player" className="...">
  <video ... />
</div>

// Vote button
<button data-tour="vote-button" className="...">
  <Infinity />
</button>

// Swipe hint area
<div data-tour="swipe-hint" className="...">
  {/* Arrow indicators */}
</div>

// Bottom navigation tabs
<Link data-tour="story-tab" href="/story">...</Link>
<Link data-tour="upload-tab" href="/upload">...</Link>
```

---

## Component Specifications

### 1. SpotlightTour.tsx (Main Controller)

```typescript
interface SpotlightTourProps {
  steps: TourStep[];
  onComplete: () => void;
  onSkip: () => void;
  startStep?: number;
}

// Features:
// - Manages current step state
// - Calculates target element position
// - Handles window resize/scroll
// - Keyboard navigation (arrows, escape)
// - Touch/swipe support for mobile
```

**Key Logic:**

```typescript
function SpotlightTour({ steps, onComplete, onSkip }: SpotlightTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  const step = steps[currentStep];

  // Find and track target element position
  useEffect(() => {
    const updateTargetRect = () => {
      const element = document.querySelector(step.target);
      if (element) {
        setTargetRect(element.getBoundingClientRect());
      }
    };

    updateTargetRect();
    window.addEventListener('resize', updateTargetRect);
    window.addEventListener('scroll', updateTargetRect);

    return () => {
      window.removeEventListener('resize', updateTargetRect);
      window.removeEventListener('scroll', updateTargetRect);
    };
  }, [step.target]);

  // Handle element click if advanceOnClick is true
  useEffect(() => {
    if (!step.advanceOnClick) return;

    const element = document.querySelector(step.target);
    const handleClick = () => setCurrentStep((prev) => prev + 1);

    element?.addEventListener('click', handleClick);
    return () => element?.removeEventListener('click', handleClick);
  }, [step]);

  return (
    <AnimatePresence>
      <SpotlightOverlay
        targetRect={targetRect}
        padding={step.spotlightPadding}
        radius={step.spotlightRadius}
        pulse={step.pulseAnimation}
      />
      <TourTooltip
        step={step}
        targetRect={targetRect}
        currentStep={currentStep}
        totalSteps={steps.length}
        onNext={() => setCurrentStep((prev) => prev + 1)}
        onPrev={() => setCurrentStep((prev) => prev - 1)}
        onSkip={onSkip}
        onComplete={onComplete}
      />
    </AnimatePresence>
  );
}
```

### 2. SpotlightOverlay.tsx (Dark Overlay with Cutout)

```typescript
interface SpotlightOverlayProps {
  targetRect: DOMRect | null;
  padding?: number;
  radius?: number;
  pulse?: boolean;
}

// Implementation using SVG mask:
function SpotlightOverlay({ targetRect, padding = 8, radius = 12, pulse }: SpotlightOverlayProps) {
  if (!targetRect) return null;

  const { x, y, width, height } = targetRect;
  const cutoutX = x - padding;
  const cutoutY = y - padding;
  const cutoutWidth = width + padding * 2;
  const cutoutHeight = height + padding * 2;

  return (
    <motion.svg
      className="fixed inset-0 z-[90] pointer-events-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <defs>
        <mask id="spotlight-mask">
          {/* White = visible, Black = hidden */}
          <rect x="0" y="0" width="100%" height="100%" fill="white" />
          <rect
            x={cutoutX}
            y={cutoutY}
            width={cutoutWidth}
            height={cutoutHeight}
            rx={radius}
            fill="black"
          />
        </mask>
      </defs>

      {/* Dark overlay with cutout */}
      <rect
        x="0"
        y="0"
        width="100%"
        height="100%"
        fill="rgba(0, 0, 0, 0.85)"
        mask="url(#spotlight-mask)"
        className="pointer-events-auto"
      />

      {/* Pulse animation border */}
      {pulse && (
        <motion.rect
          x={cutoutX}
          y={cutoutY}
          width={cutoutWidth}
          height={cutoutHeight}
          rx={radius}
          fill="none"
          stroke="url(#gradient)"
          strokeWidth="2"
          animate={{
            opacity: [0.5, 1, 0.5],
            scale: [1, 1.02, 1],
          }}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
      )}

      {/* Gradient definition */}
      <defs>
        <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3CF2FF" />
          <stop offset="50%" stopColor="#A020F0" />
          <stop offset="100%" stopColor="#FF00C7" />
        </linearGradient>
      </defs>
    </motion.svg>
  );
}
```

### 3. TourTooltip.tsx (Positioned Tooltip)

```typescript
interface TourTooltipProps {
  step: TourStep;
  targetRect: DOMRect | null;
  currentStep: number;
  totalSteps: number;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
  onComplete: () => void;
}

// Tooltip positioning logic:
function calculateTooltipPosition(
  targetRect: DOMRect,
  position: TourStep['position'],
  tooltipSize: { width: number; height: number }
): { x: number; y: number; arrowPosition: string } {
  const MARGIN = 16;
  const ARROW_SIZE = 12;

  let x: number, y: number;

  switch (position) {
    case 'top':
      x = targetRect.x + targetRect.width / 2 - tooltipSize.width / 2;
      y = targetRect.y - tooltipSize.height - ARROW_SIZE - MARGIN;
      break;
    case 'bottom':
      x = targetRect.x + targetRect.width / 2 - tooltipSize.width / 2;
      y = targetRect.y + targetRect.height + ARROW_SIZE + MARGIN;
      break;
    case 'left':
      x = targetRect.x - tooltipSize.width - ARROW_SIZE - MARGIN;
      y = targetRect.y + targetRect.height / 2 - tooltipSize.height / 2;
      break;
    case 'right':
      x = targetRect.x + targetRect.width + ARROW_SIZE + MARGIN;
      y = targetRect.y + targetRect.height / 2 - tooltipSize.height / 2;
      break;
    case 'center':
    default:
      x = window.innerWidth / 2 - tooltipSize.width / 2;
      y = window.innerHeight / 2 - tooltipSize.height / 2;
      break;
  }

  // Keep tooltip within viewport bounds
  x = Math.max(MARGIN, Math.min(x, window.innerWidth - tooltipSize.width - MARGIN));
  y = Math.max(MARGIN, Math.min(y, window.innerHeight - tooltipSize.height - MARGIN));

  return { x, y, arrowPosition: position };
}
```

**Tooltip Styling (matches existing glass design):**

```tsx
<motion.div
  className="fixed z-[95] w-80 max-w-[90vw] bg-black/80 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl overflow-hidden"
  style={{ left: position.x, top: position.y }}
  initial={{ opacity: 0, scale: 0.9 }}
  animate={{ opacity: 1, scale: 1 }}
  exit={{ opacity: 0, scale: 0.9 }}
>
  {/* Arrow pointer */}
  <div className={`absolute w-3 h-3 bg-black/80 border-white/20 transform rotate-45 ${arrowClasses}`} />

  <div className="p-5">
    {/* Title */}
    <h3 className="text-lg font-bold text-white mb-2">{step.title}</h3>

    {/* Description */}
    <p className="text-sm text-white/70 mb-4">{step.description}</p>

    {/* Progress dots */}
    <div className="flex justify-center gap-1.5 mb-4">
      {Array.from({ length: totalSteps }).map((_, i) => (
        <div
          key={i}
          className={`h-1.5 rounded-full transition-all ${
            i === currentStep
              ? 'w-6 bg-gradient-to-r from-cyan-500 to-purple-500'
              : i < currentStep
              ? 'w-1.5 bg-white/50'
              : 'w-1.5 bg-white/20'
          }`}
        />
      ))}
    </div>

    {/* Buttons */}
    <div className="flex gap-2">
      {currentStep > 0 && (
        <button onClick={onPrev} className="flex-1 py-2 bg-white/10 rounded-xl text-sm font-medium">
          Back
        </button>
      )}
      <button
        onClick={isLastStep ? onComplete : onNext}
        className="flex-1 py-2 bg-gradient-to-r from-cyan-500 to-purple-500 rounded-xl text-sm font-bold"
      >
        {isLastStep ? 'Start Voting!' : 'Next'}
      </button>
    </div>

    {/* Skip link */}
    <button onClick={onSkip} className="w-full mt-3 text-xs text-white/50 hover:text-white/70">
      Skip tour
    </button>
  </div>
</motion.div>
```

### 4. useSpotlightTour.ts (State Management Hook)

```typescript
const TOUR_STORAGE_KEY = 'aimoviez_spotlight_tour';

interface TourState {
  completed: boolean;
  skipped: boolean;
  lastStepSeen: number;
  completedAt?: string;
}

export function useSpotlightTour() {
  const [showTour, setShowTour] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(TOUR_STORAGE_KEY);
    if (stored) {
      const state: TourState = JSON.parse(stored);
      if (!state.completed && !state.skipped) {
        setShowTour(true);
      }
    } else {
      // First visit - show tour
      setShowTour(true);
    }
    setIsLoading(false);
  }, []);

  const completeTour = () => {
    const state: TourState = {
      completed: true,
      skipped: false,
      lastStepSeen: -1,
      completedAt: new Date().toISOString(),
    };
    localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify(state));
    setShowTour(false);
  };

  const skipTour = () => {
    const state: TourState = {
      completed: false,
      skipped: true,
      lastStepSeen: -1,
    };
    localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify(state));
    setShowTour(false);
  };

  const resetTour = () => {
    localStorage.removeItem(TOUR_STORAGE_KEY);
    setShowTour(true);
  };

  return { showTour, isLoading, completeTour, skipTour, resetTour };
}
```

---

## Integration with Dashboard

### Usage in Dashboard Page

```tsx
// src/app/dashboard/page.tsx

import { SpotlightTour, useSpotlightTour, DASHBOARD_TOUR_STEPS } from '@/components/SpotlightTour';

function DashboardContent() {
  const { showTour, completeTour, skipTour } = useSpotlightTour();

  return (
    <div className="min-h-screen bg-black">
      {/* Video Player */}
      <div data-tour="video-player">
        <video ... />
      </div>

      {/* Actions */}
      <div className="action-column">
        <button data-tour="vote-button">
          <Infinity />
        </button>
      </div>

      {/* Bottom Navigation */}
      <nav className="bottom-nav">
        <Link data-tour="story-tab" href="/story">Story</Link>
        <Link data-tour="upload-tab" href="/upload">Upload</Link>
      </nav>

      {/* Spotlight Tour */}
      {showTour && (
        <SpotlightTour
          steps={DASHBOARD_TOUR_STEPS}
          onComplete={completeTour}
          onSkip={skipTour}
        />
      )}
    </div>
  );
}
```

---

## Contextual Hints (Post-Tour)

After the tour completes, show subtle hints for first-time actions:

### Implementation

```typescript
// src/components/ContextualHint.tsx

interface ContextualHintProps {
  id: string;                    // Unique ID for localStorage
  children: React.ReactNode;     // The hint content
  position?: 'top' | 'bottom';
  showOnce?: boolean;            // Only show once per user
  delay?: number;                // Delay before showing (ms)
}

export function ContextualHint({ id, children, position = 'bottom', showOnce = true, delay = 1000 }: ContextualHintProps) {
  const [visible, setVisible] = useState(false);
  const storageKey = `hint_${id}_seen`;

  useEffect(() => {
    if (showOnce && localStorage.getItem(storageKey)) {
      return;
    }

    const timer = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(timer);
  }, []);

  const dismiss = () => {
    setVisible(false);
    if (showOnce) {
      localStorage.setItem(storageKey, 'true');
    }
  };

  if (!visible) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: position === 'top' ? -10 : 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="absolute z-50 px-3 py-2 bg-gradient-to-r from-cyan-500/90 to-purple-500/90 rounded-lg text-sm font-medium shadow-lg"
      onClick={dismiss}
    >
      {children}
      <div className="absolute w-2 h-2 bg-cyan-500 rotate-45 -bottom-1 left-1/2 -translate-x-1/2" />
    </motion.div>
  );
}
```

### Hints to Implement

| Trigger | Hint Text | Location |
|---------|-----------|----------|
| First video loaded | "Double-tap to vote!" | Center of video |
| After 5 votes | "Great! Check the Story" | Story tab |
| First visit to Story | "These clips won the vote" | Top of page |
| First upload | "Your clip will be reviewed" | Upload confirmation |

---

## Mobile Considerations

### Touch Gestures

```typescript
// Handle swipe to advance/go back
const handleSwipe = (direction: 'left' | 'right') => {
  if (direction === 'left') {
    handleNext();
  } else {
    handlePrev();
  }
};

// Use Framer Motion's drag
<motion.div
  drag="x"
  dragConstraints={{ left: 0, right: 0 }}
  onDragEnd={(_, info) => {
    if (info.offset.x < -50) handleNext();
    if (info.offset.x > 50) handlePrev();
  }}
>
  {/* Tooltip content */}
</motion.div>
```

### Safe Area Handling

```typescript
// Respect iOS safe areas
<div className="pb-safe">
  <TourTooltip />
</div>
```

### Large Touch Targets

```typescript
// Minimum 44x44px touch targets (Apple HIG)
<button className="min-w-[44px] min-h-[44px] p-3">
  Next
</button>
```

---

## Accessibility

### ARIA Labels

```tsx
<div
  role="dialog"
  aria-modal="true"
  aria-label={`Tour step ${currentStep + 1} of ${totalSteps}: ${step.title}`}
>
  <p id="tour-description">{step.description}</p>
  <button aria-describedby="tour-description">Next</button>
</div>
```

### Focus Management

```typescript
// Trap focus within tooltip
useEffect(() => {
  const tooltip = tooltipRef.current;
  if (!tooltip) return;

  const focusableElements = tooltip.querySelectorAll('button, [tabindex]');
  const firstElement = focusableElements[0] as HTMLElement;
  const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

  firstElement?.focus();

  const handleTab = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    if (e.shiftKey && document.activeElement === firstElement) {
      e.preventDefault();
      lastElement?.focus();
    } else if (!e.shiftKey && document.activeElement === lastElement) {
      e.preventDefault();
      firstElement?.focus();
    }
  };

  tooltip.addEventListener('keydown', handleTab);
  return () => tooltip.removeEventListener('keydown', handleTab);
}, [currentStep]);
```

### Reduced Motion

```typescript
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

<motion.div
  animate={prefersReducedMotion ? {} : { scale: [1, 1.02, 1] }}
>
```

---

## Testing Plan

### Unit Tests

```typescript
// __tests__/SpotlightTour.test.tsx

describe('SpotlightTour', () => {
  it('renders first step on mount', () => {
    render(<SpotlightTour steps={mockSteps} onComplete={jest.fn()} onSkip={jest.fn()} />);
    expect(screen.getByText('Welcome to AiMoviez!')).toBeInTheDocument();
  });

  it('advances to next step on Next click', () => {
    render(<SpotlightTour steps={mockSteps} onComplete={jest.fn()} onSkip={jest.fn()} />);
    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByText('Cast Your Vote')).toBeInTheDocument();
  });

  it('calls onComplete on final step', () => {
    const onComplete = jest.fn();
    render(<SpotlightTour steps={mockSteps} onComplete={onComplete} onSkip={jest.fn()} />);
    // Navigate to last step...
    fireEvent.click(screen.getByText('Start Voting!'));
    expect(onComplete).toHaveBeenCalled();
  });

  it('saves completion to localStorage', () => {
    // ...
  });
});
```

### E2E Tests

```typescript
// e2e/onboarding.spec.ts

describe('Onboarding Tour', () => {
  beforeEach(() => {
    cy.clearLocalStorage();
    cy.login();
    cy.visit('/dashboard');
  });

  it('shows tour for new users', () => {
    cy.get('[data-testid="tour-tooltip"]').should('be.visible');
    cy.contains('Welcome to AiMoviez!');
  });

  it('highlights vote button on step 2', () => {
    cy.contains('Next').click();
    cy.get('[data-tour="vote-button"]').should('have.class', 'highlighted');
  });

  it('persists completion state', () => {
    // Complete tour
    cy.contains('Next').click();
    cy.contains('Next').click();
    cy.contains('Next').click();
    cy.contains('Next').click();
    cy.contains('Start Voting!').click();

    // Refresh page
    cy.reload();

    // Tour should not appear
    cy.get('[data-testid="tour-tooltip"]').should('not.exist');
  });
});
```

---

## Migration Plan

### Phase 1: Build New Components (Day 1)
1. Create `SpotlightTour/` directory structure
2. Implement `SpotlightOverlay.tsx`
3. Implement `TourTooltip.tsx`
4. Implement `SpotlightTour.tsx`
5. Create `tourSteps.ts` with 5 steps

### Phase 2: Integration (Day 2)
1. Add `data-tour` attributes to dashboard elements
2. Replace `OnboardingTour` with `SpotlightTour` in dashboard
3. Test on mobile and desktop
4. Add help button to reset tour

### Phase 3: Contextual Hints (Day 3)
1. Create `ContextualHint` component
2. Add first-vote hint
3. Add story-visit hint
4. Add upload hint

### Phase 4: Polish & Deploy (Day 4)
1. Accessibility audit
2. Performance optimization
3. E2E tests
4. Deploy to production

---

## Fallback Strategy

Keep the existing `OnboardingTour.tsx` as a fallback:

```typescript
// If SpotlightTour fails (e.g., target element not found), fall back to modal
const [useFallback, setUseFallback] = useState(false);

useEffect(() => {
  const targetExists = document.querySelector(steps[0].target);
  if (!targetExists) {
    console.warn('Tour target not found, using fallback modal');
    setUseFallback(true);
  }
}, []);

if (useFallback) {
  return <OnboardingTour onComplete={onComplete} onSkip={onSkip} />;
}

return <SpotlightTour ... />;
```

---

## Summary

| Aspect | Current | Proposed |
|--------|---------|----------|
| Type | Modal with text | Interactive spotlight |
| Steps | 8 | 5 |
| UI Highlighting | None | SVG mask cutout |
| User Interaction | Read only | Can click elements |
| Dependencies | Framer Motion | Framer Motion (same) |
| Mobile Support | Basic | Touch-optimized |
| Post-Tour Help | None | Contextual hints |

**Estimated Total Effort:** 3-4 days

---

## Next Steps

1. Review this documentation
2. Approve the approach
3. Begin implementation with Phase 1
