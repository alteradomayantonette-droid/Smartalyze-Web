"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { clearStoredToken, getStoredToken } from "@/lib/auth";

export default function Navbar() {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setHydrated(true);
      setToken(getStoredToken());
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [pathname]);

  const showOnRoute = pathname.startsWith("/dashboard") || pathname.startsWith("/dataset");

  // Avoid hydration mismatches: SSR cannot read localStorage, so we delay rendering
  // until the client has mounted and we can safely read the auth token.
  if (!hydrated) {
    return null;
  }

  if (!showOnRoute || !token) {
    return null;
  }

  function handleLogout() {
    clearStoredToken();
    setToken(null);
    router.replace("/login");
  }

  return (
    <header className="sticky top-0 z-50 border-b border-indigo-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <Link href="/" className="text-lg font-semibold tracking-tight text-indigo-700">
          Smartalyze
        </Link>

        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="rounded-xl border border-indigo-200 px-4 py-2 text-sm font-medium text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-50">
            Dashboard
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
          >
            Logout
          </button>
        </div>
      </div>
    </header>
  );
}