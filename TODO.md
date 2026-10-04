# TODO

Open work, roughly in the order we plan to take it. Tick items off or delete them as they land.

## World and visuals

- [x] Landmark hover labels (`ui/hoverLabel.js`, `picker.js`) and an `L` key for always-on landmark labels (`ui/landmarkLabels.js`)
- [ ] Small props: signposts at junctions, a bridge or jetty at the lake (bins beside benches are done)
- [x] Sky and weather: butterflies round the flower patches, cloud shadows drawn from the real clouds (`clouds.js`), soft sky gradient with sun glow (`sky.js`). A distance haze was tried and reverted: not visible at these camera distances
- [x] Wind sway on trees, bushes, flowers and grass (`world/wind.js`); lamp light from a baked light map (`world/lampLight.js`); lamps and benches spread over every path and plaza (`_placeProps` in `environment.js`)
- [x] Sun shadows follow the wind (`customDepthMaterial` from `addWind`); ripples round the ducks (`setWaterRipple`)
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

- [ ] Remove the idle gap-fill ("bridge") code in `paths/PathRenderer.js`: the thinned network rarely has parallel paths, so it hardly does anything
- [ ] Live check of chat bubble turn-taking and overlap between nearby conversations (only the logic was tested, never watched in real time)
- [ ] Trees, lamps, benches and the lake still don't block walking agents (only landmarks and other agents do, `agents/collision.js`)
- [ ] Sitting/resting/gathering spots are not checked against the blocked landmark circles
- [ ] Chatting with seated or resting agents (only free walkers can be invited to a gathering)

## Housekeeping

- [ ] Delete the local `backup/pre-clean-main` branch and `refs/original`, then `git gc`
