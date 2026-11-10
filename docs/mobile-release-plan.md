# ONE iOS and Android release plan

## Existing foundation

The repository already uses Capacitor 8 and a shared web bundle in `www/`. Keep the existing web UI and use Capacitor to package the shared application for iOS and Android.

## Build and signing

- iOS: build on macOS with Xcode; configure Apple Developer team, bundle identifier, signing certificate and provisioning profile through protected CI secrets.
- Android: build with the Android Gradle plugin; configure Play App Signing and a protected upload key in CI secrets.
- Never commit signing certificates, provisioning profiles, keystores, passwords, API tokens or production environment files.
- Produce unsigned/debug artifacts for CI verification only. Store submissions require signed release builds.

## Required release work

1. Connect the Capacitor client to the authenticated Cloudflare API.
2. Configure a production OIDC identity provider and secure session lifecycle.
3. Complete private media upload/delivery and image moderation.
4. Complete server-backed likes, matching and messaging, realtime delivery and push notifications.
5. Implement secure hosted €1 checkout and signed payment webhooks; ensure restore/refund handling.
6. Implement block/report workflows with an operational moderation queue and response process.
7. Add account deletion, privacy disclosures, consent, data retention/export and GDPR processes.
8. Complete device testing, accessibility, crash reporting, security testing and store metadata.
9. Submit signed builds for App Store and Google Play review.

## Current status

The iOS workflow in the repository is a preview/compile workflow, not a store release workflow. A successful simulator or unsigned device build does not mean an app is ready for store submission. Android release signing and both store submissions remain outstanding.
