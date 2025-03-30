{
  description = "OpenFrontIO - A real-time strategy game";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
        };

        bun = pkgs.bun-bin or pkgs.bun;

      in {
        devShells.default = pkgs.mkShell {
          packages = [ bun pkgs.git ];
          shellHook = "export BUN_RUNTIME_TRANSPILER_CACHE_PATH=\"$PWD/.bun-cache\"";
        };
      }
    );
}
