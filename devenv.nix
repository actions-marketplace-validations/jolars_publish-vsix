{ pkgs, ... }:

{
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_24;
  };

  packages = [
    pkgs.actionlint
    pkgs.shellcheck
    pkgs.shfmt
  ];

  git-hooks.hooks = {
    actionlint.enable = true;
    shellcheck.enable = true;
    shfmt.enable = true;
    eslint = {
      enable = true;
      entry = "npm run lint";
      pass_filenames = false;
    };
    prettier = {
      enable = true;
      entry = "npm run format:check";
      pass_filenames = false;
    };
    panache-format = {
      enable = true;
      name = "Panache format";
      entry = "panache format --check";
      language = "system";
      files = "\\.md$";
      excludes = [ "CHANGELOG.md" ];
    };
  };

  enterTest = ''
    npm ci --ignore-scripts
    npm run check
    actionlint
    shellcheck scripts/update-tags.sh
    shfmt -d scripts/update-tags.sh
    panache format --check .
    panache lint .
  '';
}
