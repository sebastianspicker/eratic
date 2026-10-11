// Independently written bridge for Spotify's public iframe API (ATTRIBUTION.md).
// Served as a small standalone page, separate from the main app's no-eval CSP.
(() => {
  const id = location.hash.slice(1);
  if (!/^[A-Za-z0-9]{22}$/.test(id) || window.parent === window) return;
  const send = (name, data) => window.parent.postMessage({ channel: "eratic-preview", name, data }, location.origin);
  let controller;
  window.addEventListener("message", event => {
    if (event.source !== window.parent || event.origin !== location.origin || event.data?.channel !== "eratic-preview") return;
    const command = event.data.command;
    if (!["play", "pause", "restart"].includes(command) || !controller) return;
    try { controller[command](); } catch { send("error"); }
  });
  window.onSpotifyIframeApiReady = api => {
    try {
      api.createController(document.getElementById("player"), { uri: `spotify:track:${id}`, width: "100%", height: 152 }, value => {
        controller = value;
        controller.addListener("ready", () => send("ready"));
        controller.addListener("error", () => send("error"));
        controller.addListener("playback_update", ({ data }) => {
          if (!data) return;
          // Relay playback state only. Song metadata never enters the app UI.
          send("playback_update", {
            isPaused: data.isPaused, isBuffering: data.isBuffering,
            position: data.position, duration: data.duration,
          });
        });
      });
    } catch { send("error"); }
  };
  const script = document.createElement("script");
  script.src = "https://open.spotify.com/embed/iframe-api/v1";
  script.onerror = () => send("error");
  document.head.append(script);
})();
