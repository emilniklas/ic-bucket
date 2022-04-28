import { Actor, ActorSubclass, getManagementCanister } from "@dfinity/agent";
import { _SERVICE as AssetsCanister } from "icbucket_frontend/icbucket_frontend.did.js";
import {
  cloneElement,
  Fragment,
  KeyboardEvent,
  MouseEvent,
  MouseEventHandler,
  ReactElement,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  createContext,
  useContext,
} from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import {
  Asset,
  UploadingState,
  useCanisterAssets,
  useCreateDirectory,
  useDeleteCanisterAsset,
  useUploadCanisterAsset,
} from "./Asset.js";
import { canisterURL } from "./canisterURL.js";
import * as Feather from "react-feather";
import { useAgent, useIdentity } from "./Identity.jsx";

interface Directory {
  children: Entity[];
  key: string;
  url: URL;
}

type Entity = Directory | Asset;

function byKey<T extends { key: string }>(a: T, b: T): number {
  return a.key.localeCompare(b.key);
}

function collect(assets: Asset[], url: URL): Directory {
  const selectedAssets = assets.filter((a) =>
    a.url.pathname.startsWith(url.pathname)
  );

  const assetsInThisDirectory = selectedAssets
    .filter((a) => new URL(".", a.url).pathname === url.pathname)
    .sort(byKey);

  const assetsInNestedDirectories = selectedAssets.filter(
    (a) => !assetsInThisDirectory.includes(a)
  );

  const nestedAssetsByDirectory = new Map<string, Asset[]>();
  for (const asset of assetsInNestedDirectories) {
    const dirname = decodeURIComponent(
      asset.url.pathname.slice(url.pathname.length).split("/").shift()!
    );
    let assets = nestedAssetsByDirectory.get(dirname);
    if (!assets) {
      nestedAssetsByDirectory.set(dirname, (assets = []));
    }
    assets.push(asset);
  }

  const innerDirectories = Array.from(nestedAssetsByDirectory)
    .map(([dirname, assets]) => collect(assets, new URL(dirname + "/", url)))
    .sort(byKey);

  return {
    key: decodeURIComponent(url.pathname),
    children: [...innerDirectories, ...assetsInThisDirectory],
    url,
  };
}

enum DirectoryView {
  Grid = "Grid",
  Table = "Table",
}

function DirectoryViewInput({
  value,
  onChange,
}: {
  value: DirectoryView;
  onChange: (view: DirectoryView) => void;
}) {
  return (
    <div style={{ display: "flex" }}>
      {[
        { view: DirectoryView.Grid, icon: <Feather.Grid /> },
        { view: DirectoryView.Table, icon: <Feather.AlignLeft /> },
      ].map(({ view, icon }) => (
        <button
          key={view}
          style={{
            appearance: "none",
            font: "inherit",
            fontSize: 13,
            border: 0,
            background: value === view ? "#ccc" : "#fefefe",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            paddingBlock: 4,
            paddingInline: 8,
          }}
          onClick={() => onChange(view)}
        >
          {cloneElement(icon, { size: 16 })}
          {view}
        </button>
      ))}
    </div>
  );
}

function EmptyDirectory() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        alignItems: "center",
      }}
    >
      <Feather.Folder size={32} />
      This folder is empty!
      <br />
      Drop a file to upload.
    </div>
  );
}

const DirectoryViewContext = createContext<{
  view: DirectoryView;
  setView: (view: DirectoryView) => void;
} | null>(null);

function EntityList({
  view,
  entities,
  canister,
  directoryURL,
}: {
  view: DirectoryView;
  entities: Entity[];
  canister: ActorSubclass<AssetsCanister>;
  directoryURL: URL;
}) {
  const [selectedEntities, setSelectedEntities] = useState<Set<string>>(
    new Set()
  );
  const [lastSelectedIndex, setLastSelectedIndex] = useState(-1);

  function onMouseDown(
    entity: Entity,
    index: number,
    e: MouseEvent<HTMLDivElement | HTMLTableRowElement>
  ) {
    e.stopPropagation();

    if (e.button === 2 && selectedEntities.has(entity.key)) {
      return;
    }

    if (e.metaKey) {
      const newSet = new Set(selectedEntities);
      if (newSet.has(entity.key)) {
        newSet.delete(entity.key);
      } else {
        newSet.add(entity.key);
      }
      setSelectedEntities(newSet);
    } else if (e.shiftKey && lastSelectedIndex >= 0) {
      const startIndex = Math.min(lastSelectedIndex, index);
      const endIndex = Math.max(lastSelectedIndex, index);
      const range = entities.map((e) => e.key).slice(startIndex, endIndex + 1);

      setSelectedEntities(new Set(range));
    } else {
      setSelectedEntities(new Set([entity.key]));
    }
    setLastSelectedIndex(index);
  }

  const { delete: deleteAsset } = useDeleteCanisterAsset(canister);

  function deleteSelected() {
    closeContextMenu();
    if (
      selectedEntities.size === 0 ||
      !confirm(`Delete ${selectedEntities.size} files?`)
    ) {
      return;
    }
    for (const key of selectedEntities) {
      const entity = entities.find((e) => e.key === key);
      if (entity) {
        deleteEntity(entity);
      }
    }
  }

  function deleteEntity(entity: Entity) {
    if ("children" in entity) {
      for (const child of entity.children) {
        deleteEntity(child);
      }
    } else {
      deleteAsset(entity.key);
    }
  }

  const { create: createDir } = useCreateDirectory(canister, directoryURL);
  function newFolder() {
    createDir("New Folder");
    closeContextMenu();
  }

  function onKeyDown(e: KeyboardEvent<any>) {
    if (e.key === "Backspace") {
      e.preventDefault();
      deleteSelected();
    } else if (e.key === "Escape") {
      setSelectedEntities(new Set());
    }
  }

  const [contextMenuOrigin, setContextMenuOrigin] =
    useState<{ x: number; y: number }>();

  function onContextMenu(e: MouseEvent<any>) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenuOrigin({ x: e.clientX, y: e.clientY });
  }

  const closeContextMenu = () => setContextMenuOrigin(undefined);

  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (contextMenuRef.current == null) {
      return;
    }

    contextMenuRef.current.focus();

    const onFocus = (e: FocusEvent) => {
      if (
        e.relatedTarget === contextMenuRef.current ||
        contextMenuRef.current!.contains(e.relatedTarget as Node)
      ) {
        return;
      }

      closeContextMenu();
    };

    document.addEventListener("focusout", onFocus);
    return () => document.removeEventListener("focusout", onFocus);
  }, [contextMenuOrigin]);

  const isRoot = directoryURL.pathname === "/";

  const agent = useAgent();
  const managementCanister = useMemo(
    () => getManagementCanister({ agent }),
    [agent]
  );
  async function deleteCanister() {
    const canisterId = Actor.canisterIdOf(canister);
    await managementCanister.stop_canister({
      canister_id: canisterId,
    });
    await managementCanister.delete_canister({
      canister_id: canisterId,
    });
    location.href = "/";
  }

  const contextMenu = contextMenuOrigin && (
    <div
      tabIndex={0}
      ref={contextMenuRef}
      style={{
        position: "fixed",
        left: contextMenuOrigin.x,
        top: contextMenuOrigin.y,
      }}
    >
      <ContextMenu>
        <ContextMenu.Item onClick={newFolder} icon={<Feather.FolderPlus />}>
          New Folder
        </ContextMenu.Item>
        <ContextMenu.Item
          onClick={deleteSelected}
          icon={<Feather.Trash />}
          disabled={selectedEntities.size === 0}
        >
          Delete {selectedEntities.size > 1 && `${selectedEntities.size} items`}
        </ContextMenu.Item>
        <ContextMenu.Item
          icon={<Feather.Trash2 />}
          onClick={deleteCanister}
          disabled={!isRoot || selectedEntities.size > 0}
        >
          Delete Canister
        </ContextMenu.Item>
      </ContextMenu>
    </div>
  );

  const filteredEntities = entities.filter(notEmpty);

  function notEmpty(entity: Entity): boolean {
    return "children" in entity || entity.content_type !== "empty";
  }

  switch (view) {
    case DirectoryView.Grid:
      return (
        <>
          {contextMenu}
          <ol
            onMouseDown={() => setSelectedEntities(new Set())}
            onKeyDown={onKeyDown}
            onContextMenu={onContextMenu}
            style={{
              display: "flex",
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "stretch",
              justifyContent: "start",
              margin: 0,
              padding: 8,
              gap: 4,
              fontSize: 13,
            }}
          >
            {filteredEntities.length === 0 && (
              <li
                style={{
                  flex: "1 1 100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 3,
                }}
              >
                <EmptyDirectory />
              </li>
            )}
            {filteredEntities.map((entity, index) => (
              <li
                key={entity.key}
                style={{
                  flex: "0 0 120px",
                  display: "flex",
                }}
              >
                <Entity
                  view={view}
                  entity={entity}
                  onMouseDown={onMouseDown.bind(null, entity, index)}
                  isSelected={selectedEntities.has(entity.key)}
                />
              </li>
            ))}
          </ol>
        </>
      );

    case DirectoryView.Table:
      return (
        <>
          {contextMenu}
          <table
            onMouseDown={() => setSelectedEntities(new Set())}
            onKeyDown={onKeyDown}
            onContextMenu={onContextMenu}
            style={{
              width: "100%",
              maxWidth: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <tbody>
              {filteredEntities.length === 0 && (
                <tr>
                  <td>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 10,
                      }}
                    >
                      <EmptyDirectory />
                    </div>
                  </td>
                </tr>
              )}
              {filteredEntities.map((entity, index) => (
                <Entity
                  key={entity.key}
                  view={view}
                  entity={entity}
                  onMouseDown={onMouseDown.bind(null, entity, index)}
                  isSelected={selectedEntities.has(entity.key)}
                />
              ))}
            </tbody>
          </table>
        </>
      );
  }
}

function ContextMenu({ children }: { children?: ReactNode }) {
  return (
    <ul
      style={{
        boxShadow: "0 2px 8px -1px rgba(0,0,0,0.6)",
        borderRadius: 4,
        listStyle: "none",
        margin: 0,
        padding: 0,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        gap: 1,
        background: "#ccc",
      }}
    >
      {children}
    </ul>
  );
}
namespace ContextMenu {
  export function Item({
    onClick,
    children,
    icon,
    disabled = false,
  }: {
    onClick: MouseEventHandler<HTMLButtonElement>;
    children?: ReactNode;
    icon?: ReactElement<Feather.IconProps>;
    disabled?: boolean;
  }) {
    const [isHovered, setIsHovered] = useState(false);
    return (
      <li
        style={{
          listStyle: "none",
          padding: 0,
          background: "white",
        }}
      >
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          onMouseEnter={setIsHovered.bind(null, true)}
          onMouseOver={setIsHovered.bind(null, true)}
          onMouseLeave={setIsHovered.bind(null, false)}
          style={{
            appearance: "none",
            border: 0,
            font: "inherit",
            background: isHovered && !disabled ? "#eee" : "transparent",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            opacity: disabled ? 0.6 : 1,
            paddingInline: 6,
            paddingBlock: 4,
            gap: 4,
            width: "100%",
          }}
        >
          {icon && cloneElement(icon, { size: 13 })}
          {children}
        </button>
      </li>
    );
  }
}

function Entity({
  view,
  entity,
  onMouseDown,
  isSelected,
}: {
  view: DirectoryView;
  entity: Entity;
  onMouseDown: MouseEventHandler<HTMLDivElement | HTMLTableRowElement>;
  isSelected: boolean;
}) {
  let name = entity.key.split("/").filter(Boolean).pop()!;

  let nameNode: ReactNode = name;

  if (view === DirectoryView.Grid && name.length > 30) {
    nameNode = name.slice(0, 30).trimEnd() + "...";
  }

  const navigate = useNavigate();

  function goTo() {
    if ("children" in entity) {
      navigate(`/${entity.url.hostname.split(".").shift()!}${entity.key}`);
    } else {
      location.href = entity.url.href;
    }
  }

  const icon: ReactElement<Feather.IconProps> =
    "children" in entity ? <Feather.Folder /> : <Feather.File />;

  const isUploading = !("children" in entity) && entity.uploading != null;

  switch (view) {
    case DirectoryView.Grid:
      return (
        <div
          tabIndex={0}
          style={{
            flex: "1 1 100%",
            userSelect: "none",
            cursor: "default",
          }}
        >
          <div
            onMouseDown={onMouseDown}
            onDoubleClick={goTo}
            style={{
              background: isSelected ? "blue" : undefined,
              color: isSelected ? "white" : "inherit",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              borderRadius: 4,
              padding: 2,
            }}
          >
            <div
              style={{
                flex: "0 0 auto",
                display: "grid",
                gridTemplateRows: "1fr",
                gridTemplateColumns: "1fr",
              }}
            >
              <div
                style={{
                  gridArea: "1 / 1",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {cloneElement(icon, { size: 30 })}
              </div>

              {isUploading && (
                <div
                  style={{
                    gridArea: "1 / 1",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 40,
                  }}
                >
                  <UploadProgressBar state={entity.uploading!} />
                </div>
              )}
            </div>
            <div
              style={{
                flex: "1 1 100%",
                wordBreak: "break-word",
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                alignItems: "end",
              }}
            >
              {nameNode}
            </div>
          </div>
        </div>
      );

    case DirectoryView.Table:
      return (
        <tr
          tabIndex={0}
          onMouseDown={onMouseDown}
          onDoubleClick={goTo}
          style={{
            background: isSelected ? "blue" : undefined,
            color: isSelected ? "white" : "inherit",
            userSelect: "none",
            cursor: "default",
          }}
        >
          <td style={{ width: "1px", padding: 4 }}>
            {cloneElement(icon, {
              size: 16,
              style: { verticalAlign: "middle" },
            })}
          </td>

          <td
            style={{
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: "1px",
              padding: 4,
            }}
          >
            {nameNode}
          </td>

          <td>
            {isUploading && <UploadProgressBar state={entity.uploading!} />}
          </td>

          <td
            style={{
              width: "1px",
              padding: 4,
            }}
          >
            {!("children" in entity) && entity.content_type}
          </td>
        </tr>
      );
  }
}

function UploadProgressBar({ state }: { state: UploadingState }) {
  return (
    <progress
      max={state.totalBytesToBeUploaded}
      value={state.uploadedBytes || undefined}
      style={{ width: "100%" }}
    />
  );
}

function Directory({
  canister,
  directory,
  parentDirectory,
}: {
  canister: ActorSubclass<AssetsCanister>;
  directory: Directory;
  parentDirectory?: Directory;
}) {
  const { upload, error } = useUploadCanisterAsset(canister, directory.url);

  const [isHoveringDrop, setIsHoveringDrop] = useState(false);
  const { view, setView } = useContext(DirectoryViewContext)!;

  return (
    <div
      style={{
        border: "1px solid #ccc",
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsHoveringDrop(false);
        for (const file of e.dataTransfer.files) {
          upload(file);
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setIsHoveringDrop(true);
      }}
      onDragLeave={() => {
        setIsHoveringDrop(false);
      }}
    >
      <div
        style={{
          borderBottom: "1px solid #ccc",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "stretch",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            paddingLeft: 10,
          }}
        >
          <Link to="/">
            <Feather.ArrowLeftCircle />
          </Link>
          <Breadcrumbs
            parentDirectory={parentDirectory}
            directory={directory}
            canister={canister}
          />
        </div>
        <DirectoryViewInput value={view} onChange={setView} />
      </div>
      <div
        style={
          isHoveringDrop
            ? {
                outlineColor: "blue",
                outlineOffset: -4,
                outlineWidth: 4,
                outlineStyle: "solid",
              }
            : undefined
        }
      >
        <EntityList
          canister={canister}
          view={view}
          entities={directory.children}
          directoryURL={directory.url}
        />
      </div>
      {error != null && (
        <pre>
          {error instanceof Error ? error.stack : JSON.stringify(error)}
        </pre>
      )}
    </div>
  );
}

function Breadcrumbs({
  directory,
  parentDirectory,
  canister,
}: {
  directory: Directory;
  parentDirectory?: Directory;
  canister: ActorSubclass<AssetsCanister>;
}) {
  const segments = parentDirectory?.key.split("/").filter(Boolean) ?? [];
  if (parentDirectory != null) {
    segments.unshift(Actor.canisterIdOf(canister).toString());
  }

  const paths = segments.reduce<string[]>(
    (paths, segment, i) => [...paths, `${paths[i - 1] ?? ""}/${segment}`],
    []
  );

  const zipped = segments.map((segment, i) => ({ segment, path: paths[i]! }));

  return (
    <div>
      {zipped.map(({ segment, path }, i) => (
        <Fragment key={i}>
          <Link to={path}>{segment}</Link>

          {"/"}
        </Fragment>
      ))}
      <strong>
        {directory.key.split("/").filter(Boolean).pop() ??
          Actor.canisterIdOf(canister).toString()}
      </strong>
    </div>
  );
}

function DirectoryPage({
  canister,
  directory,
  parentDirectory,
}: {
  canister: ActorSubclass<AssetsCanister>;
  directory: Directory;
  parentDirectory?: Directory;
}) {
  return (
    <Routes>
      <Route
        path=":name/*"
        element={
          <DirectoryChildren directory={directory} canister={canister} />
        }
      />
      <Route
        path="/"
        element={
          <Directory
            parentDirectory={parentDirectory}
            directory={directory}
            canister={canister}
          />
        }
      />
    </Routes>
  );
}

function DirectoryChildren({
  canister,
  directory,
}: {
  canister: ActorSubclass<AssetsCanister>;
  directory: Directory;
}) {
  const name = useParams<{ name: string }>().name!;

  for (const child of directory.children) {
    if (child.key.split("/").filter(Boolean).pop() !== name) {
      continue;
    }

    if ("children" in child) {
      return (
        <DirectoryPage
          canister={canister}
          directory={child}
          parentDirectory={directory}
        />
      );
    }
  }

  return <div>Not Found</div>;
}

export function Canister({
  canister,
}: {
  canister: ActorSubclass<AssetsCanister>;
}) {
  const { assets } = useCanisterAssets(canister);

  const [view, setView] = useState(DirectoryView.Grid);

  const root = useMemo(() => collect(assets, canisterURL(canister)), [assets]);

  return (
    <DirectoryViewContext.Provider value={{ view, setView }}>
      <DirectoryPage canister={canister} directory={root} />
    </DirectoryViewContext.Provider>
  );
}
