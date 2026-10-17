/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SPOTIFY_CLIENT_ID?: string;
  readonly VITE_MUSICKIT_DEVELOPER_TOKEN?: string;
  // Comma-separated hosts of the Eratic card QR route; empty until a card domain is chosen.
  readonly VITE_ERATIC_CARD_HOSTS?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
// Set by vite.config.ts: "<package version> (<commit>)".
declare const __ERATIC_BUILD__: string;
