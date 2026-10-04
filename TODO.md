# TODO

Open work, roughly in the order we plan to take it. Tick items off or delete them as they land.

## World and visuals

- [x] Landmark hover labels (`ui/hoverLabel.js`, `picker.js`)
- [ ] Small props: signposts at junctions, a bridge or jetty at the lake (bins beside benches are done)
- [ ] Sky and weather: better clouds, butterflies (birds are done; a distance haze was tried and reverted: not visible at these camera distances)
- [ ] Water: ripples near the shore, a fountain on a plaza (ducks are done)
- [ ] Night: lit windows or lights on landmarks, moon reflection on the lake (the ground glow under landmarks was removed: it didn't look good)
- [x] Flower patches bigger and denser
- [ ] Shading follow-ups: tune `CONTACT_SHADE` / cloud shadow strengths on a real display; maybe shade landmarks (vertex gradient) like the tree crowns

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
