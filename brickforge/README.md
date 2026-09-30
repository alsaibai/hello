# Brickforge

Type anything, or drop in a picture, and get a model made only of real LEGO parts in real colours, shown in 3D, with step-by-step instructions and a BrickLink wanted-list you can upload.

**The AI never places a brick.** Claude only describes *shapes* (box, cylinder, cone, ellipsoid, pyramid, wedge, gable, **slope**, **roof**; add / subtract / paint; mirror). A deterministic program then:

1. rasterises the shapes to a grid of 1 stud × 1 plate cells,
2. packs that grid into real parts: bricks, plates, **45° slopes**, and (optionally) **smooth tiles** on exposed tops, with BrickLink part numbers,
3. checks that every cell is covered exactly once (and that no shape silently did nothing), that the model is **one connected piece** (parts only join by studs, one sitting on another; a slope has studs only on its high end) and that a **build order** exists; it also flags shapes that did nothing and structural risks (tipping, hanging groups),
4. sends any problem back to Claude in plain words ("Loose piece group … at x 8..11 … nearest point is 3 studs away…"), up to 3 rounds. A text-only or cut-off reply gets one nudge; an API failure in a later round keeps the best earlier attempt.

If Claude still can't fix it after 3 rounds, the app drops the loose pieces and says so in the log. It never presents an unchecked model as buildable.

## Use it

```bash
npm install
npm run dev            # http://localhost:5173
```

* Eight ready-made builds work with no key (shape descriptions run through the same pipeline).
* **Photo mosaic, no key:** drop a picture, choose 16–48 studs, press *Photo mosaic*. Two staggered grey base layers plus the picture in real colours (dithered), checked like everything else.
* **Generate with AI:** *Add API key*, paste an Anthropic key, use *Test key* to check it. It is sent only from your browser to `api.anthropic.com` (no server). "Remember on this device" stores it in browser storage; leave it unticked to keep it in memory only. Rate limits and overloads are retried with back-off.
* Options: **Smooth tops (tiles)** swaps fully exposed top plates for tiles; **Build on a baseplate** adds a real baseplate (16×16, 32×32 or 48×48) as step 1 so separate ground-level pieces don't have to join each other; **Common colours only** restricts everything to colours that exist in almost every basic brick and plate.
* Instructions: **Build** view. At most 4 pieces per step; new pieces glow and are outlined, earlier ones are dimmed. Arrow keys step through. Pieces that must be pressed on from underneath are called out.
* **Parts** tab: BrickLink → Wanted → Upload → paste the XML (or download it). CSV too.
* **Checks** tab: every check, warnings (tipping, hanging or off-centre groups, single-stud joints, shapes hidden by later ones), the last AI run.
* **Spec** tab: the shape description; edit it and rebuild locally without a key.
* Four lighting looks (Studio, Daylight, Golden hour, Noir); clear-coated bevelled plastic with studs at real proportions. The build runs in a Web Worker so big models don't freeze the page.

## Test

Needs Node 20+. The browser suites use Chromium: `npx playwright-core install chromium`, or point `CHROMIUM_PATH` at an existing Chrome/Chromium binary.

```bash
npm test               # ~70 unit tests: voxeliser, packer invariants, slopes/roofs, tiles, stability, mosaic, connectivity, build order, BrickLink XML, the AI client and repair loop (fake fetch)
npm run build && npm run preview &
npm run shots          # headless Chromium: every preset, build steps, looks, tiles, roofs, mosaic, tabs, mobile -> ./shots
npm run e2e:a11y       # keyboard, ARIA, dialog focus, no-WebGL fallback, framing at 4 window sizes, mobile layout, contrast
npm run e2e:viewer     # 3D: GPU memory stays flat while stepping and switching, context-loss recovery, lights follow the model, HiDPI
npm run e2e:ai         # the real app against a fake api.anthropic.com: key, test key, image upload, repair round, 529 retry, 401
```

## Deploy (S3 + CloudFront, CloudFormation)

```bash
./deploy.sh my-brickforge    # needs AWS CLI credentials
```

`infra/template.yaml`: private S3 bucket, CloudFront with origin access control, and a restrictive CSP: scripts, styles and connections only from the site itself plus `https://api.anthropic.com`, images from the site and `data:` URLs (the picture thumbnail). `index.html` is uploaded with `no-cache`, hashed assets with a one-year cache. Redeploys with an unchanged template still upload the site.

```bash
./teardown.sh my-brickforge  # empties the bucket, then deletes the stack
```

## Limits (plainly)

* **Parts:** rectangular bricks 1×1…2×8, plates up to 6×6, tiles, and 45° slopes (2×1 and 2×2). No inverted slopes, round/curved parts, arches, wheels, or curved slopes, so domes and spheres are stepped. Slopes rise 1 brick per stud and must share one vertical phase per model.
* **IDs unverified:** part numbers and BrickLink colour IDs are from memory of the catalogue and were **not** checked against BrickLink (not reachable from the build sandbox). Tiles/slopes (`3070b`, `3069b`, `3068b`, `3040b`, `3039`, …) especially deserve a look on your first upload. Not every part exists in every colour; *Common colours only* helps, but availability is not checked.
* **"Buildable"** means: every voxel covered once, one connected piece by stud contact, a valid build order. Tipping and hanging-group warnings are heuristics, not physics.
* **`hollow`:** shapes 3+ bricks tall keep a 1-brick floor and roof; lower shapes become walls only (open top and bottom); curved shapes get 2-stud walls.
* **Size:** up to 48×48 studs, 40 bricks tall, 1500 parts (about 375 steps). Large curved shapes are expensive; the AI is told the cost.
* **Live API not exercised:** the Anthropic call follows the documented Messages API (streaming, tool call, base64 image, retries) but has only run against a fake server, not the live API.
* **Photo mosaic** is flat and needs about 2 extra layers of parts; it is a mosaic, not a 3D model of the photo. For a 3D model of a picture, use the AI path.
