import { useEffect, useState } from "react";

let consumedToken: string | null | undefined;

/**
 * Consume an invitation credential from the URL fragment and immediately scrub
 * browser history. The value remains only in this document's memory so a login
 * round trip and React Strict Mode remount can continue safely.
 */
export function consumeInvitationToken(): string | null {
  if (typeof window === "undefined") {
    consumedToken = null;
    return consumedToken;
  }

  const query = new URLSearchParams(window.location.search);
  const hadQueryToken = query.has("token");
  query.delete("token");
  const safeSearch = query.size > 0 ? `?${query.toString()}` : "";
  const params = new URLSearchParams(window.location.hash.slice(1));
  const fragmentToken = params.get("token");
  if (fragmentToken) {
    consumedToken = fragmentToken;
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${safeSearch}`,
    );
    return consumedToken;
  }

  if (hadQueryToken) {
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${safeSearch}${window.location.hash}`,
    );
  }

  if (consumedToken === undefined) consumedToken = null;
  return consumedToken;
}

export function clearInvitationToken() {
  consumedToken = null;
}

export function useInvitationToken(): string | null {
  const [token, setToken] = useState(consumeInvitationToken);

  useEffect(() => {
    const consumeNewFragment = () => setToken(consumeInvitationToken());
    window.addEventListener("hashchange", consumeNewFragment);
    return () => window.removeEventListener("hashchange", consumeNewFragment);
  }, []);

  return token;
}

export function resetInvitationTokenForTests() {
  consumedToken = undefined;
}
