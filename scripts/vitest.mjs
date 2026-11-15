// Runs Vitest from a working directory whose Windows drive letter is uppercase.
//
// Opened as "d:\..." (lowercase drive, as VS Code does), Node resolves Vitest's runner once as d:/
// and once as D:/, so two copies of the runner module exist and every test file fails with
// "Vitest failed to find the current suite". Starting Vitest from "D:\..." keeps one copy.
// On other platforms the path is unchanged and this is a plain pass-through.
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const cwd = process.cwd().replace(/^[a-z]:/, (drive) => drive.toUpperCase())
const vitest = path.join(cwd, 'node_modules', 'vitest', 'vitest.mjs')

const result = spawnSync(process.execPath, [vitest, ...process.argv.slice(2)], { cwd, stdio: 'inherit' })
process.exit(result.status ?? 1)
