import { AuthClient } from "@dfinity/auth-client";
import { ReactNode } from "react";
import { useMutation } from "react-query";
import { IdentityProvider, useIdentity } from "./Identity.jsx";

export function SignIn({ children }: { children?: ReactNode }) {
  const fallbackIdentity = useIdentity();

  const {
    mutate: signIn,
    data: identity,
    error,
  } = useMutation(async () => {
    const client = await AuthClient.create({
      identity: fallbackIdentity as any,
    });

    await client.login({
      maxTimeToLive: BigInt(7 * 24 * 60 * 60 * 1000 * 1000 * 1000),
    });

    return client.getIdentity();
  });

  return (
    <IdentityProvider identity={identity ?? fallbackIdentity}>
      {identity == null && (
        <button
          type="button"
          style={{ marginBottom: 10 }}
          onClick={() => signIn()}
        >
          Sign in with Internet Identity
        </button>
      )}

      {error != null && <pre>{(error as any).stack}</pre>}

      {children}
    </IdentityProvider>
  );
}
