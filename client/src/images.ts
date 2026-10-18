// images.ts
// Image attachments: shrink in the browser, and turn them into project asset files.

export const MAX_IMAGES = 3;
export const MAX_BASE64_CHARS = 340_000; // must match the server limit
const ALLOWED = new Set(["image/webp", "image/jpeg", "image/png"]);

export interface Attachment {
  id: number;
  name: string;
  mediaType: string;
  data: string; // base64 without the data: prefix
  dataUrl: string;
}

export function assetSlug(name: string): string {
  const base = name.replace(/\.[^.]*$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (base || "image").slice(0, 40);
}

// Pick a file path that does not collide with existing files.
export function assetPathFor(name: string, taken: Set<string>): string {
  const slug = assetSlug(name);
  let path = `src/assets/${slug}.ts`;
  for (let i = 2; taken.has(path); i++) path = `src/assets/${slug}-${i}.ts`;
  return path;
}

export function assetModule(dataUrl: string): string {
  return `export default ${JSON.stringify(dataUrl)};\n`;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read the image."));
    r.readAsDataURL(blob);
  });
}

// Browser only. Shrinks until it fits the size limit. Animated GIFs keep their first frame.
export async function prepareImage(file: File): Promise<Omit<Attachment, "id">> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml")
    throw new Error(`"${file.name}" is not a supported image. Use PNG, JPEG, WebP, or GIF.`);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`Could not open "${file.name}". Try a different image.`);
  }
  let maxDim = 1024;
  let quality = 0.85;
  for (let attempt = 0; attempt < 8; attempt++) {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await toBlob(canvas, "image/webp", quality); // webp keeps transparency
    if (blob && ALLOWED.has(blob.type)) {
      const dataUrl = await blobToDataUrl(blob);
      const data = dataUrl.slice(dataUrl.indexOf(",") + 1);
      if (data.length <= MAX_BASE64_CHARS) {
        bitmap.close?.();
        return { name: file.name, mediaType: blob.type, data, dataUrl };
      }
    }
    maxDim = Math.round(maxDim * 0.75);
    quality = Math.max(0.5, quality - 0.1);
    if (maxDim < 160) break;
  }
  bitmap.close?.();
  throw new Error(`"${file.name}" is too detailed to attach. Try a smaller image.`);
}
