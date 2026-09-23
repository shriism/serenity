import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import iconGen from 'icon-gen'
import sharp from 'sharp'

const source = fileURLToPath(new URL('../assets/icon.svg', import.meta.url))
const output = fileURLToPath(new URL('../build/icons/', import.meta.url))
await mkdir(output, { recursive: true })
await Promise.all([
  iconGen(source, output, { ico: { name: 'app' }, icns: { name: 'app' } }),
  ...[16, 24, 32, 48, 64, 128, 256, 512, 1024].map((size) =>
    sharp(source).resize(size, size).png().toFile(join(output, `${size}x${size}.png`)))
])
