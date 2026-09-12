# firmwaredist fixtures — where these came from

`versions.json`, `manifest.json` and `projects.json` in this directory are **verbatim copies**
of the published examples in the firmware repo:

    game-and-watch-retro-go-sd : docs/examples/{versions,manifest,projects}.json

copied at commit `ba662eec` (docs/examples last touched 2026-09-08). They are the output of a
genuine four-build packer run — nothing in them is invented or hand-edited, and nothing in them
may be hand-edited here either.

The contract they implement is `docs/FIRMWARE_DIST.md` in that same repo, with JSON Schemas in
`schema/firmware-{versions,manifest,projects}.schema.json` and the cross-field rules a schema
cannot express in `scripts/flasher/validate_release_json.py`.

## When the format changes

**Re-copy all three files from `docs/examples/`, do not patch them in place.** The point of
committing the real files is that a format change fails `apps/web/test/firmwaredist.mjs` here,
at build time, instead of surfacing on a device. Editing a fixture to make a test pass defeats
that entirely — if a test fails after a re-copy, the parser
(`apps/web/src/lib/firmwareDist/`) is what needs to change.

Truncated/mutated variants used by the refusal tests are generated **in memory** by the test
file; they are never stored here, so every file in this directory stays byte-identical to
upstream.
