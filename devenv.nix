{
  pkgs,
  lib,
  config,
  ...
}:
{
  languages = {
    javascript = {
      enable = true;
      npm.enable = true;
    };
    typescript.enable = true;
  };

  packages = [
    pkgs.just
  ];
}
