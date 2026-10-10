/** SHA-256 signatures of binaries published in Sylverb's bootloader releases.
 *
 * Digests are calculated from the release assets (not inferred from code patterns). Bank 1
 * is read once and candidate slices are hashed at offset 0 and 0x32000. Release v1.0.0–1.0.2
 * only published the standalone image; dual-boot images first appear in v1.0.3.
 */
export interface BootloaderSignature {
  release: string;
  bytes: number;
  sha256: string;
}

export const STANDALONE_BOOTLOADERS: BootloaderSignature[] = [
  { release: "v1.0.0", bytes: 59208, sha256: "d683f53fc82742a7ff0b757fb0e9d87f3ee46df89506146df53b4492ea5a131e" },
  { release: "v1.0.1", bytes: 67828, sha256: "72354bc2b80697532e945dd3788d0336a45cf6b71fa27ed991b8adf6db439d77" },
  { release: "v1.0.2", bytes: 67888, sha256: "30ce2e56c52571a612a0276fe95ddf398bf22c729f02406a7c8c623866a90bbd" },
  { release: "v1.0.3", bytes: 49628, sha256: "f88a621a6261742fdff09a891ad984675b95e3f1bc435ab365a7537f5f9ee0e4" },
  { release: "v1.0.4", bytes: 49632, sha256: "f830cb28ac6896d6d959afb8a453041f5688a47da01db86e74bb731e1c25acf9" },
  { release: "v1.0.5", bytes: 49676, sha256: "1c66ddb0649931607295542f97bf4f37177a2f4ae5a732834b97cbcd0d3c4097" },
  { release: "v1.0.6", bytes: 49724, sha256: "12524ccefeb5d016d231594c4be50f47de22115361c673378c17385ec93b5af1" },
  { release: "v1.0.7", bytes: 49780, sha256: "be394de38f5d69baf68aa9d29e77c8697b7bbac5ba01138d09c9b8c22f2153f2" },
  { release: "v1.0.8", bytes: 50232, sha256: "fe171fad5160c9a02edab5c435f64fc4ee19e97fcf684abe2fe72a54903d005b" },
];

export const DUAL_BOOTLOADERS: BootloaderSignature[] = [
  { release: "v1.0.3", bytes: 49628, sha256: "d657200fb56197cfd0e1c3ed14f953303f163a309e76a0d4e92d506970bd5c74" },
  { release: "v1.0.4", bytes: 49632, sha256: "bb373203371e21426fd1068d5d73c81411fd07c085b3570dab271a6ea78f8e28" },
  { release: "v1.0.5", bytes: 49676, sha256: "ac55c3e5ed4c7da1cefca399a6497ec6843953e1fb7b6bc3ce3d9a508d24458e" },
  { release: "v1.0.6", bytes: 49724, sha256: "93b5339fded692750ab3d897f1e0236f0339a6c81bfc21bc3a6b62a4f38ac357" },
  { release: "v1.0.7", bytes: 49796, sha256: "4b8661e833a24e57fdc12ae342a2b39188ace7d127063526104b5a01f24a5a9c" },
  { release: "v1.0.8", bytes: 50248, sha256: "43fd718c1a53dda140f29e4025fc8b6d3bfa71f19a710139135f998e4de022d7" },
];
