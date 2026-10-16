export default {
  input: 'dist/esm/index.js',
  output: [
    {
      // Script-tag build: everything in one file, including the web engine and its models.
      file: 'dist/plugin.js',
      format: 'iife',
      name: 'capacitorJapaneseOcr',
      globals: {
        '@capacitor/core': 'capacitorExports',
      },
      sourcemap: true,
      sourcemapExcludeSources: true,
      inlineDynamicImports: true,
    },
    {
      // CommonJS build: the web engine and its models stay in separate chunks, loaded on first use.
      dir: 'dist',
      entryFileNames: 'plugin.cjs.js',
      chunkFileNames: 'cjs/[name].js',
      format: 'cjs',
      sourcemap: true,
      sourcemapExcludeSources: true,
    },
  ],
  external: ['@capacitor/core'],
};
