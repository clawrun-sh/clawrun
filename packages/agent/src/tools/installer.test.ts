import { describe, it, expect, vi } from "vitest";
import {
  releaseInstallSteps,
  releaseCheckCommand,
  githubReleaseUrl,
  type ReleaseSpec,
} from "./installer.js";

describe("githubReleaseUrl", () => {
  it("builds a correct GitHub release download URL", () => {
    const url = githubReleaseUrl("cli/cli", "2.65.0", "gh_2.65.0_linux_amd64.tar.gz");
    expect(url).toBe(
      "https://github.com/cli/cli/releases/download/v2.65.0/gh_2.65.0_linux_amd64.tar.gz",
    );
  });
});

describe("releaseCheckCommand", () => {
  it("returns a test -x command for the versioned directory", () => {
    const check = releaseCheckCommand("gh", "2.65.0");
    expect(check.cmd).toBe("sh");
    expect(check.args).toEqual(["-c", 'test -x "$HOME/.local/opt/gh-v2.65.0/bin/gh"']);
  });

  it("uses the correct binary name and version", () => {
    const check = releaseCheckCommand("jq", "1.7.1");
    expect(check.args[1]).toContain("jq-v1.7.1/bin/jq");
  });

  it("produces different checks for different versions of the same tool", () => {
    const v1 = releaseCheckCommand("gh", "2.65.0");
    const v2 = releaseCheckCommand("gh", "2.66.0");
    expect(v1.args[1]).not.toBe(v2.args[1]);
    expect(v1.args[1]).toContain("gh-v2.65.0");
    expect(v2.args[1]).toContain("gh-v2.66.0");
  });
});

describe("releaseInstallSteps", () => {
  const tarSpec: ReleaseSpec = {
    downloadUrl:
      "https://github.com/cli/cli/releases/download/v2.65.0/gh_2.65.0_linux_amd64.tar.gz",
    version: "2.65.0",
    binaryPathInArchive: "gh_2.65.0_linux_amd64/bin/gh",
    binaryName: "gh",
  };

  it("generates correct number of steps for .tar.gz", () => {
    const steps = releaseInstallSteps(tarSpec);
    // mkdir, curl, tar, mv+chmod, symlink, cleanup
    expect(steps).toHaveLength(6);
  });

  it("creates required directories first", () => {
    const steps = releaseInstallSteps(tarSpec);
    expect(steps[0].args[1]).toContain("mkdir -p");
    expect(steps[0].args[1]).toContain("$HOME/.local/bin");
    expect(steps[0].args[1]).toContain("$HOME/.local/opt");
  });

  it("downloads the asset with curl", () => {
    const steps = releaseInstallSteps(tarSpec);
    expect(steps[1].args[1]).toContain("curl -fsSL");
    expect(steps[1].args[1]).toContain(tarSpec.downloadUrl);
  });

  it("extracts with tar for .tar.gz assets", () => {
    const steps = releaseInstallSteps(tarSpec);
    expect(steps[2].args[1]).toContain("tar xzf");
  });

  it("places binary in versioned opt directory", () => {
    const steps = releaseInstallSteps(tarSpec);
    expect(steps[3].args[1]).toContain("$HOME/.local/opt/gh-v2.65.0/bin");
    expect(steps[3].args[1]).toContain("chmod +x");
  });

  it("creates symlink in ~/.local/bin", () => {
    const steps = releaseInstallSteps(tarSpec);
    expect(steps[4].args[1]).toContain("ln -sf");
    expect(steps[4].args[1]).toContain("$HOME/.local/bin/gh");
  });

  it("cleans up temp directory", () => {
    const steps = releaseInstallSteps(tarSpec);
    expect(steps[5].args[1]).toContain("rm -rf /tmp/_clawrun_install");
  });

  it("handles .zip assets with unzip", () => {
    const zipSpec: ReleaseSpec = {
      downloadUrl: "https://example.com/tool_1.0.0_linux_amd64.zip",
      version: "1.0.0",
      binaryPathInArchive: "tool",
      binaryName: "tool",
    };
    const steps = releaseInstallSteps(zipSpec);
    // mkdir, curl, unzip, mv+chmod, symlink, cleanup
    expect(steps).toHaveLength(6);
    expect(steps[2].args[1]).toContain("unzip -o");
  });

  it("skips extraction for raw binaries (no archive extension)", () => {
    const rawSpec: ReleaseSpec = {
      downloadUrl: "https://example.com/jq-linux-amd64",
      version: "1.7.1",
      binaryPathInArchive: "jq-linux-amd64",
      binaryName: "jq",
    };
    const steps = releaseInstallSteps(rawSpec);
    // mkdir, curl, mv+chmod, symlink, cleanup (no extract step)
    expect(steps).toHaveLength(5);
    // After curl, next step should be mv+chmod (no tar/unzip)
    expect(steps[2].args[1]).toContain("mkdir -p");
    expect(steps[2].args[1]).toContain("mv");
  });

  it("works with non-GitHub download URLs", () => {
    const customSpec: ReleaseSpec = {
      downloadUrl: "https://downloads.example.com/somecli-v1.2.3-linux-amd64.tar.gz",
      version: "1.2.3",
      binaryPathInArchive: "somecli",
      binaryName: "somecli",
    };
    const steps = releaseInstallSteps(customSpec);
    expect(steps[1].args[1]).toContain(
      "https://downloads.example.com/somecli-v1.2.3-linux-amd64.tar.gz",
    );
    expect(steps[3].args[1]).toContain("$HOME/.local/opt/somecli-v1.2.3/bin");
  });

  it("handles .tgz extension", () => {
    const tgzSpec: ReleaseSpec = {
      downloadUrl: "https://example.com/tool-1.0.0.tgz",
      version: "1.0.0",
      binaryPathInArchive: "tool",
      binaryName: "tool",
    };
    const steps = releaseInstallSteps(tgzSpec);
    expect(steps[2].args[1]).toContain("tar xzf");
  });
});

describe("version change triggers reinstall", () => {
  function specForVersion(version: string): ReleaseSpec {
    return {
      downloadUrl: githubReleaseUrl("cli/cli", version, `gh_${version}_linux_amd64.tar.gz`),
      version,
      binaryPathInArchive: `gh_${version}_linux_amd64/bin/gh`,
      binaryName: "gh",
    };
  }

  /** Mock sandbox where only specific versioned directories exist. */
  function mockSandbox(installedVersions: string[]) {
    const ran: Array<{ cmd: string; shell: string }> = [];
    return {
      ran,
      runCommand: vi.fn(async (cmd: string, args: string[] = []) => {
        const shell = args[1] ?? "";
        ran.push({ cmd, shell });
        // Simulate `test -x`: succeed only if the versioned dir is "installed"
        if (shell.includes("test -x")) {
          const found = installedVersions.some((v) => shell.includes(`gh-v${v}`));
          return { exitCode: found ? 0 : 1, stderr: async () => "" };
        }
        return { exitCode: 0, stderr: async () => "" };
      }),
    };
  }

  it("bump from v2.65.0 to v2.66.0: check fails, install targets new version", async () => {
    // Sandbox has gh v2.65.0 installed
    const sandbox = mockSandbox(["2.65.0"]);

    const oldTool = {
      check: releaseCheckCommand("gh", "2.65.0"),
      install: releaseInstallSteps(specForVersion("2.65.0")),
    };
    const newTool = {
      check: releaseCheckCommand("gh", "2.66.0"),
      install: releaseInstallSteps(specForVersion("2.66.0")),
    };

    // Old version check passes — already installed, would be skipped
    const oldResult = await sandbox.runCommand(oldTool.check.cmd, oldTool.check.args);
    expect(oldResult.exitCode).toBe(0);

    // New version check fails — triggers install
    const newResult = await sandbox.runCommand(newTool.check.cmd, newTool.check.args);
    expect(newResult.exitCode).toBe(1);

    // Run install for new version
    sandbox.ran.length = 0;
    for (const step of newTool.install) {
      const result = await sandbox.runCommand(step.cmd, step.args);
      expect(result.exitCode).toBe(0);
    }

    // Install downloaded the new version's asset
    expect(sandbox.ran.some((r) => r.shell.includes("v2.66.0/gh_2.66.0_linux_amd64.tar.gz"))).toBe(
      true,
    );
    // Install placed binary in new versioned directory
    expect(
      sandbox.ran.some((r) => r.shell.includes("gh-v2.66.0/bin") && r.shell.includes("chmod +x")),
    ).toBe(true);
    // Symlink points to new version
    expect(
      sandbox.ran.some(
        (r) =>
          r.shell.includes("ln -sf") &&
          r.shell.includes("gh-v2.66.0/bin/gh") &&
          r.shell.includes("$HOME/.local/bin/gh"),
      ),
    ).toBe(true);
  });
});
