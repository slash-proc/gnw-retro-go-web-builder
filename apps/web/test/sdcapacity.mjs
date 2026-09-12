// Guards apps/web/src/lib/data/sdCapacity.json: it must parse, cover every
// nominal size the app is supposed to offer, and every row's arithmetic must
// be internally consistent. It does not re-run mkfs/dosfstools (those tools
// aren't guaranteed present outside the dev container -- see
// docs/SDCARD_CAPACITY.md), so it re-derives everything that IS pure
// arithmetic (the partition-alignment subtraction, the margin subtraction,
// cluster-size divisibility) and fails if the committed JSON drifts from that
// arithmetic or from scripts/sdcapacity/generate.mjs's own constants.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataPath = join(__dirname, "..", "src", "lib", "data", "sdCapacity.json");

const EXPECTED_SIZES_GB = [2, 4, 8, 16, 32, 64, 128, 256];
const EXPECTED_FILESYSTEMS = ["fat32", "exfat"];

let failures = 0;
function fail(msg) {
  failures++;
  console.error(`FAIL: ${msg}`);
}

let raw;
try {
  raw = readFileSync(dataPath, "utf8");
} catch (e) {
  fail(`could not read ${dataPath}: ${e.message}`);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(raw);
} catch (e) {
  fail(`sdCapacity.json does not parse as JSON: ${e.message}`);
  process.exit(1);
}

if (typeof data.safetyMarginBytes !== "number" || data.safetyMarginBytes <= 0) {
  fail(`safetyMarginBytes missing or not a positive number: ${data.safetyMarginBytes}`);
}
if (typeof data.partitionAlignmentBytes !== "number" || data.partitionAlignmentBytes <= 0) {
  fail(`partitionAlignmentBytes missing or not a positive number: ${data.partitionAlignmentBytes}`);
}
if (!Array.isArray(data.sizes)) {
  fail("sizes is not an array");
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}

const seenGB = new Set();
for (const row of data.sizes) {
  seenGB.add(row.nominalGB);

  const expectedNominalBytes = row.nominalGB * 1000000000;
  if (row.nominalBytes !== expectedNominalBytes) {
    fail(
      `${row.nominalGB}GB: nominalBytes ${row.nominalBytes} != ${row.nominalGB} * 1_000_000_000 (${expectedNominalBytes})`
    );
  }

  const expectedAfterPartition =
    Math.floor((row.nominalBytes - data.partitionAlignmentBytes) / 512) * 512;
  if (row.usableAfterPartitionBytes !== expectedAfterPartition) {
    fail(
      `${row.nominalGB}GB: usableAfterPartitionBytes ${row.usableAfterPartitionBytes} != nominalBytes - partitionAlignmentBytes, sector-rounded (${expectedAfterPartition})`
    );
  }

  if (!row.filesystems || typeof row.filesystems !== "object") {
    fail(`${row.nominalGB}GB: missing filesystems object`);
    continue;
  }

  for (const fs of EXPECTED_FILESYSTEMS) {
    const entry = row.filesystems[fs];
    if (!entry) {
      fail(`${row.nominalGB}GB: missing filesystem "${fs}"`);
      continue;
    }
    if (!Number.isInteger(entry.clusterSizeBytes) || entry.clusterSizeBytes <= 0) {
      fail(`${row.nominalGB}GB ${fs}: clusterSizeBytes invalid (${entry.clusterSizeBytes})`);
    }
    if (!Number.isInteger(entry.usableBytes) || entry.usableBytes <= 0) {
      fail(`${row.nominalGB}GB ${fs}: usableBytes invalid (${entry.usableBytes})`);
    }
    if (entry.usableBytes % entry.clusterSizeBytes !== 0) {
      fail(
        `${row.nominalGB}GB ${fs}: usableBytes (${entry.usableBytes}) is not a whole number of clusters (${entry.clusterSizeBytes})`
      );
    }
    if (entry.usableBytes > row.usableAfterPartitionBytes) {
      fail(
        `${row.nominalGB}GB ${fs}: usableBytes (${entry.usableBytes}) exceeds usableAfterPartitionBytes (${row.usableAfterPartitionBytes})`
      );
    }
    const expectedAfterMargin = entry.usableBytes - data.safetyMarginBytes;
    if (entry.usableAfterMarginBytes !== expectedAfterMargin) {
      fail(
        `${row.nominalGB}GB ${fs}: usableAfterMarginBytes ${entry.usableAfterMarginBytes} != usableBytes - safetyMarginBytes (${expectedAfterMargin})`
      );
    }
    if (entry.usableAfterMarginBytes <= 0) {
      fail(`${row.nominalGB}GB ${fs}: usableAfterMarginBytes is not positive -- margin exceeds capacity`);
    }
  }
}

for (const gb of EXPECTED_SIZES_GB) {
  if (!seenGB.has(gb)) fail(`missing nominal size ${gb}GB`);
}
for (const gb of seenGB) {
  if (!EXPECTED_SIZES_GB.includes(gb)) fail(`unexpected nominal size ${gb}GB not in the covered list`);
}

// --- The module that READS the table, driven for real -----------------------------------------
// Everything above guards the data. This drives `sdCapacity.ts`, because the conservative rule
// and the validation refusal are decisions and deserve to be exercised rather than described.
const { mkdtempSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { pathToFileURL } = await import("node:url");
const esbuild = await import("esbuild");
const outDir = mkdtempSync(join(tmpdir(), "sdcapacity-"));
await esbuild.build({
  entryPoints: [join(__dirname, "..", "src", "lib", "sdCapacity.ts")],
  outfile: join(outDir, "sdCapacity.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  logLevel: "warning",
  loader: { ".json": "json" },
});
const cap = await import(pathToFileURL(join(outDir, "sdCapacity.js")).href);

const eq = (got, want, label) => {
  if (got !== want) fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// The sizes come FROM the table, so the offered list and the figures cannot drift apart.
eq(cap.SD_NOMINAL_SIZES_GB.join(","), EXPECTED_SIZES_GB.join(","), "the offered sizes are the table's sizes");
eq(cap.SAFETY_MARGIN_BYTES, data.safetyMarginBytes, "the margin is the table's, not a second copy");

// THE CONSERVATIVE RULE, now unconditional. The user is never asked which filesystem, so these
// take no argument: every figure is the conservative side of the measured pair. FAT32 being the
// lower one is asserted rather than assumed, because the module minimises over the table rather
// than hardcoding "fat32".
for (const row of data.sizes) {
  const f = row.filesystems.fat32.usableAfterMarginBytes;
  const e = row.filesystems.exfat.usableAfterMarginBytes;
  eq(cap.usableBytesFor(row.nominalGB), Math.min(f, e), `${row.nominalGB}GB takes the smaller usable figure`);
  if (f >= e) {
    fail(`${row.nominalGB}GB: FAT32 is not the smaller figure, so "conservative" no longer means FAT32`);
  }
  // Cluster goes the OTHER way: bigger clusters waste more, so the pessimistic answer is the max.
  const cf = row.filesystems.fat32.clusterSizeBytes;
  const ce = row.filesystems.exfat.clusterSizeBytes;
  eq(cap.clusterSizeFor(row.nominalGB), Math.max(cf, ce), `${row.nominalGB}GB takes the LARGER cluster`);
}

// NOTHING SELECTS A FILESYSTEM ANY MORE. The difference the question could have made is smaller
// than the margin already withheld at every size, which is WHY it is not asked -- so this pins
// the reason rather than only the removal, and fails if a regenerated table ever makes the
// question matter again.
for (const row of data.sizes) {
  const spread =
    row.filesystems.exfat.usableAfterMarginBytes - row.filesystems.fat32.usableAfterMarginBytes;
  if (!(spread < data.safetyMarginBytes)) {
    fail(
      `${row.nominalGB}GB: the filesystems differ by ${spread} B, which is no longer inside the ` +
        `${data.safetyMarginBytes} B margin -- asking the user again would change the figure`,
    );
  }
}
// The capacity helpers take ONE argument: a size. A second one would be a filesystem, and there
// is no longer a filesystem to pass.
eq(cap.usableBytesFor.length, 1, "usableBytesFor takes only a size");
eq(cap.clusterSizeFor.length, 1, "clusterSizeFor takes only a size");
eq(cap.likelyFilesystem, undefined, "there is no filesystem guess, because nothing asks");
eq(cap.SD_FILESYSTEMS, undefined, "the filesystem list is not exported: it is not a choice");

// A size the table does not cover is an ABSENT answer, never a zero that would read as a full card.
eq(cap.usableBytesFor(12), null, "an uncovered size has no figure");
eq(cap.usableBytesFor(0), null, "zero is not a size");

// VALIDATION. A size below what the walk already SAW is a claim the card has disproved.
const small = cap.usableBytesFor(2);
eq(cap.sizeFitsUsed(2, small - 1), true, "a size that fits what is on the card is offerable");
eq(cap.sizeFitsUsed(2, small), true, "exactly full still fits");
eq(cap.sizeFitsUsed(2, small + 1), false, "a card already holding more than this size refuses it");
eq(cap.sizeFitsUsed(256, small + 1), true, "a bigger size still fits the same contents");
eq(cap.sizeFitsUsed(12, 0), false, "a size with no figure cannot be validated, so it is not offered");
// A TRUNCATED WALK STILL REFUSES: a floor proves the card holds at least that much. There is no
// `truncated` parameter, which is the point -- there is no branch for it to drive.
eq(cap.sizeFitsUsed.length, 2, "validation takes a size and a used total, and no truncated flag: a floor is enough to refuse");

// CLUSTER SLACK. Raw bytes understate a card of many small files, and by a lot.
eq(cap.bytesOnDisk([1, 1, 1], 32768), 98304, "each file rounds up to a whole cluster");
eq(cap.bytesOnDisk([32768], 32768), 32768, "an exact multiple does not round up");
eq(cap.bytesOnDisk([100], 0), 100, "a cluster size of zero falls back to raw bytes rather than dividing by it");
// 3,000 covers of 12 KB against exFAT's 128 KiB cluster: the slack dwarfs the safety margin.
const slack = cap.bytesOnDisk(Array(3000).fill(12 * 1024), 131072) - 3000 * 12 * 1024;
if (!(slack > data.safetyMarginBytes)) {
  fail(`cluster slack on a realistic library (${slack}) should dwarf the margin (${data.safetyMarginBytes})`);
}


if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log(`sdcapacity.mjs: OK (${data.sizes.length} sizes x ${EXPECTED_FILESYSTEMS.length} filesystems, module driven)`);
