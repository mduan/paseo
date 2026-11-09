async function readPng(getSource: () => Promise<string>): Promise<Blob> {
  const response = await fetch(await getSource());
  if (!response.ok) throw new Error("Unable to read image for the clipboard.");
  const blob = await response.blob();
  if (blob.type === "image/png") return blob;

  const image = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to convert image for the clipboard.");
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((png) => {
        if (png) resolve(png);
        else reject(new Error("Unable to encode image for the clipboard."));
      }, "image/png");
    });
  } finally {
    image.close();
  }
}

export async function copyImageToClipboard(getSource: () => Promise<string>): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("Image copying is unavailable in this browser.");
  }
  // Safari requires the write to start during the click, before image loading completes.
  await navigator.clipboard.write([new ClipboardItem({ "image/png": readPng(getSource) })]);
}
