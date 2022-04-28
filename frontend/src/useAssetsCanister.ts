import { _SERVICE as AssetsCanister } from "icbucket_frontend/icbucket_frontend.did.js";
import { createActor } from "icbucket_frontend";
import { useMemo } from "react";
import { useIdentity } from "./Identity.jsx";
import { ActorSubclass } from "@dfinity/agent";

declare global {
  class CompressionStream
    implements ReadableWritablePair<ArrayBuffer, ArrayBuffer>
  {
    constructor(encoding: string);
    readonly writable: WritableStream<ArrayBuffer>;
    readonly readable: ReadableStream<ArrayBuffer>;
  }
}

export function useAssetsCanister(
  canisterId: string
): ActorSubclass<AssetsCanister> {
  const identity = useIdentity();

  return useMemo(
    () => createActor(canisterId, { agentOptions: { identity } }),
    [canisterId, identity]
  );
}
