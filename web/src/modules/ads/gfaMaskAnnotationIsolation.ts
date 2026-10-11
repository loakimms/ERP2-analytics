export const GFA_UI_ANNOTATION_RGB = { r: 34, g: 197, b: 94 } as const;
export const GFA_UI_ANNOTATION_ALPHA = 0.58;
export const GFA_UI_ANNOTATION_STROKE_STYLE = `rgba(${GFA_UI_ANNOTATION_RGB.r}, ${GFA_UI_ANNOTATION_RGB.g}, ${GFA_UI_ANNOTATION_RGB.b}, ${GFA_UI_ANNOTATION_ALPHA})`;
export const GFA_SEMANTIC_MASK_STROKE = '#ffffff';

export type MaskBrushEditorHandle = {
	exportSemanticMaskBlob: () => Promise<Blob>;
	clearLayers: () => void;
};

export function isUiAnnotationRgb(r: number, g: number, b: number, tolerance = 18): boolean {
	return (
		Math.abs(r - GFA_UI_ANNOTATION_RGB.r) <= tolerance &&
		Math.abs(g - GFA_UI_ANNOTATION_RGB.g) <= tolerance &&
		Math.abs(b - GFA_UI_ANNOTATION_RGB.b) <= tolerance &&
		g > r &&
		g > b
	);
}

export function isPaintedSemanticPixel(r: number, g: number, b: number, a: number): boolean {
	return a > 10 && (r > 10 || g > 10 || b > 10);
}

export function sanitizeSemanticMaskRgba(data: Uint8ClampedArray): {
	data: Uint8ClampedArray;
	paintedPixels: number;
	visibleGreenPixelsBefore: number;
	visibleGreenPixelsAfter: number;
} {
	const out = new Uint8ClampedArray(data.length);
	let paintedPixels = 0;
	let visibleGreenPixelsBefore = 0;
	for (let i = 0; i < data.length; i += 4) {
		const r = data[i] ?? 0;
		const g = data[i + 1] ?? 0;
		const b = data[i + 2] ?? 0;
		const a = data[i + 3] ?? 0;
		if (a > 10 && isUiAnnotationRgb(r, g, b)) visibleGreenPixelsBefore += 1;
		if (isPaintedSemanticPixel(r, g, b, a)) {
			paintedPixels += 1;
			out[i] = 255;
			out[i + 1] = 255;
			out[i + 2] = 255;
			out[i + 3] = 255;
		}
	}
	let visibleGreenPixelsAfter = 0;
	for (let i = 0; i < out.length; i += 4) {
		const r = out[i] ?? 0;
		const g = out[i + 1] ?? 0;
		const b = out[i + 2] ?? 0;
		const a = out[i + 3] ?? 0;
		if (a > 10 && isUiAnnotationRgb(r, g, b)) {
			visibleGreenPixelsAfter += 1;
		}
	}
	return { data: out, paintedPixels, visibleGreenPixelsBefore, visibleGreenPixelsAfter };
}

export function pixelDiffRatio(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
	const length = Math.min(a.length, b.length);
	const pixels = Math.max(1, Math.floor(length / 4));
	let changed = 0;
	for (let i = 0; i < length; i += 4) {
		if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) changed += 1;
	}
	return changed / pixels;
}

export function annotationContaminationOnStroke(
	image: Uint8ClampedArray,
	mask: Uint8ClampedArray,
): { strokePixels: number; contaminatedPixels: number; ratio: number; contaminated: boolean } {
	const length = Math.min(image.length, mask.length);
	let strokePixels = 0;
	let contaminatedPixels = 0;
	for (let i = 0; i < length; i += 4) {
		if (!isPaintedSemanticPixel(mask[i] ?? 0, mask[i + 1] ?? 0, mask[i + 2] ?? 0, mask[i + 3] ?? 0)) continue;
		strokePixels += 1;
		if ((image[i + 3] ?? 0) > 10 && isUiAnnotationRgb(image[i] ?? 0, image[i + 1] ?? 0, image[i + 2] ?? 0)) {
			contaminatedPixels += 1;
		}
	}
	const ratio = contaminatedPixels / Math.max(1, strokePixels);
	return { strokePixels, contaminatedPixels, ratio, contaminated: contaminatedPixels > 0 };
}

export function exportSanitizedSemanticMaskBlob(maskCanvas: HTMLCanvasElement): Promise<Blob> {
	const ctx = maskCanvas.getContext('2d');
	if (!ctx) return Promise.reject(new Error('마스크 이미지를 만들 수 없습니다.'));
	const imageData = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
	const sanitized = sanitizeSemanticMaskRgba(imageData.data);
	const scratch = document.createElement('canvas');
	scratch.width = maskCanvas.width;
	scratch.height = maskCanvas.height;
	const scratchCtx = scratch.getContext('2d');
	if (!scratchCtx) return Promise.reject(new Error('마스크 이미지를 만들 수 없습니다.'));
	const out = scratchCtx.createImageData(maskCanvas.width, maskCanvas.height);
	out.data.set(sanitized.data);
	scratchCtx.putImageData(out, 0, 0);
	return new Promise((resolve, reject) => {
		scratch.toBlob((blob) => {
			if (blob) resolve(blob);
			else reject(new Error('마스크 이미지를 만들 수 없습니다.'));
		}, 'image/png');
	});
}
