import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }

          // Copy @ffmpeg/core single-thread WASM files into dist/ffmpeg for static/Vercel deployments
          const ffmpegEsmDir = path.resolve(__dirname, 'node_modules/@ffmpeg/core/dist/esm');
          const distFfmpegDir = path.resolve(distDir, 'ffmpeg');
          if (fs.existsSync(distDir) && fs.existsSync(ffmpegEsmDir)) {
            fs.mkdirSync(distFfmpegDir, {recursive: true});
            for (const file of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
              const srcFile = path.join(ffmpegEsmDir, file);
              if (fs.existsSync(srcFile)) {
                fs.copyFileSync(srcFile, path.join(distFfmpegDir, file));
              }
            }
          }
        },
      },
      {
        name: 'serve-ffmpeg-core-dev',
        apply: 'serve',
        configureServer(server) {
          server.middlewares.use('/ffmpeg', (req, res, next) => {
            const cleanUrl = (req.url || '').split('?')[0].replace(/^\//, '');
            if (cleanUrl !== 'ffmpeg-core.js' && cleanUrl !== 'ffmpeg-core.wasm') {
              next();
              return;
            }
            const filePath = path.resolve(__dirname, 'node_modules/@ffmpeg/core/dist/esm', cleanUrl);
            if (!fs.existsSync(filePath)) {
              next();
              return;
            }
            res.setHeader(
              'Content-Type',
              cleanUrl.endsWith('.wasm') ? 'application/wasm' : 'application/javascript'
            );
            fs.createReadStream(filePath).pipe(res);
          });
        },
      },
    ],
    optimizeDeps: {
      exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
