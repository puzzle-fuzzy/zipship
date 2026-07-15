import { useEffect, useState } from 'react';

let consumedToken: string | null | undefined;

/**
 * Consume a reset credential from the URL fragment exactly once per document.
 * The token stays in memory so React Strict Mode can remount safely, while the
 * address bar and browser history are scrubbed before any network call occurs.
 */
export function consumePasswordResetToken(): string | null {
  if (typeof window === 'undefined') {
    consumedToken = null;
    return consumedToken;
  }

  const params = new URLSearchParams(window.location.hash.slice(1));
  const fragmentToken = params.get('token');
  if (fragmentToken) {
    consumedToken = fragmentToken;
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}`,
    );
    return consumedToken;
  }

  if (consumedToken === undefined) consumedToken = null;
  return consumedToken;
}

/** Clear the in-memory credential as soon as it is no longer needed. */
export function clearPasswordResetToken() {
  consumedToken = null;
}

/** Track a new email link that navigates into an already-open reset page. */
export function usePasswordResetToken(): string | null {
  const [token, setToken] = useState(consumePasswordResetToken);

  useEffect(() => {
    const consumeNewFragment = () => setToken(consumePasswordResetToken());
    window.addEventListener('hashchange', consumeNewFragment);
    return () => window.removeEventListener('hashchange', consumeNewFragment);
  }, []);

  return token;
}

/** Reset module state between isolated tests. */
export function resetPasswordResetTokenForTests() {
  consumedToken = undefined;
}
