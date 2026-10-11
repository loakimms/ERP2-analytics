import { describe, expect, it } from 'vitest';

import {
	GFA_UI_ANNOTATION_RGB,
	annotationContaminationOnStroke,
	isUiAnnotationRgb,
	pixelDiffRatio,
	sanitizeSemanticMaskRgba,
} from './gfaMaskAnnotationIsolation';

function rgba(width: number, height: number, fill: [number, number, number, number]): Uint8ClampedArray {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let i = 0; i < data.length; i += 4) {
		data[i] = fill[0];
		data[i + 1] = fill[1];
		data[i + 2] = fill[2];
		data[i + 3] = fill[3];
	}
	return data;
}

function setPixel(data: Uint8ClampedArray, width: number, x: number, y: number, color: [number, number, number, number]) {
	const i = (y * width + x) * 4;
	data[i] = color[0];
	data[i + 1] = color[1];
	data[i + 2] = color[2];
	data[i + 3] = color[3];
}

describe('gfa mask annotation isolation', () => {
	it('keeps clean source pixels identical after marking because annotation lives on a separate buffer', () => {
		const sourceBefore = rgba(4, 4, [40, 30, 20, 255]);
		const sourceAfter = new Uint8ClampedArray(sourceBefore);
		const overlay = rgba(4, 4, [0, 0, 0, 0]);
		setPixel(overlay, 4, 1, 1, [GFA_UI_ANNOTATION_RGB.r, GFA_UI_ANNOTATION_RGB.g, GFA_UI_ANNOTATION_RGB.b, 148]);
		expect(pixelDiffRatio(sourceBefore, sourceAfter)).toBe(0);
		expect(isUiAnnotationRgb(overlay[20] ?? 0, overlay[21] ?? 0, overlay[22] ?? 0)).toBe(true);
	});

	it('strips visible green RGB from a semantic mask and keeps only white/alpha selection', () => {
		const mask = rgba(3, 1, [0, 0, 0, 0]);
		setPixel(mask, 3, 0, 0, [GFA_UI_ANNOTATION_RGB.r, GFA_UI_ANNOTATION_RGB.g, GFA_UI_ANNOTATION_RGB.b, 148]);
		setPixel(mask, 3, 1, 0, [255, 255, 255, 255]);
		const sanitized = sanitizeSemanticMaskRgba(mask);
		expect(sanitized.paintedPixels).toBe(2);
		expect(sanitized.visibleGreenPixelsBefore).toBe(1);
		expect(sanitized.visibleGreenPixelsAfter).toBe(0);
		expect(Array.from(sanitized.data.slice(0, 4))).toEqual([255, 255, 255, 255]);
		expect(Array.from(sanitized.data.slice(4, 8))).toEqual([255, 255, 255, 255]);
		expect(Array.from(sanitized.data.slice(8, 12))).toEqual([0, 0, 0, 0]);
	});

	it('detects annotation contamination only on known stroke coordinates', () => {
		const clean = rgba(2, 1, [18, 22, 30, 255]);
		const baked = new Uint8ClampedArray(clean);
		setPixel(baked, 2, 0, 0, [GFA_UI_ANNOTATION_RGB.r, GFA_UI_ANNOTATION_RGB.g, GFA_UI_ANNOTATION_RGB.b, 255]);
		const mask = rgba(2, 1, [0, 0, 0, 0]);
		setPixel(mask, 2, 0, 0, [255, 255, 255, 255]);
		expect(annotationContaminationOnStroke(clean, mask).contaminated).toBe(false);
		expect(annotationContaminationOnStroke(baked, mask)).toMatchObject({
			strokePixels: 1,
			contaminatedPixels: 1,
			contaminated: true,
		});
	});
});
