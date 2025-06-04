import { defineConfig } from 'vite'
import deno from '@deno/vite-plugin'

const cert: string = await Deno.readTextFile('./certs/cert.pem');
const key: string = await Deno.readTextFile('./certs/key.pem');


// https://vite.dev/config/
export default defineConfig({
  server: {
    fs: { allow: ['./../'] },
    https: { key, cert },
    proxy: {} //force http1+tls mode
  },
  plugins: [deno()],
})
