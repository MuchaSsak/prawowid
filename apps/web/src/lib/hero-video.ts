// The looping video behind the hero text (public/video/prawdomat-bg-loop.webm). It plays only on
// the input screen: paused in chat (the hero is hidden there), when the tab is hidden, and under
// reduced motion, where the poster frame stays as a still.
export function initHeroVideo(video: HTMLVideoElement | null): void {
  if (!video) return;
  const still = matchMedia("(prefers-reduced-motion: reduce)");

  const sync = () => {
    const play = !still.matches && !document.hidden && !document.body.classList.contains("is-chat");
    if (play) video.play().catch(() => {}); // autoplay refused (e.g. power saving): the poster stays
    else video.pause();
  };

  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  still.addEventListener("change", sync);
  document.addEventListener("visibilitychange", sync);
  sync();
}
