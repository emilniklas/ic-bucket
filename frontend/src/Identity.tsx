import { Identity, AnonymousIdentity, Agent, HttpAgent } from "@dfinity/agent";
import { Ed25519KeyIdentity } from "@dfinity/identity";
import { createContext, ReactNode, useContext, useMemo } from "react";

declare global {
  const DEV_PEM: string | undefined;
}

const IdentityContext = createContext<Identity>(
  typeof DEV_PEM !== "undefined"
    ? Ed25519KeyIdentity.fromJSON(DEV_PEM)
    : new AnonymousIdentity()
);

export function useIdentity(): Identity {
  return useContext(IdentityContext);
}

export function IdentityProvider({
  identity,
  children,
}: {
  identity: Identity;
  children?: ReactNode;
}) {
  return (
    <IdentityContext.Provider value={identity}>
      {children}
    </IdentityContext.Provider>
  );
}

export function useAgent(): Agent {
  const identity = useIdentity();
  return useMemo(() => {
    const agent = new HttpAgent({ identity });
    if (import.meta.env.MODE !== "production") {
      agent.fetchRootKey().catch((e) => console.error(e));
    }
    return agent;
  }, [identity]);
}
