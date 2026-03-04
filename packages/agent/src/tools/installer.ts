import type { ToolInstallStep } from "../tools.js";

/** Source-agnostic release spec. Just needs a download URL. */
export interface ReleaseSpec {
  /** Direct download URL for the asset. */
  downloadUrl: string;
  /** Pinned version (without 'v' prefix), e.g. "2.65.0" */
  version: string;
  /** Path to binary inside the extracted archive (or the downloaded file itself for raw binaries). */
  binaryPathInArchive: string;
  /** Final binary name in ~/.local/bin, e.g. "gh" */
  binaryName: string;
}

const INSTALL_TMP = "/tmp/_clawrun_install";

/**
 * Generate sequential install steps from a release spec.
 * Works with any download URL — GitHub, custom CDN, etc.
 */
export function releaseInstallSteps(spec: ReleaseSpec): ToolInstallStep[] {
  const { downloadUrl, version, binaryPathInArchive, binaryName } = spec;
  const asset = downloadUrl.split("/").pop()!;
  const optDir = `$HOME/.local/opt/${binaryName}-v${version}`;
  const isZip = asset.endsWith(".zip");
  const isTarGz = asset.endsWith(".tar.gz") || asset.endsWith(".tgz");

  const steps: ToolInstallStep[] = [
    // 1. Ensure directories
    { cmd: "sh", args: ["-c", `mkdir -p $HOME/.local/bin $HOME/.local/opt ${INSTALL_TMP}`] },
    // 2. Download
    { cmd: "sh", args: ["-c", `curl -fsSL -o ${INSTALL_TMP}/${asset} "${downloadUrl}"`] },
  ];

  // 3. Extract (or skip for raw binaries)
  if (isTarGz) {
    steps.push({ cmd: "sh", args: ["-c", `tar xzf ${INSTALL_TMP}/${asset} -C ${INSTALL_TMP}`] });
  } else if (isZip) {
    steps.push({ cmd: "sh", args: ["-c", `unzip -o ${INSTALL_TMP}/${asset} -d ${INSTALL_TMP}`] });
  }

  // 4. Place binary in versioned directory
  steps.push({
    cmd: "sh",
    args: [
      "-c",
      `mkdir -p ${optDir}/bin && mv ${INSTALL_TMP}/${binaryPathInArchive} ${optDir}/bin/${binaryName} && chmod +x ${optDir}/bin/${binaryName}`,
    ],
  });

  // 5. Symlink
  steps.push({
    cmd: "sh",
    args: ["-c", `ln -sf ${optDir}/bin/${binaryName} $HOME/.local/bin/${binaryName}`],
  });

  // 6. Cleanup
  steps.push({ cmd: "sh", args: ["-c", `rm -rf ${INSTALL_TMP}`] });

  return steps;
}

/**
 * Generate a check command for a versioned binary install.
 * Checks the versioned directory so version bumps trigger a fresh install.
 */
export function releaseCheckCommand(
  binaryName: string,
  version: string,
): { cmd: string; args: string[] } {
  return {
    cmd: "sh",
    args: ["-c", `test -x "$HOME/.local/opt/${binaryName}-v${version}/bin/${binaryName}"`],
  };
}

/** Build a GitHub release download URL. */
export function githubReleaseUrl(repo: string, version: string, asset: string): string {
  return `https://github.com/${repo}/releases/download/v${version}/${asset}`;
}
