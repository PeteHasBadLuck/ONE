# ONE mobile app foundations

This repository is being prepared for one shared web experience packaged for iOS and Android with Capacitor, plus an Ubuntu Touch web-app package. The same HTML/CSS/JavaScript is copied into `www/` for native builds.

## Current status

- [x] Capacitor configuration and shared package scripts
- [x] Web bundle build script (copies the current HTML pages into `www/`)
- [x] Installable web-app manifest and ONE icon
- [ ] Native Android/iOS projects generated and tested
- [ ] Ubuntu Touch Clickable package built and tested on a device
- [ ] Real backend, authentication, synced profiles/messages, moderation, and payments

The current app remains a prototype. Profiles, likes, matches, and messages are local browser data; incoming likes are fictional. Do not use it for real member data.

## Building from a computer or cloud development environment

Requires Node.js 22+ and npm. Capacitor's current platform requirements are documented at https://capacitorjs.com/docs/getting-started/environment-setup.

```sh
npm install
npm run build:web
npx cap add android
npx cap add ios
npx cap sync
```

Only run `npx cap add android` / `npx cap add ios` once per checkout, after the corresponding native project is not already present. Android builds require Android Studio/Android SDK. iOS native builds require macOS and Xcode, or a suitable cloud macOS build service.

## Ubuntu Touch

Ubuntu Touch uses a separate packaging path; Capacitor does not target Ubuntu Touch. Start from UBports' official Clickable documentation: https://docs.ubports.com/en/latest/appdev/index.html. The hosted ONE web app can be used as the first web-app prototype, then packaged and tested with the target device's supported web-app/Clickable tooling.

## Phone-only workflow

GitHub can hold the source and review changes from a phone, but the phone itself cannot run Xcode or a full Android build toolchain. A cloud development environment or CI build runner will be needed to produce installable native packages. Never commit signing keys, store credentials, or payment secrets to this repository.
