// The looping video behind the hero text (public/video/prawdomat-bg-loop.webm). It plays only on
// the input screen: paused in chat (the hero is hidden there), when the tab is hidden, and under
// reduced motion, where the poster frame stays as a still.
// Started by index.astro after page load, once the backdrop has checked the GPU: the ~0.8 MB file is
// not fetched before then (preload="none", no autoplay attribute), so it never competes with the
// fonts and the poster, and reduced-motion visitors never download it. Without a GPU (`gpu` false:
// software rendering, e.g. GPU-less machines and PageSpeed's test servers) decoding the video and
// compositing the blended, animated grain would eat the CPU, so the poster stays as a still there.
export function initHeroVideo(video: HTMLVideoElement | null, gpu: boolean): void {
  if (!video || !gpu) return;
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
  // The film grain (.has-grain::before in global.css) one frame later: its SVG turbulence is the
  // most expensive thing to paint, and together with starting playback it forced one long task.
  requestAnimationFrame(() => video.parentElement?.classList.add("has-grain"));
}
