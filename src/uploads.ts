import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import { DATA_DIR } from "./db.ts";

// Everything a player-authored case's optional cover upload is allowed to
// be, enforced by actually decoding the bytes with sharp — never by
// trusting the browser-supplied MIME type or the filename's extension,
// both of which are just strings an attacker fully controls. A file that
// fails to decode as one of these formats (including a corrupt real image,
// a renamed non-image, or a format sharp can parse but this app doesn't
// want — SVG, GIF, anything that can carry embedded scripts/animation/
// external references) is rejected before anything is written to disk.
const ALLOWED_INPUT_FORMATS = new Set(["jpeg", "png", "webp"]);

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MiB, per-file
// 16 megapixels: generous for any phone photo, small enough that even a
// single decode can't meaningfully threaten this deploy's 256 MB RAM —
// checked by sharp itself at decode time (limitInputPixels), not estimated
// from the file's declared width/height header, which an attacker also
// controls.
const MAX_INPUT_PIXELS = 16_000_000;
const OUTPUT_MAX_DIMENSION = 1600;
const OUTPUT_DIR = `${DATA_DIR}/uploads/covers`;

export type CoverRejectionReason =
  | "too-large"
  | "unsupported-format"
  | "corrupt"
  | "pixel-limit";

export interface CoverRejection {
  ok: false;
  reason: CoverRejectionReason;
  message: string;
}

export interface CoverAccepted {
  ok: true;
  // A bare filename (e.g. "3f2a....webp"), not a path — stored as-is in
  // puzzles.cover_path and joined against OUTPUT_DIR only by this module,
  // never built from anything the uploader supplied.
  coverPath: string;
}

const REJECTIONS: Record<CoverRejectionReason, string> = {
  "too-large": "That cover image is too large — the limit is 2 MiB.",
  "unsupported-format":
    "That cover image's format isn't supported — use JPEG, PNG, or WebP.",
  corrupt: "That cover image couldn't be read — the file may be corrupt.",
  "pixel-limit": "That cover image's resolution is too high to process.",
};

export function coverRejectionMessage(reason: CoverRejectionReason): string {
  return REJECTIONS[reason];
}

// Validates, decodes, resizes, and re-encodes an uploaded cover to WebP,
// then writes it under OUTPUT_DIR with a fresh random filename — the
// uploader's own filename is used for nothing (not even to pick an
// extension), so a path-traversal or reserved-device-name filename can't
// reach the filesystem at all. Re-encoding through sharp's own pipeline
// (rather than copying the input bytes verbatim) is what actually strips
// EXIF/ICC metadata and guarantees the bytes landing on disk are a real
// decoded-and-recompressed raster image, not whatever the input bytes
// originally were — a corrupt file, an SVG with an embedded <script>, or a
// GIF, all get caught by the decode step before any write happens, not by
// inspecting the claimed MIME type or extension.
export async function processCoverUpload(file: File): Promise<CoverAccepted | CoverRejection> {
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, reason: "too-large", message: REJECTIONS["too-large"] };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  let image;
  let metadata;
  try {
    image = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" });
    metadata = await image.metadata();
  } catch {
    // sharp throws for both "not a decodable image at all" and "exceeds
    // limitInputPixels" with no distinct error class — distinguished below
    // by a second, limit-free metadata-only probe (header/dimensions only,
    // not a full pixel decode) so the error message told to the user is
    // accurate without ever decoding full pixel data for an oversized file.
    return await classifyDecodeFailure(bytes);
  }

  if (!metadata.format || !ALLOWED_INPUT_FORMATS.has(metadata.format)) {
    return { ok: false, reason: "unsupported-format", message: REJECTIONS["unsupported-format"] };
  }

  const outputBytes = await image
    .rotate() // applies and then strips any EXIF orientation tag
    .resize({
      width: OUTPUT_MAX_DIMENSION,
      height: OUTPUT_MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 82 })
    .toBuffer();

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const coverPath = `${randomUUID()}.webp`;
  await writeFile(`${OUTPUT_DIR}/${coverPath}`, outputBytes);
  return { ok: true, coverPath };
}

// Separates "this exceeded the pixel limit" from every other decode
// failure, using a second metadata-only probe with no pixel limit — sharp's
// metadata() reads just the header (width/height/format), not full pixel
// data, so this stays cheap even for a file whose header claims a huge
// image. The real accept/reject pass above never relaxes its own limit;
// this only exists to make the error message accurate.
async function classifyDecodeFailure(bytes: Uint8Array): Promise<CoverRejection> {
  try {
    const meta = await sharp(bytes, { limitInputPixels: false, failOn: "none" }).metadata();
    const pixels = (meta.width ?? 0) * (meta.height ?? 0);
    if (pixels > MAX_INPUT_PIXELS) {
      return { ok: false, reason: "pixel-limit", message: REJECTIONS["pixel-limit"] };
    }
    return { ok: false, reason: "corrupt", message: REJECTIONS.corrupt };
  } catch {
    return { ok: false, reason: "corrupt", message: REJECTIONS.corrupt };
  }
}

// Deletes a just-written cover when the rest of the room-creation request
// fails validation AFTER the file was already processed and saved (e.g. a
// blank title caught by the existing field checks) — so a rejected
// room-creation attempt never leaves an orphaned file under OUTPUT_DIR with
// no puzzle row pointing at it.
export function deleteCover(coverPath: string): void {
  try {
    rmSync(`${OUTPUT_DIR}/${coverPath}`, { force: true });
  } catch {
    // best-effort cleanup only — a failed delete leaves an orphan file,
    // which is a disk-space concern, not a correctness or security one
  }
}

export function coverFilePath(coverPath: string): string {
  return `${OUTPUT_DIR}/${coverPath}`;
}
