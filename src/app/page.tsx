'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to story page
    router.replace('/story');
  }, [router]);

  return (
    <div className="h-screen w-screen bg-black flex items-center justify-center">
      <div className="text-white text-xl">Loading...</div>
    </div>
  );
}
