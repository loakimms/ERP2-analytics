import React, { useState } from 'react';
import {
	applyGfaCreativeImageReplacement,
	cancelGfaCreativeImageReplacement,
	gfaCreativeImageDownloadUrl,
	gfaCreativeImageReplacementPreviewUrl,
	stageGfaCreativeImageReplacement,
	type GfaCreativeGeneratorRun,
} from './adsApi';

function replacementState(run: GfaCreativeGeneratorRun): { staged?: Record<string, unknown> | null; current?: Record<string, unknown> | null } {
	const explanation = run.generation_explanation || {};
	const state = explanation.imageReplacement;
	if (!state || typeof state !== 'object') return {};
	const record = state as { staged?: Record<string, unknown> | null; current?: Record<string, unknown> | null };
	return { staged: record.staged || null, current: record.current || null };
}

async function downloadArtifact(src: string, fallbackName: string): Promise<void> {
	const res = await fetch(src);
	if (!res.ok) throw new Error('이미지 다운로드에 실패했습니다.');
	const blob = await res.blob();
	const href = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = href;
	a.download = fallbackName;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(href);
}

export function GfaCreativeImageReplacementPanel(props: {
	apiBaseUrl: string;
	run: GfaCreativeGeneratorRun;
	onRunUpdated: (run: GfaCreativeGeneratorRun) => void;
	onMessage: (message: string) => void;
}): JSX.Element {
	const [busy, setBusy] = useState('');
	const staged = replacementState(props.run).staged;
	const currentSrc = props.run.image_url
		? `${props.apiBaseUrl}${props.run.image_url}${props.run.updated_at ? `?v=${encodeURIComponent(props.run.updated_at)}` : ''}`
		: '';
	const stagedSrc = staged
		? gfaCreativeImageReplacementPreviewUrl(props.apiBaseUrl, props.run.id, String(staged.uploadedAt || props.run.updated_at || ''))
		: '';
	const canReplace = Boolean(props.run.can_lock_image && props.run.base_image_url);

	const runAction = async (label: string, work: () => Promise<void>) => {
		setBusy(label);
		props.onMessage('');
		try {
			await work();
		} catch (e) {
			const anyErr = e as { response?: { data?: { detail?: string } }; message?: string };
			props.onMessage(String(anyErr?.response?.data?.detail || anyErr?.message || '요청에 실패했습니다.'));
		} finally {
			setBusy('');
		}
	};

	return (
		<div style={{ display: 'grid', gap: 8, border: '1px solid rgba(148,163,184,0.16)', borderRadius: 12, padding: 10, background: 'rgba(15,23,42,0.42)' }}>
			<div style={{ fontSize: 12, fontWeight: 900, color: '#e5e7eb' }}>이미지 교체</div>
			<div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.45 }}>
				현재 이미지는 카피가 없는 베이스입니다. 외부에서 수정한 뒤 같은 크기 이미지를 업로드하면 기존 카피가 다시 합성됩니다. 적용 전에는 현재 이미지가 바뀌지 않습니다.
			</div>
			{!canReplace ? (
				<div style={{ fontSize: 11, color: '#fbbf24' }}>이 시안은 카피와 분리된 베이스 이미지가 없어 교체 업로드를 사용할 수 없습니다.</div>
			) : null}
			<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
				<button
					type="button"
					className="btn-ghost"
					disabled={!canReplace || Boolean(busy)}
					onClick={() => void runAction('download', async () => {
						await downloadArtifact(gfaCreativeImageDownloadUrl(props.apiBaseUrl, props.run.id), `gfa_${props.run.id}_current.png`);
						props.onMessage('현재 이미지(베이스)를 다운로드했습니다.');
					})}
				>
					{busy === 'download' ? '다운로드 중...' : '현재 이미지 다운로드'}
				</button>
				<label className="btn-ghost" style={{ display: 'inline-flex', justifyContent: 'center', cursor: busy === 'stage' ? 'wait' : 'pointer' }}>
					{busy === 'stage' ? '업로드 중...' : '수정 이미지 업로드'}
					<input
						type="file"
						accept="image/png,image/jpeg,image/webp"
						disabled={!canReplace || Boolean(busy)}
						onChange={(e) => {
							const file = e.target.files?.[0];
							e.currentTarget.value = '';
							if (!file) return;
							void runAction('stage', async () => {
								const result = await stageGfaCreativeImageReplacement({
									baseUrl: props.apiBaseUrl,
									runId: props.run.id,
									file,
									note: '외부 수정본 업로드(미리보기)',
								});
								props.onRunUpdated(result.run);
								props.onMessage(result.current_unchanged === false ? '업로드가 현재 이미지를 변경했습니다.' : '수정본 미리보기를 만들었습니다. 적용을 눌러야 반영됩니다.');
							});
						}}
						style={{ display: 'none' }}
					/>
				</label>
			</div>
			{staged && currentSrc && stagedSrc ? (
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
					<div>
						<div style={{ fontSize: 11, fontWeight: 800, color: '#cbd5e1', marginBottom: 6 }}>현재 적용 이미지</div>
						<img src={currentSrc} alt="현재 적용 이미지" style={{ width: '100%', borderRadius: 8, border: '1px solid rgba(148,163,184,0.2)' }} />
					</div>
					<div>
						<div style={{ fontSize: 11, fontWeight: 800, color: '#bbf7d0', marginBottom: 6 }}>수정본 미리보기</div>
						<img src={stagedSrc} alt="수정본 미리보기" style={{ width: '100%', borderRadius: 8, border: '1px solid rgba(74,222,128,0.35)' }} />
					</div>
				</div>
			) : null}
			{staged ? (
				<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
					<button
						type="button"
						className="btn-primary"
						disabled={Boolean(busy)}
						onClick={() => void runAction('apply', async () => {
							const result = await applyGfaCreativeImageReplacement({ baseUrl: props.apiBaseUrl, runId: props.run.id });
							props.onRunUpdated(result.run);
							props.onMessage('이미지 교체를 적용했습니다.');
						})}
					>
						{busy === 'apply' ? '적용 중...' : '이미지 교체 적용'}
					</button>
					<button
						type="button"
						className="btn-ghost"
						disabled={Boolean(busy)}
						onClick={() => void runAction('cancel', async () => {
							const result = await cancelGfaCreativeImageReplacement({ baseUrl: props.apiBaseUrl, runId: props.run.id });
							props.onRunUpdated(result.run);
							props.onMessage('수정본 미리보기를 취소했습니다. 현재 이미지와 카피는 그대로입니다.');
						})}
					>
						취소
					</button>
				</div>
			) : null}
		</div>
	);
}
