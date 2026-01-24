// Tests for Navbar component

import { render, screen } from '@testing-library/react';
import Navbar from '@/components/Navbar';

// Mock next/navigation
jest.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
    back: jest.fn(),
  }),
}));

// Mock next-auth
jest.mock('next-auth/react', () => ({
  useSession: jest.fn(() => ({
    data: { user: { name: 'Test', email: 'test@test.com' } },
    status: 'authenticated',
  })),
  signIn: jest.fn(),
  signOut: jest.fn(),
}));

// Mock useCountdown hook
jest.mock('@/hooks/useCountdown', () => ({
  useCountdown: () => ({
    hours: 1,
    minutes: 30,
    seconds: 45,
    isExpired: false,
  }),
}));

// Mock framer-motion
jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <div {...props}>{children}</div>
    ),
    button: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <button {...props}>{children}</button>
    ),
    nav: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <nav {...props}>{children}</nav>
    ),
    span: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <span {...props}>{children}</span>
    ),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

// Mock next/image
jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ src, alt, ...props }: { src: string; alt: string; [key: string]: unknown }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} {...props} />
  ),
}));

// Mock next/link
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

describe('Navbar', () => {
  const mockProps = {
    round: {
      id: 'round-1',
      segmentNumber: 1,
      totalSegments: 75,
      genre: 'comedy' as const,
      opensAt: new Date(Date.now() - 3600000), // 1 hour ago
      closesAt: new Date(Date.now() + 3600000), // 1 hour from now
      status: 'open' as const,
    },
    userName: 'Test User',
    userAvatar: 'https://example.com/avatar.jpg',
  };

  it('renders the logo/brand', () => {
    render(<Navbar {...mockProps} />);
    expect(screen.getByText(/8SEC/i)).toBeInTheDocument();
  });

  it('shows Scene section', () => {
    render(<Navbar {...mockProps} />);
    expect(screen.getByText(/Scene/i)).toBeInTheDocument();
  });

  it('shows Closes In section', () => {
    render(<Navbar {...mockProps} />);
    expect(screen.getByText(/Closes In/i)).toBeInTheDocument();
  });

  it('shows user avatar', () => {
    render(<Navbar {...mockProps} />);
    const avatar = screen.getByAltText(/Test User/i);
    expect(avatar).toBeInTheDocument();
    expect(avatar).toHaveAttribute('src', 'https://example.com/avatar.jpg');
  });

  it('renders MADNESS subtitle', () => {
    render(<Navbar {...mockProps} />);
    expect(screen.getByText(/MADNESS/i)).toBeInTheDocument();
  });
});
