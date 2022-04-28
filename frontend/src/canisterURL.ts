import { Actor, ActorSubclass } from "@dfinity/agent";

export function canisterURL(canister: ActorSubclass<any>): URL {
  if (import.meta.env.PROD) {
    return new URL(`https://${Actor.canisterIdOf(canister)}.ic0.app`);
  } else {
    return new URL(`http://${Actor.canisterIdOf(canister)}.localhost:8000`);
  }
}
