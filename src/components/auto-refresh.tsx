'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Re-renders the current page from the server every few seconds (e.g. while a draft is being written). */
export function AutoRefresh({ seconds = 4 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}
