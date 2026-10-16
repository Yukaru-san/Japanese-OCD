# Contributing

How the plugin is built inside, file by file, is described in [README.md → How it works](README.md#how-it-works).

## Setup

```shell
npm install        # also builds the plugin (prepare script)
```

For the Android part you need the Android SDK (`ANDROID_HOME` or `android/local.properties`) and JDK 21.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run build` | Compiles `src/` to `dist/esm/`, embeds the web engine's models and runtime (`scripts/embed-assets.mjs`) and bundles `dist/plugin.js` and `dist/plugin.cjs.js` with Rollup. |
| `npm run lint` / `npm run fmt` | ESLint and Prettier (with the Java plugin): check, or fix. |
| `npm run verify` | `./gradlew clean build test` for Android, then `npm run build`. |
| `npm test` | Builds, then runs the TypeScript unit tests in `tests/` with `node --test` (the web port of `ReadingOrder`, mirroring `ReadingOrderTest.java`). |
| `cd android && ./gradlew test` | Unit tests for `ReadingOrder` and `InkLines` (plain Java). |

`ReadingOrder.java` and `src/web/reading-order.ts` must stay in sync: a change to one needs the same change in the
other, so both engines return the same result.

## Publishing

`npm publish` runs `npm run build` first (`prepublishOnly`). The `files` array in `package.json` lists what is
published: `android/src/main/`, `android/build.gradle` and `dist/`.
