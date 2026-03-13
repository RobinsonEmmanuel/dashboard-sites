'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated } from '@/lib/auth';
import Sidebar from '@/components/Sidebar';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (!isAuthenticated()) {
      router.push('/login');
      return;
    }
    // Synchroniser le token avec les cookies pour le middleware
    const token = localStorage.getItem('accessToken');
    if (token) {
      document.cookie = `accessToken=${token}; path=/; max-age=86400; samesite=lax`;
    }
  }, [router]);

  if (!mounted) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 bg-[#f57503] rounded-lg flex items-center justify-center font-bold text-white text-sm">
            RL
          </div>
          <p className="text-sm text-gray-400">Chargement…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
