{ pkgs, lib, ... }:

let
  worktreeId = builtins.baseNameOf (builtins.toString ./.);
  projectName = "openfrontio";

  # Deterministic port offset from worktree name (0-499 range)
  # Parses first 3 hex chars of SHA-256 hash to derive a stable offset
  nameHash = builtins.hashString "sha256" "${projectName}-${worktreeId}";
  hexDigit = c:
    if c == "0" then 0 else if c == "1" then 1 else if c == "2" then 2
    else if c == "3" then 3 else if c == "4" then 4 else if c == "5" then 5
    else if c == "6" then 6 else if c == "7" then 7 else if c == "8" then 8
    else if c == "9" then 9 else if c == "a" then 10 else if c == "b" then 11
    else if c == "c" then 12 else if c == "d" then 13 else if c == "e" then 14
    else 15;
  hexToInt = s: lib.foldl' (acc: c: acc * 16 + hexDigit c) 0 (lib.stringToCharacters s);
  portOffset = lib.mod (hexToInt (builtins.substring 0 3 nameHash)) 500;

  vitePort = 9000 + portOffset;
  masterPort = 3000 + portOffset;
  workerBasePort = masterPort + 1;
  controlPlanePort = 3100 + portOffset;
in
{
  cachix.enable = false;

  env = {
    WORKTREE_ID = worktreeId;
    GAME_ENV = "dev";
    SKIP_BROWSER_OPEN = "true";

    # Worktree-isolated port assignments
    VITE_PORT = toString vitePort;
    MASTER_PORT = toString masterPort;
    WORKER_BASE_PORT = toString workerBasePort;
    CONTROL_PLANE_PORT = toString controlPlanePort;
    CONTROL_PLANE_URL = "http://127.0.0.1:${toString controlPlanePort}";
  };

  packages = with pkgs; [
    # JavaScript / Node
    nodejs_22
    nodePackages.npm

    # Rust / WebAssembly
    rustup
    wasm-pack
    pkg-config
    openssl

    # Go (map generator)
    go

    # Dev utilities
    jq
    curl
  ];

  enterShell = ''
    echo "${projectName} | worktree: ${worktreeId}"
    echo "  Vite ......... localhost:${toString vitePort}"
    echo "  Control ...... localhost:${toString controlPlanePort}"
    echo "  Master ....... localhost:${toString masterPort}"
    echo "  Workers ...... localhost:${toString workerBasePort}+"
    echo ""

    # Ensure Rust wasm32 target is available via rustup
    if command -v rustup &>/dev/null; then
      rustup target add wasm32-unknown-unknown --toolchain stable 2>/dev/null || true
    fi
  '';

  # Processes managed by `devenv up`
  processes = {
    client.exec = "npm run start:client";
    server.exec = "npm run start:server-dev";
    control_plane.exec = "cd rust && cargo run -p openfront-control-plane";
  };
}
