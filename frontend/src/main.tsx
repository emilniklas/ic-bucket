/// <reference types="vite/client.js" />

import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "react-query";
import { useAssetsCanister } from "./useAssetsCanister.js";
import { Canister } from "./Canister.jsx";
import { SignIn } from "./SignIn.jsx";
import {
  BrowserRouter,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  cloneElement,
  MouseEventHandler,
  ReactElement,
  ReactNode,
  useState,
} from "react";
import * as Feather from "react-feather";
import { Actor } from "@dfinity/agent";
import { idlFactory } from "icbucket_frontend";
import { useAgent } from "./Identity.jsx";
import { useCanisterStatus } from "./CanisterStatus.js";
import { Principal } from "@dfinity/principal";

const root = createRoot(
  document.body.appendChild(document.createElement("div"))
);

root.render(
  <div
    style={{
      fontFamily: "sans-serif",
    }}
  >
    <BrowserRouter>
      <QueryClientProvider client={new QueryClient()}>
        <SignIn>
          <Routes>
            <Route path=":canisterId/*" element={<App />} />

            <Route path="/" element={<Index />} />
          </Routes>
        </SignIn>
      </QueryClientProvider>
    </BrowserRouter>
  </div>
);

function App() {
  const { canisterId } = useParams<{ canisterId: string }>();

  try {
    Principal.fromText(canisterId!);
  } catch {
    return (
      <div>
        Invalid principal, try{" "}
        {Principal.fromUint8Array(
          crypto.getRandomValues(
            Principal.fromText("qhbym-qaaaa-aaaaa-aaafq-cai").toUint8Array()
          )
        ).toText()}
      </div>
    );
  }

  const canister = useAssetsCanister(canisterId!);

  const { error, isLoading, status } = useCanisterStatus(canister);

  if (error) {
    return <pre>{error.stack}</pre>;
  }

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!status || !("running" in status.status)) {
    return <div>This canister isn't running.</div>;
  }

  return <Canister canister={canister} />;
}

function Index() {
  const [canisterId, setCanisterId] = useState("");

  const navigate = useNavigate();
  const agent = useAgent();

  const [isCreating, setIsCreating] = useState(false);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
      }}
    >
      <h3>Open a Canister</h3>
      <input
        type="text"
        value={canisterId}
        onChange={(e) => setCanisterId(e.target.value)}
      />
      <Button
        icon={<Feather.Folder />}
        onClick={() => {
          navigate(`/${canisterId}`);
        }}
      >
        Open
      </Button>

      <Button
        icon={<Feather.FolderPlus />}
        isLoading={isCreating}
        onClick={async () => {
          try {
            setIsCreating(true);
            const assetsCanisterResponse = await fetch(
              new URL("./assetstorage.wasm", import.meta.url)
            );

            const canister = await Actor.createAndInstallCanister(
              idlFactory,
              {
                module: await assetsCanisterResponse.arrayBuffer(),
              },
              {
                agent,
              }
            );
            navigate(`/${Actor.canisterIdOf(canister)}`);
          } finally {
            setIsCreating(false);
          }
        }}
      >
        Create New Canister
      </Button>
    </div>
  );
}

function Button({
  icon,
  children,
  onClick,
  isLoading,
}: {
  icon: ReactElement<Feather.IconProps>;
  children?: ReactNode;
  onClick: MouseEventHandler<HTMLButtonElement>;
  isLoading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        appearance: "none",
        background: "#fefefe",
        borderRadius: 4,
        border: "1px solid #ccc",
        font: "inherit",
        fontSize: 13,
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        paddingInline: 10,
        paddingBlock: 4,
      }}
    >
      {isLoading ? (
        <Feather.Loader size={13} />
      ) : (
        icon && cloneElement(icon, { size: 13 })
      )}
      {children}
    </button>
  );
}
