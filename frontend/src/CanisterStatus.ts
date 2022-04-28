import {
  Actor,
  ActorSubclass,
  getManagementCanister,
  ManagementCanisterRecord,
} from "@dfinity/agent";
import { useMemo } from "react";
import { useQuery } from "react-query";
import { useAgent } from "./Identity.jsx";

type PromiseValueType<P> = P extends Promise<infer T> ? T : never;

export type CanisterStatus = PromiseValueType<
  ReturnType<ManagementCanisterRecord["canister_status"]>
>;

export function useCanisterStatus(canister: ActorSubclass<unknown>): {
  error?: Error;
  isLoading: boolean;
  status?: CanisterStatus;
} {
  const canisterId = Actor.canisterIdOf(canister);

  const agent = useAgent();

  const mgmt = useMemo(() => getManagementCanister({ agent }), [agent]);

  const { data, error, isLoading } = useQuery(`${canisterId}#status`, () =>
    mgmt.canister_status({ canister_id: canisterId })
  );

  return { error: error as Error | undefined, isLoading, status: data };
}
