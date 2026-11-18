import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Whether this bundle is the script node was started with. Both paths are resolved: npm runs bins through a
 * symlink (`node_modules/.bin/hosted-mcp-doctor`), and a plugin folder may sit behind a symlinked ~/.claude, while
 * import.meta.url is always the real file (review, 18 Nov 2026).
 */
export function isMain(metaUrl: string): boolean {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}
