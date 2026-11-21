# Blender background scenes: the build prompt
The prompt we give a Blender-capable agent (e.g. Claude with a Blender MCP) to build the four looping low-poly background scenes for the Prawdomat web app and pitch. Scenes picked by the user from a brainstorm: 1 (armchair), 2 (kitchen table), 5 (park bench), 8 (newspaper kiosk). Style reference: the YouTube channel Fern ("armchair documentaries", 4M+ subscribers, 3D reconstructions; source: https://www.pluggedin.com/youtube-reviews/fern/). Fern publishes no breakdown of the pipeline, so the style notes below are our reading of the videos (Inference); the agent must check them against real frames.

Status (2026-11-21): the rendered loop is live behind the web app's hero text as `apps/web/public/video/prawdomat-bg-loop.webm` (see [codebase](../architecture/codebase.md)).

Copy everything below the line into the agent.

---

# Task: four looping low/medium-poly background scenes in Blender, Fern-inspired

You are a senior 3D environment artist and cinematographer working in Blender. Build **one Blender file** that contains four short, quiet, cinematic scenes. They will play behind the website of **Prawdomat**, a free Polish fact-checking service for ordinary citizens, including older people and people with low digital skills. The core idea of the product is "evidence, not opinions": a normal person meets a rumour, checks it on their phone, calmly, in everyday life.

The final deliverable is a **looping MP4** in which each scene holds for 2-3 seconds with a slow camera move, then **hard-cuts** (jump cut) to the next scene, and after the last scene cuts back to the first. **Do NOT render or export the animation or the MP4.** We do the final render ourselves. Your job ends with a clean, fully set-up, saved `.blend` file that would produce exactly that video when rendered.

## 1. Research the style first (do this before modelling)

The style is inspired by the YouTube channel **Fern** (youtube.com/@Fern-TV). Before you build anything:

1. Look at several Fern videos and thumbnails (search "Fern documentary", the channel page, and frames from popular videos). Collect **6-10 reference frames** and write down, for each, what you see: palette, light direction and colour, fog or haze, how faces and figures are treated, how much geometric detail there is, the lens and depth of field, and how the camera moves.
2. Check your notes against the starting description below. Where the real frames disagree, **follow the real frames** and say what you changed.
3. If you cannot reach the web, say so explicitly and work from the description below. Do not claim you looked at references you did not see.

Our reading of the Fern look (verify it):

- **Faceless, mannequin-like people.** Smooth, simplified human figures with no eyes, mouth or hair strands. The head is an egg or capsule shape. Clothes are simple shells in one flat colour, with only big folds. Correct adult proportions, not chibi or cartoon.
- **Clean, simplified geometry.** Low to medium poly with bevelled edges and soft shading, not jagged retro low-poly. Objects are recognisable from their silhouettes. No textures, no photo detail, just solid materials with a little roughness variation.
- **Muted, cinematic palette.** Desaturated cool shadows (blue-grey, slate, teal), with **one warm motivated light source** (lamp, low sun, street light) as the accent. Never oversaturated.
- **Atmosphere.** Soft volumetric haze or fog, strong but soft directional light, deep soft shadows, gentle bloom on practical lights, a slight vignette.
- **Documentary camera.** Slow, steady, motivated moves (push-in, lateral track, slow orbit, gentle crane). Long-lens feel (35-85 mm), shallow depth of field. No shake, no fast moves.
- **Calm, serious, a little melancholic, but warm.** It should feel like a quiet moment in a real life.

## 2. Hard rules (non-negotiable)

1. **No text anywhere.** No letters, numbers, logos, brand names, signs, labels, captions or UI. Newspapers carry grey line blocks and grey image rectangles, never glyphs. Phone screens are a plain, soft glowing rectangle (slightly cool white, low emission), with **no content**.
2. **No icons, speech bubbles, thought clouds, arrows, holograms, glowing threads or other abstract overlays.** Only physical objects that could exist in the room or street.
3. **Low/medium poly, faceless figures**, as described above. No realistic faces, no hair cards, no skin pores.
4. **Neutral, inclusive, non-political.** No flags, party symbols, religious symbols or recognisable real people or places. The setting is a believable **Polish / Central European everyday** one: a block-of-flats ("blok") interior, a plain park, a generic street kiosk. Keep it generic, not a stereotype.
5. **Do not render the animation and do not export the MP4.** Single preview stills for checking your work (section 6) are allowed and expected.
6. **One file, clean and named.** Use one collection per scene, with readable object names (`S1_Armchair`, `S1_Lamp_Key` and so on). No leftover default cube, unused materials or hidden junk.

## 3. Technical setup

- **Blender version:** whatever is installed. Report it. Use **EEVEE** (Next/Legacy, whichever exists) as the render engine, so our final render is fast. Volumetrics, soft shadows and bloom (or the compositor glare node if bloom is a compositor effect in this version) should be on. Configure Cycles fallback settings only if EEVEE cannot produce the look; if you do, report why.
- **Output settings** (set them, do not render): 1920 × 1080, 16:9, **30 fps**, H.264 MP4, quality high. Colour management: AgX (or Filmic if AgX is missing), with a "Medium High Contrast"-like look. Set the output path to `//render/prawdomat_bg_loop.mp4`.
- **Timeline:** four shots of **75 frames (2.5 s) each**, 300 frames in total (frames 1-300). Shot 1 = frames 1-75, shot 2 = 76-150, shot 3 = 151-225, shot 4 = 226-300. Frame 300 is followed by frame 1 again (loop), which is just another hard cut, so no crossfade or seamless loop is needed.
- **Cuts:** use **one camera per scene**, with timeline markers bound to the cameras (Marker > Bind Camera to Markers) at frames 1, 76, 151 and 226. Every cut must be instant, with no blending frame.
- **Scene placement:** build the four scenes far apart in world space (for example 100 m apart on X), so no geometry, light or fog from one scene ever appears in another camera. Use light linking, or separate world fog volumes per scene, if lights would leak.
- **Camera motion:** for each camera, a slow move over its 75 frames, keyframed with a **linear or very gentle ease** (no ease-in that makes the move look frozen at the start of the shot). Movement should be small (roughly 0.3-1.0 m of travel, or 5-10° of orbit), so it reads as "a still image that breathes". Add a slow, matching focus pull only if it helps. The camera is in motion on frame 1 of each shot and still moving on the last frame (no hold).
- **Depth of field:** on, with a focus object (an empty) on the hero element. f-stop around 2.0-4.0, so the background softens but stays readable.
- **Website layout constraint:** these frames sit behind page text. Keep the **hero subject in the right third** of the frame. The **left 40%** of the frame should be calm: darker, low detail, soft focus, no strong highlights. That is where text will go. Check this on every shot.
- **Performance:** keep the whole file light (target under ~300k triangles total). Use bevel modifiers or shading instead of heavy subdivision.

## 4. Shared art direction

- **Palette:** base slate blue / blue-grey / desaturated teal, warm off-white walls, muted wood. **One warm accent** per scene (amber lamp, low orange sun, sodium street light). The phone screen is the only cool point light near a face.
- **People:** the same mannequin style in all four scenes. Clothing colours are muted (navy, mustard, rust, olive, grey) and differ between characters, so the scenes feel like different households. Poses are natural and relaxed, with readable silhouettes. Hands can be simplified mitten-style but must hold the phone convincingly.
- **Phones:** simple rounded slabs. The screen glows softly and casts a faint cool light on the hands and the front of the face shape.
- **Lighting recipe:** a key from the motivated warm practical light, cool ambient fill from the world (low strength), a rim light to separate figures from the background, and volumetric haze so light shafts read softly. Shadows are soft but present.
- **Finishing:** a slight vignette, gentle bloom on practical lights, subtle film grain via the compositor (keep it light, it must compress well in MP4). No chromatic aberration, no lens flares.

## 5. The four scenes

Order in the timeline: **1 → 2 → 3 → 4 → (loop)**.

### Shot 1 (frames 1-75): the armchair by the window. Who we serve.
An older person (60-75, posture slightly rounded, cardigan) sits in a worn armchair in a small block-of-flats living room in the evening. They hold a phone a little away from their face, the way people with presbyopia do. Glasses are pushed up on their head, or they are holding them. Beside them: a small side table with a cup of tea on a saucer, a folded newspaper (line blocks only), and a fringed standing lamp that is the warm key light. Behind them: a window with net curtains, deep blue dusk outside, with the faint, out-of-focus lit windows of the block opposite. Details: a radiator under the window, a houseplant, a patterned rug (simple geometric pattern made in geometry or vertex colour, no texture).
**Camera:** slow push-in from a medium-wide shot towards the person and phone, from a slightly low three-quarter angle. Focus on the phone and hands.

### Shot 2 (frames 76-150): the kitchen table. Checking together.
A small, warm kitchen. Three generations at a table: a grandparent, a parent and a teenager, all leaning towards **one phone lying on the table** that the teenager is pointing at. The mood is attentive and calm, not an argument. On the table: mugs, a bread board with a loaf, a sugar bowl, a folded newspaper. The kitchen has simple cabinets, a tiled backsplash (a geometric grid only), a kettle and a window with dusk light. The warm key is a pendant lamp over the table, casting a pool of light. Cooler light comes from the window.
**Camera:** slow lateral track (left to right), slightly above table height, with the figures framed in the right half and the phone as the focus point.

### Shot 3 (frames 151-225): the park bench. Sharing the result.
Late afternoon in an ordinary city park in early autumn. Two people on a simple wooden bench, one showing the phone to the other, who leans in. Low warm sun behind and to the side gives long shadows and a rim light, with light haze between the trees. Around them: a path, a litter bin, simple low-poly trees with a few fallen leaves on the ground, and an old-fashioned park lamp post (unlit). The background is softly out of focus, with distant blocks of flats as silhouettes.
**Camera:** very slow orbit (about 8°) around the bench at eye level, with a long lens. Focus on the phone between the two people.

### Shot 4 (frames 226-300): the newspaper kiosk. Old and new sources.
Dusk on a street corner. A small generic street kiosk (a boxy booth with a glass front and a small awning, no brand, no signage) with newspapers and magazines on racks: every cover is just blocks of muted colour and grey lines. One person stands at the kiosk holding a phone in one hand and a folded newspaper in the other, looking at the phone. The street light above is the warm sodium key. The kiosk's interior light is a second, cooler and dimmer source. Wet pavement with soft reflections (a roughness variation is enough), a curb, a bollard, and blurred blocks of flats behind.
**Camera:** slow push-in combined with a slight crane down, ending with the person and the phone in the right third. Focus on the phone.

## 6. Self-evaluation loop (mandatory)

You must **look at your own work** and fix it, not just build it blind.

1. After each scene's blockout, after lighting it and after the final polish, capture a **preview still from that scene's camera** at the start (first frame), the middle and the last frame of its shot. Use a viewport/camera screenshot, or a single-frame still render at reduced samples. Never render the animation.
2. Look at each still critically and score it 1-5 against this checklist. Fix anything below 4 and recheck.
   - **Readability:** within one second, can you tell who is there and what they are doing? Is the phone clearly in the hand and the focal point?
   - **Style:** faceless mannequins, clean low/medium poly, muted palette with one warm accent, haze. Does it look like the reference frames you collected?
   - **Hard rules:** zero text, glyphs, logos, icons or bubbles anywhere in frame, including the background, newspapers and screens.
   - **Layout:** subject in the right third; the left ~40% is calm and dark enough for white page text to be legible on top.
   - **Composition and light:** a clear focal point, depth (foreground, midground, background), shadows that are not muddy, no blown highlights, no pitch-black areas without detail.
   - **Technical:** no intersecting or floating geometry, no visible scene edges or empty void at any frame of the move, no light or fog leaking from other scenes, correct DOF focus, no flickering shadows.
   - **Motion:** compare first and last frame. Is the move noticeable but slow and calm? Is the camera never static and never jerky?
3. Check the **cuts and the loop**: frames 75→76, 150→151, 225→226 and 300→1 must each switch camera instantly, and the scenes should feel like one family (same palette logic, same figure style, similar exposure).
4. Save after each scene. Keep the stills you captured in `//previews/` with names like `S1_f001.png`, `S1_f038.png`, `S1_f075.png`.

## 7. What to hand back

1. The saved `.blend` file (path), set up so that rendering the animation produces the 300-frame looping MP4. Again: **do not render it**.
2. A short report:
   - the Fern reference frames you looked at, and what you took from them (or a clear note that you couldn't access them),
   - per shot: the final preview stills (start, middle, end), the camera move, focal length and f-stop, and your final checklist scores,
   - anything you could not do or would improve with more time,
   - the Blender version, render engine, triangle count and an estimate of final render time per frame.
