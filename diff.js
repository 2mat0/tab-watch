(() => {
  // A cell changes when at least 8% of its pixels (and at least four) differ
  // by more than 24 levels in any RGB channel. PNG supplies lossless pixels.
  const CELL_CSS_PX = 32;
  const CHANNEL_TOLERANCE = 24;
  const CHANGED_FRACTION = 0.08;
  const MIN_CHANGED_PIXELS = 4;

  async function readPng(png) {
    const binary = atob(png.slice(png.indexOf(",") + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    try {
      const canvas = new OffscreenCanvas(image.width, image.height);
      const context = canvas.getContext("2d", { alpha: false });
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height);
    } finally {
      image.close();
    }
  }

  async function compare(beforePng, afterPng, viewport) {
    const [before, after] = await Promise.all([readPng(beforePng), readPng(afterPng)]);
    const { width, height, data: newPixels } = after;
    if (before.width !== width || before.height !== height) return null;
    const oldPixels = before.data;
    const cellWidth = Math.max(1, Math.round(CELL_CSS_PX * width / viewport.width));
    const cellHeight = Math.max(1, Math.round(CELL_CSS_PX * height / viewport.height));
    const regions = [];

    for (let y = 0; y < height; y += cellHeight) {
      const bottom = Math.min(y + cellHeight, height);
      for (let x = 0; x < width; x += cellWidth) {
        const right = Math.min(x + cellWidth, width);
        const threshold = Math.max(MIN_CHANGED_PIXELS,
          Math.ceil((right - x) * (bottom - y) * CHANGED_FRACTION));
        let count = 0;
        for (let row = y; row < bottom && count < threshold; row++) {
          const end = (row * width + right) * 4;
          for (let i = (row * width + x) * 4; i < end && count < threshold; i += 4) {
            if (Math.abs(oldPixels[i] - newPixels[i]) > CHANNEL_TOLERANCE ||
                Math.abs(oldPixels[i + 1] - newPixels[i + 1]) > CHANNEL_TOLERANCE ||
                Math.abs(oldPixels[i + 2] - newPixels[i + 2]) > CHANNEL_TOLERANCE) count++;
          }
        }
        if (count >= threshold) regions.push({ x, y, width: right - x, height: bottom - y });
      }
    }
    return { width, height, regions };
  }

  globalThis.tabWatchCompare = compare;
})();
