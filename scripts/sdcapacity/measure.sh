#!/bin/bash
# Measures FAT32 and exFAT usable capacity for a set of nominal SD card sizes,
# by actually formatting sparse loopback-free image files and reading the
# resulting filesystem metadata back with fsck.fat / dump.exfat.
#
# Run inside the dev container (needs dosfstools + exfatprogs, not present in
# the base image -- see docs/SDCARD_CAPACITY.md for the install command).
# No mounting, no loop devices, no privileges beyond a regular container user.
#
# Usage: bash scripts/sdcapacity/measure.sh [workdir] > raw.json
#
# Emits a JSON array, one object per (nominal size, filesystem) pair, with the
# measured cluster size and usable byte count. scripts/sdcapacity/generate.mjs
# consumes this and adds the safety margin / final shape the app imports.
set -euo pipefail

WORKDIR="${1:-/tmp/sdcapacity-work}"
mkdir -p "$WORKDIR"
cd "$WORKDIR"

# Nominal sizes in decimal GB, matching how cards are labeled and the SD
# Association's own convention (1 GB = 1,000,000,000 bytes -- see the doc for
# why this is the chosen base and how real cards deviate from it).
SIZES_GB=(2 4 8 16 32 64 128 256)

# Partition alignment: SD cards are conventionally imaged with the first
# partition aligned to a 4 MiB erase-block boundary (what the SD Association's
# own SD Formatter and tools like Raspberry Pi Imager do). We reserve one
# 4 MiB block before the partition for the MBR + alignment gap.
ALIGN_BYTES=$((4 * 1024 * 1024))

echo "["
first=1

for gb in "${SIZES_GB[@]}"; do
  nominal_bytes=$((gb * 1000000000))
  # Round the partition size down to a whole sector (512 bytes).
  usable_after_partition=$(( (nominal_bytes - ALIGN_BYTES) / 512 * 512 ))

  for fs in fat32 exfat; do
    img="img_${gb}g_${fs}.bin"
    rm -f "$img"
    truncate -s "$usable_after_partition" "$img"

    if [ "$fs" = "fat32" ]; then
      if ! mkfs.vfat -F32 "$img" >/tmp/mkfs.log 2>&1; then
        echo "SKIP fat32 ${gb}GB: $(cat /tmp/mkfs.log)" >&2
        rm -f "$img"
        continue
      fi
      out=$(fsck.fat -n -v "$img" 2>&1)
      cluster_size=$(echo "$out" | grep 'bytes per cluster' | awk '{print $1}')
      total_clusters=$(echo "$out" | grep 'data clusters' | awk '{print $1}')
      # "img.bin: 0 files, 1/8386558 clusters" (used/total)
      used_clusters=$(echo "$out" | grep 'clusters$' | tail -1 | sed -E 's#.*, ([0-9]+)/([0-9]+) clusters#\1#')
      free_clusters=$((total_clusters - used_clusters))
      usable_bytes=$((free_clusters * cluster_size))
    else
      if ! mkfs.exfat -L GNW "$img" >/tmp/mkfs.log 2>&1; then
        echo "SKIP exfat ${gb}GB: $(cat /tmp/mkfs.log)" >&2
        rm -f "$img"
        continue
      fi
      out=$(dump.exfat "$img" 2>&1)
      cluster_size=$(echo "$out" | grep 'Cluster size:' | awk '{print $NF}')
      free_clusters=$(echo "$out" | grep 'Free Clusters:' | awk '{print $NF}')
      usable_bytes=$((free_clusters * cluster_size))
    fi

    rm -f "$img"

    if [ "$first" = "1" ]; then first=0; else echo ","; fi
    cat <<EOF
  {
    "nominalGB": $gb,
    "filesystem": "$fs",
    "nominalBytes": $nominal_bytes,
    "partitionAlignmentBytes": $ALIGN_BYTES,
    "usableAfterPartitionBytes": $usable_after_partition,
    "clusterSizeBytes": $cluster_size,
    "usableBytes": $usable_bytes
  }
EOF
  done
done
echo "]"
