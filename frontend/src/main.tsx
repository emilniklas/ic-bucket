import { icbucket } from "icbucket";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "react-query";

const root = createRoot(
  document.body.appendChild(document.createElement("div"))
);

root.render(
  <QueryClientProvider client={new QueryClient()}>
    <App />
  </QueryClientProvider>
);

function App() {
  const { data } = useQuery("hello", () => icbucket.hello());

  return (
    <>
      <div>{data}</div>
    </>
  );
}
