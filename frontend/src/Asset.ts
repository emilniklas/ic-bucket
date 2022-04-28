import { Actor, ActorSubclass } from "@dfinity/agent";
import {
  BatchId,
  BatchOperationKind,
  ChunkId,
  _SERVICE as AssetsCanister,
} from "icbucket_frontend/icbucket_frontend.did.js";
import {
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "react-query";
import { canisterURL } from "./canisterURL.js";
import { UnloadBlocker } from "./UnloadBlocker.js";

const MB = 1024 * 1024;
const CHUNK_SIZE = 2 * MB;

type PromiseValueType<P> = P extends Promise<infer T> ? T : never;

export type UploadingState = {
  uploadedBytes: number;
  totalBytesToBeUploaded: number;
};

type ExtraAssetProps = {
  uploading?: UploadingState;
  url: URL;
};

export type Asset = PromiseValueType<
  ReturnType<AssetsCanister["list"]>
>[number] &
  ExtraAssetProps;

namespace CacheKey {
  export const list = (canister: ActorSubclass<AssetsCanister>) =>
    `${Actor.canisterIdOf(canister)}#list`;
  export const asset = (url: URL) => url.href;
}

export function useCanisterAssets(canister: ActorSubclass<AssetsCanister>): {
  isLoading: boolean;
  error?: Error;
  assets: Asset[];
} {
  const { data, isLoading, error } = useQuery(
    CacheKey.list(canister),
    () => canister.list({}),
    { staleTime: Infinity }
  );

  const baseURL = canisterURL(canister);

  return {
    assets:
      data?.map((a) => ({
        ...a,
        url: new URL(
          a.key.split("/").map(encodeURIComponent).join("/"),
          baseURL
        ),
      })) ?? [],
    isLoading,
    error: error as Error | undefined,
  };
}

function fileURL(file: File, directoryURL: URL): URL {
  return new URL(encodeURIComponent(file.name), directoryURL);
}

class Batcher {
  static readonly #BATCHERS = new WeakMap<AssetsCanister, Batcher>();

  readonly #blocker = new UnloadBlocker("Jobs are still being executed.");
  readonly #client: QueryClient;
  readonly #canister: ActorSubclass<AssetsCanister>;
  #batch?: Promise<BatchId>;
  #refCount = 0;
  #finishing = Promise.resolve();
  #operations: [Date, BatchOperationKind[]][] = [];

  private constructor(
    client: QueryClient,
    canister: ActorSubclass<AssetsCanister>
  ) {
    this.#client = client;
    this.#canister = canister;
  }

  static forCanister(
    client: QueryClient,
    canister: ActorSubclass<AssetsCanister>
  ) {
    let batcher = Batcher.#BATCHERS.get(canister);
    if (batcher == null) {
      Batcher.#BATCHERS.set(
        canister,
        (batcher = new Batcher(client, canister))
      );
    }
    return batcher;
  }

  batch(f: (batchId: BatchId) => Promise<BatchOperationKind[]>): Promise<void> {
    const date = new Date();
    if (this.#batch == null) {
      this.#blocker.block();
      this.#batch = this.#finishing
        .then(() => this.#blocker.block())
        .then(() => this.#canister.create_batch({}))
        .then((r) => r.batch_id);
    }

    this.#refCount++;
    return this.#batch.then((batchId) =>
      f(batchId).then(this.#onOperationsReady.bind(this, batchId, date))
    );
  }

  async #onOperationsReady(
    batchId: BatchId,
    date: Date,
    operations: BatchOperationKind[]
  ) {
    this.#operations.push([date, operations]);
    this.#refCount--;
    if (this.#refCount === 0) {
      await this.#commit(batchId);
    }
  }

  #commit(batchId: BatchId) {
    this.#batch = undefined;
    const operations = this.#operations
      .sort(([a], [b]) => a.getTime() - b.getTime())
      .flatMap(([, ops]) => ops);

    this.#operations = [];
    return (this.#finishing = this.#canister.commit_batch({
      batch_id: batchId,
      operations,
    })).finally(() => {
      this.#blocker.unblock();
      this.#client.invalidateQueries(CacheKey.list(this.#canister));
    });
  }
}

export function useCreateDirectory(
  canister: ActorSubclass<AssetsCanister>,
  parentDirectoryURL: URL
): { error?: Error; create: (name: string) => void } {
  const client = useQueryClient();

  const listKey = CacheKey.list(canister);

  async function create({ name }: { name: string }) {
    const keepFileUrl = new URL(
      encodeURIComponent(name) + "/.keep",
      parentDirectoryURL
    );
    const asset = {
      key: keepFileUrl.pathname.split("/").map(decodeURIComponent).join("/"),
      content_type: "empty",
    };
    await Batcher.forCanister(client, canister).batch(async () => [
      { CreateAsset: asset },
    ]);
  }

  const { error, mutate } = useMutation(create, {
    async onMutate({ name }) {
      const keepFileUrl = new URL(
        encodeURIComponent(name) + "/.keep",
        parentDirectoryURL
      );
      const asset = {
        key: keepFileUrl.pathname.split("/").map(decodeURIComponent).join("/"),
        content_type: "empty",
        encodings: [],
        url: keepFileUrl,
      };
      client.setQueryData<Asset>(CacheKey.asset(keepFileUrl), asset);
      client.setQueryData<Asset[]>(listKey, (assets) => [
        ...(assets ?? []),
        asset,
      ]);
    },
  });

  return {
    error: error as Error | undefined,
    create: (name) => mutate({ name }),
  };
}

export function useDeleteCanisterAsset(
  canister: ActorSubclass<AssetsCanister>
): { error?: Error; delete: (key: string) => void } {
  const client = useQueryClient();

  const listKey = CacheKey.list(canister);

  async function deleteAsset({ key }: { key: string }) {
    await Batcher.forCanister(client, canister).batch(async () => {
      return [
        {
          DeleteAsset: {
            key,
          },
        },
      ];
    });
  }

  const { error, mutate } = useMutation(deleteAsset, {
    async onMutate({ key }) {
      const previousAssets = client.getQueryData<Asset[]>(listKey);
      client.setQueryData<Asset[]>(
        listKey,
        (assets) => assets?.filter((a) => a.key !== key) ?? []
      );
      return { previousAssets };
    },
    onError(_, __, ctx) {
      client.setQueryData<Asset[]>(listKey, ctx?.previousAssets ?? []);
    },
  });

  return {
    error: error as Error | undefined,
    delete: (key) => mutate({ key }),
  };
}

export function useUploadCanisterAsset(
  canister: ActorSubclass<AssetsCanister>,
  directoryURL: URL
): { error?: Error; upload: (file: File) => void } {
  const client = useQueryClient();

  const listKey = CacheKey.list(canister);

  async function upload({ file }: { file: File }) {
    await Batcher.forCanister(client, canister).batch(async (batchId) => {
      const url = fileURL(file, directoryURL);
      const key = decodeURIComponent(url.pathname);

      const [a, b] = new Response(file).body!.tee();

      const [buffer, zipped] = await Promise.all([
        new Response(a).arrayBuffer(),
        new Response(
          b.pipeThrough(new CompressionStream("gzip"))
        ).arrayBuffer(),
      ]);

      function updateAssetInCache(uploading?: UploadingState) {
        const assetKey = CacheKey.asset(url);

        client.setQueryData<Asset[]>(
          listKey,
          (assets) =>
            assets?.map((a) => (a.key !== key ? a : { ...a, uploading })) ?? []
        );
        client.setQueryData<Asset | undefined>(assetKey, (a) =>
          a ? { ...a, uploading } : undefined
        );
      }

      const totalBytesToBeUploaded = buffer.byteLength + zipped.byteLength;
      let uploadedBytes = 0;

      const reportMoreUploadedBytes = (bytes: number) =>
        updateAssetInCache({
          totalBytesToBeUploaded,
          uploadedBytes: (uploadedBytes += bytes),
        });

      reportMoreUploadedBytes(0);

      const idChunks: ChunkId[] = [];

      let rest: ArrayBuffer = buffer;
      while (rest.byteLength > 0) {
        const chunk = new Uint8Array(rest.slice(0, CHUNK_SIZE));
        rest = rest.slice(CHUNK_SIZE);

        const { chunk_id } = await canister.create_chunk({
          content: Array.from(chunk),
          batch_id: batchId,
        });
        idChunks.push(chunk_id);
        reportMoreUploadedBytes(chunk.byteLength);
      }

      const gzipChunks: ChunkId[] = [];

      rest = zipped;
      while (rest.byteLength > 0) {
        const chunk = new Uint8Array(rest.slice(0, CHUNK_SIZE));
        rest = rest.slice(CHUNK_SIZE);

        const { chunk_id } = await canister.create_chunk({
          content: Array.from(chunk),
          batch_id: batchId,
        });
        gzipChunks.push(chunk_id);
        reportMoreUploadedBytes(chunk.byteLength);
      }

      const hash = await crypto.subtle.digest("SHA-256", buffer);
      const zippedHash = await crypto.subtle.digest("SHA-256", zipped);

      updateAssetInCache();

      return [
        {
          CreateAsset: {
            key,
            content_type: file.type,
          },
        },
        {
          SetAssetContent: {
            key,
            sha256: [Array.from(new Uint8Array(hash))],
            content_encoding: "identity",
            chunk_ids: idChunks,
          },
        },
        {
          SetAssetContent: {
            key,
            sha256: [Array.from(new Uint8Array(zippedHash))],
            content_encoding: "gzip",
            chunk_ids: gzipChunks,
          },
        },
      ];
    });
  }

  const { mutate, error } = useMutation(upload, {
    async onMutate({ file }) {
      await client.cancelQueries(listKey);

      const previousList = client.getQueryData<Asset[]>(listKey) ?? [];

      const url = fileURL(file, directoryURL);

      const assetKey = CacheKey.asset(url);

      const asset: Asset = {
        key: decodeURIComponent(url.pathname),
        content_type: file.type,
        encodings: [],
        url,
        uploading: { uploadedBytes: -1, totalBytesToBeUploaded: -1 },
      };

      client.setQueryData<Asset[]>(listKey, (l) => [...(l ?? []), asset]);
      client.setQueryData<Asset>(assetKey, asset);

      return { previousList };
    },
    onError(_, { file }, ctx) {
      const url = fileURL(file, directoryURL);
      const assetKey = CacheKey.asset(url);

      const list = ctx?.previousList ?? [];
      client.setQueryData<Asset[]>(listKey, list);
      client.invalidateQueries(assetKey);
    },
  });

  return {
    upload: (file) => mutate({ file }),
    error: error as Error | undefined,
  };
}
