"use client";

import { useEffect, useState, type FormEvent } from "react";
import { KanbanBoard } from "@/components/KanbanBoard";

type SessionResponse = {
  authenticated: boolean;
  username: string | null;
};

type LoginState = {
  username: string;
  password: string;
};

const defaultLoginState: LoginState = {
  username: "",
  password: "",
};

const readSession = async (): Promise<SessionResponse> => {
  const response = await fetch("/api/session", {
    credentials: "include",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to read session.");
  }

  return response.json();
};

export const AppShell = () => {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginState, setLoginState] = useState<LoginState>(defaultLoginState);

  useEffect(() => {
    let isMounted = true;

    const loadSession = async () => {
      try {
        const nextSession = await readSession();
        if (isMounted) {
          setSession(nextSession);
        }
      } catch {
        if (isMounted) {
          setSession({ authenticated: false, username: null });
          setError("Unable to verify session. Please try signing in.");
        }
      } finally {
        if (isMounted) {
          setIsCheckingSession(false);
        }
      }
    };

    void loadSession();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(loginState),
      });

      if (!response.ok) {
        setError("Invalid username or password.");
        return;
      }

      const nextSession = (await response.json()) as SessionResponse;
      setSession(nextSession);
      setLoginState(defaultLoginState);
    } catch {
      setError("Sign in failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    setError(null);
    setIsSubmitting(true);

    try {
      await fetch("/api/logout", {
        method: "POST",
        credentials: "include",
      });
    } finally {
      setSession({ authenticated: false, username: null });
      setIsSubmitting(false);
    }
  };

  if (isCheckingSession) {
    return (
      <main className="mx-auto flex min-h-screen max-w-[560px] items-center justify-center px-6">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
          Checking session...
        </p>
      </main>
    );
  }

  if (session?.authenticated) {
    return <KanbanBoard onLogout={handleLogout} username={session.username} />;
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[560px] items-center px-6">
      <section className="w-full rounded-[32px] border border-[var(--stroke)] bg-white/90 p-8 shadow-[var(--shadow)] backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
          Project Management MVP
        </p>
        <h1 className="mt-3 font-display text-3xl font-semibold text-[var(--navy-dark)]">
          Sign in
        </h1>
        <p className="mt-2 text-sm leading-6 text-[var(--gray-text)]">
          Use the demo credentials to access your board.
        </p>
        <p className="mt-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--primary-blue)]">
          Username: user | Password: password
        </p>

        <form onSubmit={handleLogin} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
              Username
            </span>
            <input
              value={loginState.username}
              onChange={(event) =>
                setLoginState((prev) => ({ ...prev, username: event.target.value }))
              }
              className="mt-2 w-full rounded-xl border border-[var(--stroke)] bg-white px-3 py-2 text-sm font-medium text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)]"
              required
              autoComplete="username"
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
              Password
            </span>
            <input
              type="password"
              value={loginState.password}
              onChange={(event) =>
                setLoginState((prev) => ({ ...prev, password: event.target.value }))
              }
              className="mt-2 w-full rounded-xl border border-[var(--stroke)] bg-white px-3 py-2 text-sm font-medium text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)]"
              required
              autoComplete="current-password"
            />
          </label>

          {error ? (
            <p className="text-sm font-semibold text-red-600" role="alert">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            className="w-full rounded-full bg-[var(--secondary-purple)] px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
};
