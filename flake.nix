{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { nixpkgs, ... }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
    in
    {
      devShells.${system}.default = (pkgs.buildFHSEnv {
        name = "gustav-dev";
        targetPkgs = p: with p; [
          nodejs_22
          python3
          pkg-config
          gcc
          gnumake

          # Electron runtime deps (comprehensive)
          alsa-lib
          at-spi2-atk
          at-spi2-core
          atk
          cairo
          cups
          dbus
          expat
          glib
          gtk3
          libdrm
          libGL
          libgbm
          libxcb
          libxcomposite
          libxcursor
          libxdamage
          libxext
          libxfixes
          libxi
          libxkbcommon
          libxrandr
          libxrender
          libxshmfence
          libxtst
          libx11
          mesa
          nspr
          nss
          pango
          systemd
          util-linux
          libpulseaudio
          fontconfig
          freetype
        ];
        runScript = "bash";
      }).env;
    };
}
