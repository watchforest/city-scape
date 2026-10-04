# TODO

Open work, roughly in the order we plan to take it. Tick items off or delete them as they land.

## World and visuals

- [x] Landmark hover labels (`ui/hoverLabel.js`, `picker.js`) and an `L` key for always-on landmark labels (`ui/landmarkLabels.js`)
- [ ] Small props: signposts at junctions, a bridge or jetty at the lake (bins beside benches are done)
- [x] Sky and weather: butterflies round the flower patches, cloud shadows drawn from the real clouds (`clouds.js`), soft sky gradient with sun glow (`sky.js`). A distance haze was tried and reverted: not visible at these camera distances
- [x] Wind sway on trees, bushes, flowers and grass (`world/wind.js`); lamp light from a baked light map (`world/lampLight.js`); lamps and benches spread over every path and plaza (`_placeProps` in `environment.js`)
- [x] Sun shadows follow the wind (`customDepthMaterial` from `addWind`); ripples round the ducks (`setWaterRipple`)
- [x] Ducks swim between spots with a wake that crossfades with their still-water rings, and never collide (`wildlife.js`, `lake.js`)
- [x] A gate with a customisable sign (`site.json` → `gateText`) and an entrance path to the network (`paths/gatePath.js`, `world/gate.js`)
- [ ] Let people (or visitors) walk in through the gate: its path is not in the nav graph yet
- [ ] Cloud shadows only fall on the ground, not on trees
- [ ] Water: ripples near the shore, a fountain on a plaza
- [ ] Other datasets (`?data=<name>`, `npm run`-less: `node scripts/genTestData.mjs`; tried tiny/medium/large/huge/odd/single/empty): the huge set (80 landmarks, 400 people) is ~9M triangles / 2100 draw calls, mostly the characters (400 × 8.8k × 2 passes) — needs an agent level of detail (cheaper far characters, no shadow for far ones) before anything that size is used; a project with no members has no paths and sits alone; maybe warn in the console about people/projects that reference each other badly (unknown ids, empty projects)
- [ ] Night: lit windows or lights on landmarks, moon reflection on the lake (the ground glow under landmarks was removed: it didn't look good)
- [x] Flower patches bigger and denser
- [ ] Shading follow-ups: tune `CONTACT_SHADE` / cloud shadow strengths on a real display; maybe shade landmarks (vertex gradient) like the tree crowns

- [x] Replace procedural trees, rocks and grass with the decor models (`npm run bake-decor`). Benches, lamp posts and birds use decor models too, and so do bushes, flowers, mushrooms, logs, the football goal + ball (with a mown square) and butterflies. Still procedural: ducks, bins, landmarks. Ideas: more decor packs (bushes, flowers, props), per-variant weights by terrain height or distance from paths

## Performance

- [ ] Review the render budget again now that vegetation, bushes and the path texture have been added (`renderer.info`, GPU time; see "Performance" in CLAUDE.md)

## Small technical items

- [x] Removed the "bridge" ribbon code in `paths/PathRenderer.js` (it made none for the default, medium or large data)
- [x] Chat bubbles watched in real time for 45 s: at most 3 at once, overlapping in ~1% of frames (brief, as one fades as another starts)
- [x] Trunks, lamp posts, benches, rocks, bushes (`registerSolid`) and the lake now block walking agents (`agents/collision.js`)
- [x] Landmark circles are registered as obstacles once agents exist, so sitting/resting/gathering spots (and walks to them) avoid landmarks
- [x] Walkers go and chat with people sitting on a bench or the grass (`VisitingState`); people resting on the grass are asleep and are left alone
- [ ] Visits that fail: about a quarter of tries find no free spot in front of the sitter or the sitter gets up first — could try the sides/back or a nearer sitter

## Housekeeping

- [ ] Delete the local `backup/pre-clean-main` branch and `refs/original`, then `git gc`
