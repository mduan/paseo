import * as Clipboard from "expo-clipboard";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

export async function copyImageToClipboard(getSource: () => Promise<string>): Promise<void> {
  const context = ImageManipulator.manipulate(await getSource());
  let image: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
  try {
    image = await context.renderAsync();
    const result = await image.saveAsync({ format: SaveFormat.PNG, base64: true });
    if (!result.base64) throw new Error("Unable to encode image for the clipboard.");
    await Clipboard.setImageAsync(result.base64);
  } finally {
    image?.release();
    context.release();
  }
}
