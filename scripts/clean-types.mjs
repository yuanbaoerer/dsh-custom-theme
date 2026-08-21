import { rmSync } from 'node:fs'
rmSync(new URL('../lib/types', import.meta.url), { recursive: true, force: true })
