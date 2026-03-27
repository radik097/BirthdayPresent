import { spawn } from "node:child_process";
import { access, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const nativeDir = path.join(repoRoot, "src-native");
const libsDir = path.join(repoRoot, "libs");
const outFile = path.join(libsDir, "downloader-core.exe");
const mingwBin = "C:\\ProgramData\\mingw64\\mingw64\\bin";
const profile = process.argv.includes("--debug") ? "debug" : "release";

async function exists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      windowsHide: false,
      ...options
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} exited with code ${code ?? "null"}.`));
    });
  });
}

const env = { ...process.env };
if (!(env.PATH ?? "").toLowerCase().includes(mingwBin.toLowerCase()) && (await exists(path.join(mingwBin, "dlltool.exe")))) {
  env.PATH = `${mingwBin}${path.delimiter}${env.PATH ?? ""}`;
}

if (!(await exists(path.join(nativeDir, "Cargo.toml")))) {
  throw new Error("Rust sidecar project was not found at src-native/Cargo.toml.");
}

console.log(`[dismas] Building Rust sidecar (${profile})...`);
await run("cargo", profile === "release" ? ["build", "--release"] : ["build"], { cwd: nativeDir, env });

const builtFile = path.join(nativeDir, "target", profile, "downloader-core.exe");
if (!(await exists(builtFile))) {
  throw new Error(`Rust build completed, but ${builtFile} was not produced.`);
}

await mkdir(libsDir, { recursive: true });
await copyFile(builtFile, outFile);
console.log(`[dismas] Synced ${builtFile} -> ${outFile}`);
