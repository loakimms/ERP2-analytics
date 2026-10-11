import React from 'react';

export type OverlayKey = 'headline' | 'subcopy' | 'proof' | 'cta';

export type OverlayItem = {
	x: number;
	y: number;
	w: number;
	font_scale: number;
	font_family: string;
	font_weight: string;
	color: string;
	align: 'left' | 'center' | 'right';
	opacity: number;
	bg_color: string;
	bg_opacity: number;
	line_height: number;
	shadow: boolean;
};

export type OverlayLayout = Record<OverlayKey, OverlayItem>;

export type OverlayFontOption = {
	id: string;
	label: string;
	family?: string;
	source?: string;
};

const overlayKeys: OverlayKey[] = ['headline', 'subcopy', 'proof', 'cta'];

export const defaultLayerLabels: Record<OverlayKey, string> = {
	headline: '메인카피',
	subcopy: '서브카피',
	proof: '증거/보조문구',
	cta: 'CTA',
};

export function clamp(v: number, low: number, high: number): number {
	return Math.max(low, Math.min(high, Number.isFinite(v) ? v : low));
}

function hexToRgba(value: string, alpha: number): string {
	const raw = String(value || '').trim().replace(/^#/, '');
	const hex = raw.length === 3 ? raw.split('').map((ch) => `${ch}${ch}`).join('') : raw;
	if (!/^[0-9a-fA-F]{6}$/.test(hex)) return `rgba(255,255,255,${clamp(alpha, 0, 1)})`;
	const r = parseInt(hex.slice(0, 2), 16);
	const g = parseInt(hex.slice(2, 4), 16);
	const b = parseInt(hex.slice(4, 6), 16);
	return `rgba(${r},${g},${b},${clamp(alpha, 0, 1)})`;
}

function fontFamilyCss(value: string): string {
	const raw = String(value || '').trim();
	if (raw === 'noto_serif') return 'serif';
	if (raw.startsWith('winfont:') || raw.startsWith('fontfile:')) {
		const filename = raw.split(':').slice(1).join(':');
		const stem = filename.replace(/\.(ttf|ttc|otf)$/i, '');
		return `"${stem}", system-ui, sans-serif`;
	}
	return 'system-ui, sans-serif';
}

export function defaultOverlayLayout(): OverlayLayout {
	return {
		headline: { x: 0.055, y: 0.10, w: 0.42, font_scale: 1, font_family: 'noto_sans', font_weight: 'bold', color: '#1e2b1c', align: 'left', opacity: 1, bg_color: '#ffffff', bg_opacity: 0, line_height: 1.12, shadow: true },
		subcopy: { x: 0.055, y: 0.335, w: 0.42, font_scale: 0.88, font_family: 'noto_sans', font_weight: 'regular', color: '#303d26', align: 'left', opacity: 1, bg_color: '#ffffff', bg_opacity: 0, line_height: 1.45, shadow: true },
		proof: { x: 0.055, y: 0.505, w: 0.40, font_scale: 0.8, font_family: 'noto_sans', font_weight: 'regular', color: '#634b34', align: 'left', opacity: 1, bg_color: '#ffffff', bg_opacity: 0, line_height: 1.45, shadow: true },
		cta: { x: 0.055, y: 0.79, w: 0.34, font_scale: 1, font_family: 'noto_sans', font_weight: 'bold', color: '#ffffff', align: 'center', opacity: 1, bg_color: '#f5700d', bg_opacity: 1, line_height: 1.15, shadow: false },
	};
}

export function overlayFromValue(v: unknown): OverlayLayout {
	const base = defaultOverlayLayout();
	const raw = (v && typeof v === 'object' ? v : {}) as Record<string, any>;
	overlayKeys.forEach((key) => {
		const item = raw[key] && typeof raw[key] === 'object' ? raw[key] : {};
		base[key] = {
			...base[key],
			x: clamp(Number(item.x ?? base[key].x), 0, 0.95),
			y: clamp(Number(item.y ?? base[key].y), 0, 0.95),
			w: clamp(Number(item.w ?? base[key].w), 0.15, 0.9),
			font_scale: clamp(Number(item.font_scale ?? base[key].font_scale), 0.55, 1.8),
			font_family: String(item.font_family || base[key].font_family),
			font_weight: String(item.font_weight || base[key].font_weight),
			color: String(item.color || base[key].color),
			align: (['left', 'center', 'right'].includes(String(item.align)) ? String(item.align) : base[key].align) as OverlayItem['align'],
			opacity: clamp(Number(item.opacity ?? base[key].opacity), 0.15, 1),
			bg_color: String(item.bg_color || base[key].bg_color),
			bg_opacity: clamp(Number(item.bg_opacity ?? base[key].bg_opacity), 0, 1),
			line_height: clamp(Number(item.line_height ?? base[key].line_height), 0.9, 1.8),
			shadow: typeof item.shadow === 'boolean' ? item.shadow : base[key].shadow,
		};
	});
	return base;
}

export type OverlayCanvasEditorProps = {
	baseImageSrc?: string;
	finalImageSrc?: string;
	baseImageBroken?: boolean;
	finalImageBroken?: boolean;
	alt?: string;
	overlay: OverlayLayout;
	texts: Record<OverlayKey, string>;
	activeKey: OverlayKey;
	onActiveKeyChange: (key: OverlayKey) => void;
	onOverlayChange: (key: OverlayKey, patch: Partial<OverlayItem>) => void;
	canEdit?: boolean;
	maxWidth?: number;
	large?: boolean;
	aspectRatio?: string;
	background?: string;
	onImageError?: (kind: 'base' | 'final') => void;
	onImageLoad?: (kind: 'base' | 'final') => void;
	showPropertyPanel?: boolean;
	propertyPanelDark?: boolean;
	layerLabels?: Record<OverlayKey, string>;
	fontOptions?: OverlayFontOption[];
};

export function OverlayCanvas({
	baseImageSrc = '',
	finalImageSrc = '',
	baseImageBroken = false,
	finalImageBroken = false,
	alt = 'creative',
	overlay,
	texts,
	activeKey,
	onActiveKeyChange,
	onOverlayChange,
	canEdit = true,
	maxWidth = 360,
	large = false,
	aspectRatio = '1 / 1',
	background = '#020617',
	onImageError,
	onImageLoad,
}: OverlayCanvasEditorProps): JSX.Element {
	const imageSrc = canEdit && baseImageSrc && !baseImageBroken ? baseImageSrc : finalImageSrc && !finalImageBroken ? finalImageSrc : '';
	const imageKind: 'base' | 'final' = canEdit && baseImageSrc && !baseImageBroken ? 'base' : 'final';
	const baseFont = large ? { headline: 44, subcopy: 25, proof: 22, cta: 23 } : { headline: 26, subcopy: 14, proof: 14, cta: 15 };
	const beginDrag = (key: OverlayKey, e: React.MouseEvent<HTMLDivElement>) => {
		if (!canEdit) return;
		e.preventDefault();
		onActiveKeyChange(key);
		const parent = e.currentTarget.parentElement as HTMLElement | null;
		if (!parent) return;
		const rect = parent.getBoundingClientRect();
		const startX = e.clientX;
		const startY = e.clientY;
		const start = overlay[key];
		const move = (ev: MouseEvent) => {
			const dx = (ev.clientX - startX) / rect.width;
			const dy = (ev.clientY - startY) / rect.height;
			onOverlayChange(key, { x: clamp(start.x + dx, 0, 0.95), y: clamp(start.y + dy, 0, 0.95) });
		};
		const up = () => {
			window.removeEventListener('mousemove', move);
			window.removeEventListener('mouseup', up);
		};
		window.addEventListener('mousemove', move);
		window.addEventListener('mouseup', up);
	};
	const renderOverlay = (key: OverlayKey) => {
		const item = overlay[key];
		const text = texts[key];
		if (!text) return null;
		const isCta = key === 'cta';
		const active = activeKey === key;
		const fontSize = baseFont[key] * item.font_scale;
		const maxLines = key === 'cta' ? 1 : 2;
		return (
			<div
				key={key}
				onMouseDown={(e) => beginDrag(key, e)}
				onClick={() => onActiveKeyChange(key)}
				title={`${defaultLayerLabels[key]} 위치 드래그`}
				style={{
					position: 'absolute',
					left: `${item.x * 100}%`,
					top: `${item.y * 100}%`,
					width: `${item.w * 100}%`,
					whiteSpace: 'pre-wrap',
					wordBreak: 'keep-all',
					overflowWrap: 'normal',
					overflow: 'hidden',
					maxHeight: `${fontSize * item.line_height * maxLines + (isCta ? (large ? 20 : 12) : 4)}px`,
					boxSizing: 'border-box',
					cursor: canEdit ? 'move' : 'default',
					userSelect: 'none',
					padding: isCta ? (large ? '10px 16px' : '6px 10px') : 0,
					borderRadius: isCta ? 999 : 6,
					background: item.bg_opacity > 0 ? hexToRgba(item.bg_color, item.bg_opacity) : active ? 'rgba(59,130,246,0.08)' : 'rgba(255,255,255,0.04)',
					opacity: item.opacity,
					color: item.color,
					textAlign: item.align,
					fontFamily: fontFamilyCss(item.font_family),
					fontWeight: item.font_weight === 'regular' ? 500 : item.font_weight === 'medium' ? 700 : 900,
					fontSize: `${fontSize}px`,
					lineHeight: item.line_height,
					textShadow: item.shadow ? '0 1px 2px rgba(255,255,255,0.85)' : 'none',
					border: canEdit ? `2px ${active ? 'solid' : 'dashed'} ${active ? 'rgba(96,165,250,0.95)' : 'rgba(96,165,250,0.55)'}` : 'none',
					boxShadow: active ? '0 0 0 2px rgba(59,130,246,0.18)' : undefined,
				}}
			>
				{text}
			</div>
		);
	};
	return (
		<div style={{ position: 'relative', width: '100%', maxWidth, aspectRatio, margin: '0 auto', borderRadius: 12, border: '1px solid rgba(148,163,184,0.24)', background, overflow: 'hidden' }}>
			{imageSrc ? (
				<img
					src={imageSrc}
					alt={alt}
					onError={() => onImageError?.(imageKind)}
					onLoad={() => onImageLoad?.(imageKind)}
					style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
				/>
			) : (
				<div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#94a3b8', background }}>
					이미지 없음
				</div>
			)}
			{canEdit ? overlayKeys.map(renderOverlay) : null}
		</div>
	);
}

export function LayerPropertyPanel({
	overlay,
	activeKey,
	onActiveKeyChange,
	onOverlayChange,
	layerLabels = defaultLayerLabels,
	dark = true,
	fontOptions,
}: {
	overlay: OverlayLayout;
	activeKey: OverlayKey;
	onActiveKeyChange: (key: OverlayKey) => void;
	onOverlayChange: (key: OverlayKey, patch: Partial<OverlayItem>) => void;
	layerLabels?: Record<OverlayKey, string>;
	dark?: boolean;
	fontOptions?: OverlayFontOption[];
}): JSX.Element {
	const active = overlay[activeKey];
	const fonts = fontOptions?.length ? fontOptions : [
		{ id: 'noto_sans', label: '고딕 기본', source: 'default' },
		{ id: 'noto_serif', label: '명조 기본', source: 'default' },
	];
	const controlRow = (label: string, child: JSX.Element) => (
		<label style={{ display: 'grid', gap: 4, fontSize: 12, color: dark ? '#cbd5e1' : '#475569' }}>
			<span style={{ fontWeight: 800 }}>{label}</span>
			{child}
		</label>
	);
	const inputClass = dark ? 'input' : undefined;
	const inputStyle = dark
		? { background: '#020617', color: '#e5e7eb', border: '1px solid rgba(148,163,184,0.28)', borderRadius: 10, padding: '8px 10px' }
		: { border: '1px solid #cbd5e1', borderRadius: 10, padding: '8px 10px' };
	return (
		<div style={{ display: 'grid', gap: 10 }}>
			<div style={{ display: 'grid', gap: 8, border: `1px solid ${dark ? 'rgba(148,163,184,0.16)' : '#e2e8f0'}`, borderRadius: 12, padding: 10, background: dark ? 'rgba(15,23,42,0.72)' : '#fff' }}>
				<div style={{ fontSize: 13, fontWeight: 900, color: dark ? '#e5e7eb' : '#0f172a' }}>레이어 선택</div>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
					{overlayKeys.map((key) => (
						<button key={key} type="button" className={activeKey === key ? 'btn-primary' : 'btn-ghost'} onClick={() => onActiveKeyChange(key)}>
							{layerLabels[key]}
						</button>
					))}
				</div>
			</div>
			<div style={{ display: 'grid', gap: 8, border: `1px solid ${dark ? 'rgba(148,163,184,0.16)' : '#e2e8f0'}`, borderRadius: 12, padding: 10, background: dark ? 'rgba(15,23,42,0.72)' : '#fff' }}>
				<div style={{ fontSize: 13, fontWeight: 900, color: dark ? '#e5e7eb' : '#0f172a' }}>{layerLabels[activeKey]} 속성</div>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
					{controlRow('X 위치', <input className={inputClass} style={inputStyle} type="number" min={0} max={95} value={Math.round(active.x * 100)} onChange={(e) => onOverlayChange(activeKey, { x: clamp(Number(e.target.value) / 100, 0, 0.95) })} />)}
					{controlRow('Y 위치', <input className={inputClass} style={inputStyle} type="number" min={0} max={95} value={Math.round(active.y * 100)} onChange={(e) => onOverlayChange(activeKey, { y: clamp(Number(e.target.value) / 100, 0, 0.95) })} />)}
					{controlRow('영역 폭', <input className={inputClass} style={inputStyle} type="number" min={15} max={90} value={Math.round(active.w * 100)} onChange={(e) => onOverlayChange(activeKey, { w: clamp(Number(e.target.value) / 100, 0.15, 0.9) })} />)}
					{controlRow('정렬', <select className={inputClass} style={inputStyle} value={active.align} onChange={(e) => onOverlayChange(activeKey, { align: e.target.value as OverlayItem['align'] })}><option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option></select>)}
					{controlRow('글꼴', <select className={inputClass} style={inputStyle} value={active.font_family} onChange={(e) => onOverlayChange(activeKey, { font_family: e.target.value })}>{fonts.map((font) => <option key={font.id} value={font.id} style={{ fontFamily: font.family ? `"${font.family}", system-ui, sans-serif` : undefined }}>{font.label}{font.source === 'windows' ? ' · Windows' : ''}</option>)}</select>)}
					{controlRow('굵기', <select className={inputClass} style={inputStyle} value={active.font_weight} onChange={(e) => onOverlayChange(activeKey, { font_weight: e.target.value })}><option value="regular">Regular</option><option value="medium">Medium</option><option value="bold">Bold</option></select>)}
				</div>
				{controlRow('텍스트 크기', <input type="range" min="0.55" max="1.8" step="0.05" value={active.font_scale} onChange={(e) => onOverlayChange(activeKey, { font_scale: Number(e.target.value) })} />)}
				{controlRow('줄 간격', <input type="range" min="0.9" max="1.8" step="0.05" value={active.line_height} onChange={(e) => onOverlayChange(activeKey, { line_height: Number(e.target.value) })} />)}
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
					{controlRow('텍스트 색상', <input className={inputClass} style={inputStyle} type="color" value={active.color} onChange={(e) => onOverlayChange(activeKey, { color: e.target.value })} />)}
					{controlRow('배경 색상', <input className={inputClass} style={inputStyle} type="color" value={active.bg_color} onChange={(e) => onOverlayChange(activeKey, { bg_color: e.target.value })} />)}
				</div>
				{controlRow('텍스트 투명도', <input type="range" min="0.15" max="1" step="0.05" value={active.opacity} onChange={(e) => onOverlayChange(activeKey, { opacity: Number(e.target.value) })} />)}
				{controlRow('배경 투명도', <input type="range" min="0" max="1" step="0.05" value={active.bg_opacity} onChange={(e) => onOverlayChange(activeKey, { bg_opacity: Number(e.target.value) })} />)}
				<label style={{ display: 'flex', gap: 8, alignItems: 'center', color: dark ? '#cbd5e1' : '#475569', fontSize: 12 }}>
					<input type="checkbox" checked={active.shadow} onChange={(e) => onOverlayChange(activeKey, { shadow: e.target.checked })} />
					텍스트 그림자
				</label>
			</div>
		</div>
	);
}

export function OverlayCanvasEditor(props: OverlayCanvasEditorProps): JSX.Element {
	return (
		<div style={{ display: 'grid', gap: 12 }}>
			<OverlayCanvas {...props} />
			{props.showPropertyPanel ? (
				<LayerPropertyPanel
					overlay={props.overlay}
					activeKey={props.activeKey}
					onActiveKeyChange={props.onActiveKeyChange}
					onOverlayChange={props.onOverlayChange}
					layerLabels={props.layerLabels}
					dark={props.propertyPanelDark !== false}
					fontOptions={props.fontOptions}
				/>
			) : null}
		</div>
	);
}
