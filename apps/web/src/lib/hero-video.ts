// The looping video behind the hero text (public/video/prawdomat-bg-loop.webm). It plays only on
// the input screen: paused in chat (the hero is hidden there), when the tab is hidden, and under
// reduced motion, where the poster frame stays as a still.
// The ~0.8 MB file is not fetched until the page has loaded (preload="none", no autoplay attribute):
// the poster covers the first paint, so the video no longer competes with the fonts and the poster
// for bandwidth, and reduced-motion visitors never download it at all.
export function initHeroVideo(video: HTMLVideoElement | null): void {
  if (!video) return;
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  let loaded = document.readyState === "complete";

  const sync = () => {
    const play = loaded && !still.matches && !document.hidden && !document.body.classList.contains("is-chat");
    if (play) video.play().catch(() => {}); // autoplay refused (e.g. power saving): the poster stays
    else video.pause();
  };

  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  still.addEventListener("change", sync);
  document.addEventListener("visibilitychange", sync);
  // The film grain (.has-grain::before in global.css) is also added only after load: its SVG
  // turbulence is the most expensive thing to paint, so it stays out of the first paint.
  const onLoad = () => {
    loaded = true;
    video.parentElement?.classList.add("has-grain");
    sync();
  };
  if (loaded) onLoad();
  else addEventListener("load", onLoad, { once: true });
}
