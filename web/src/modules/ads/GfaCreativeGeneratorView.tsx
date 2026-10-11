import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
	addGfaCreativeGeneratorEvent,
	analyzeGfaBannerImage,
	applyGfaCreativeGeneratorRunImagePreview,
	createGfaCreativeGeneratorRun,
	editGfaCreativeGeneratorRunImageMasked,
	fetchGfaBannerAnalysisHistory,
	fetchGfaBannerAnalysisHistoryDetail,
	fetchGfaBannerContentContexts,
	fetchGfaCreativeGeneratorFonts,
	fetchGfaCreativeGeneratorRuns,
	fetchGfaCreativeGeneratorSources,
	generateGfaBannerFromAnalysis,
	regenerateGfaCreativeGeneratorRunCopy,
	regenerateGfaCreativeGeneratorRunImage,
	reviewGfaCreativeGeneratorRun,
	updateGfaCreativeGeneratorRunCopy,
	type GfaCreativeGeneratorCandidate,
	type GfaBannerAnalysisResult,
	type GfaBannerAnalysisHistoryItem,
	type GfaBannerAnalysisGenerationResult,
	type GfaBannerContentContextItem,
	type GfaHistoricalEvidenceFeature,
	type GfaCreativeGeneratorRun,
	type GfaCreativeGeneratorSources,
	type GfaCreativeGeneratorFont,
	type GfaCreativeGeneratorTemplate,
} from './adsApi';
import { GfaCanvasEditor, LayerPropertyPanel, overlayFromValue, type OverlayItem, type OverlayKey, type OverlayLayout } from './GfaCanvasEditor';
import { GfaCreativeImageReplacementPanel } from './GfaCreativeImageReplacementPanel';
import {
	exportSanitizedSemanticMaskBlob,
	GFA_SEMANTIC_MASK_STROKE,
	GFA_UI_ANNOTATION_STROKE_STYLE,
	type MaskBrushEditorHandle,
} from './gfaMaskAnnotationIsolation';

const GOALS = [
	{ key: 'click', label: '클릭유도형', hint: '스크롤을 멈추고 유입을 만드는 소재' },
	{ key: 'conversion', label: '가망고객확보용', hint: '문제 인식과 혜택으로 전환 전 단계를 만드는 소재' },
	{ key: 'purchase', label: '매출확보용', hint: '신뢰와 구매 이유로 구매 전환을 밀어주는 소재' },
] as const;

function ymd(d: Date): string {
	const yyyy = d.getFullYear();
	const mm = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	return `${yyyy}-${mm}-${dd}`;
}

function defaultFrom(): string {
	const d = new Date();
	d.setDate(d.getDate() - 365);
	return ymd(d);
}

function defaultTo(): string {
	const d = new Date();
	d.setDate(d.getDate() - 1);
	return ymd(d);
}

function n(v: unknown): number {
	const x = Number(v || 0);
	return Number.isFinite(x) ? x : 0;
}

function pct(v: unknown): string {
	return `${n(v).toFixed(2)}%`;
}

function roasMultiple(v: unknown): string {
	return `${(n(v) / 100).toFixed(1)}배`;
}

function won(v: unknown): string {
	return `${Math.round(n(v)).toLocaleString('ko-KR')}원`;
}

function compactText(v: unknown, fallback = '-'): string {
	const s = String(v ?? '').replace(/\s+/g, ' ').trim();
	return s || fallback;
}

function editableText(v: unknown, fallback = ''): string {
	const s = String(v ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
	return s || fallback;
}

type ProfessionalEditorCopyDraft = {
	headline: string;
	subcopy: string;
	proofLine: string;
	cta: string;
	ctaEnabled: boolean;
	landingMessage: string;
};

type ProfessionalEditorMaskPreview = {
	runId: string;
	imageUrl: string;
	baseImageUrl?: string;
	prompt: string;
	editMode?: string;
};


function estimateCreativeScore(run: GfaCreativeGeneratorRun, draft: { headline: string; subcopy: string; proofLine: string; cta: string; ctaEnabled: boolean }): number {
	const existing = Number(run.copy_result?.creative_score || 0);
	const headlineLen = draft.headline.replace(/\s/g, '').length;
	const hook = draft.headline.trim() ? (headlineLen <= 18 ? 90 : headlineLen <= 28 ? 72 : 55) : 20;
	const benefit = draft.subcopy.trim() ? 78 : 35;
	const proof = draft.proofLine.trim() ? 72 : 35;
	const cta = draft.ctaEnabled ? (draft.cta.trim() ? 82 : 45) : 58;
	const live = hook * 0.35 + benefit * 0.25 + proof * 0.18 + cta * 0.12 + 70 * 0.1;
	return Math.round(((existing || live) * 0.35 + live * 0.65) * 10) / 10;
}

function assetUrl(baseUrl: string, path?: string): string {
	const p = String(path || '').trim();
	if (!p) return '';
	if (/^https?:\/\//i.test(p)) return p;
	return `${baseUrl}${p.startsWith('/') ? p : `/${p}`}`;
}

async function downloadImageOnly(src: string, filename: string): Promise<void> {
	const safeName = filename.trim() || 'banner-image.png';
	let href = src;
	let revoke = '';
	if (!src.startsWith('data:')) {
		const res = await fetch(src);
		if (!res.ok) throw new Error('이미지 다운로드에 실패했습니다.');
		const blob = await res.blob();
		href = URL.createObjectURL(blob);
		revoke = href;
	}
	const a = document.createElement('a');
	a.href = href;
	a.download = safeName;
	document.body.appendChild(a);
	a.click();
	a.remove();
	if (revoke) URL.revokeObjectURL(revoke);
}

function errorText(e: unknown): string {
	const anyErr = e as any;
	return friendlyGenerationError(String(anyErr?.response?.data?.detail ?? anyErr?.message ?? '요청에 실패했습니다.'));
}

function friendlyGenerationError(raw: unknown): string {
	const text = String(raw || '').trim();
	const low = text.toLowerCase();
	if (!text) return '';
	if (low.includes('does not have access to model') || low.includes('model_not_found')) {
		const matched = text.match(/model\s+['"]?([A-Za-z0-9_.:-]+)['"]?/);
		const model = matched?.[1] ? ` (${matched[1]})` : '';
		return `OpenAI 카피 생성 모델 접근 권한이 없습니다${model}. 설정된 모델 권한을 확인하거나 접근 가능한 GPT 모델로 다시 생성하세요.`;
	}
	if (low.includes('insufficient_quota') || low.includes('quota')) {
		return 'OpenAI API 할당량 또는 결제 한도 문제로 카피 생성에 실패했습니다.';
	}
	if (low.includes('openai_copy_error')) {
		return 'OpenAI 카피 생성 요청에 실패했습니다. API 키, 모델 권한, 계정 할당량을 확인하세요.';
	}
	if (low.includes('gemini_image_error')) {
		return 'Gemini/나노바나나 이미지 생성 요청에 실패했습니다. API 키, 모델 권한, 계정 할당량을 확인하세요.';
	}
	if (low.includes('openai_image_error')) {
		return 'OpenAI GPT 이미지 생성 요청에 실패했습니다. API 키, GPT 이미지 모델 권한, 계정 할당량을 확인하세요.';
	}
	if (low.includes('banner_analysis_missing_factor_scores')) {
		return 'AI 배너 분석 응답에 기존 GFA 평가 항목 점수가 누락되었습니다. 이미지를 다시 분석하거나 모델 설정을 확인하세요.';
	}
	if (low.includes('openai_banner_analysis_error')) {
		return 'OpenAI 배너 분석 요청에 실패했습니다. API 키, vision 지원 모델 권한, 계정 할당량을 확인하세요.';
	}
	return text;
}

function isInvalidDateRange(from: string, to: string): boolean {
	return Boolean(from && to && from > to);
}

function statusLabel(status: string): string {
	return ({ pending: '검수 대기', accepted: '채택', hold: '보류', rejected: '폐기' } as Record<string, string>)[status] || status || '-';
}

function policyStatusLabel(status: string): string {
	return ({ PASS: '문제없음', CAUTION: '주의 필요', REVIEW_REQUIRED: '검토 필요', LIKELY_REJECT: '반려 가능' } as Record<string, string>)[status] || status || '-';
}

function hasBannerPolicyIssue(result: GfaBannerAnalysisResult): boolean {
	const compliance = ((result as any)?.naver_compliance || {}) as Record<string, any>;
	const issues = Array.isArray(compliance.issues) ? compliance.issues : [];
	const checks = Array.isArray(compliance.checks) ? compliance.checks : [];
	const expertAdvice = ((result as any)?.expert_advice || {}) as Record<string, any>;
	return Boolean(
		issues.length ||
		expertAdvice.policy_risk_promoted_to_fix ||
		checks.some((row: Record<string, any>) => Boolean(row.has_issue) || !['', 'PASS'].includes(String(row.status || 'PASS').toUpperCase())),
	);
}

function isPolicyAnalysisItem(item: Record<string, any>): boolean {
	const text = `${item.key || ''} ${item.title || ''} ${item.label || ''}`.toLowerCase();
	return text.includes('policy') || text.includes('compliance') || text.includes('naver') || text.includes('정책') || text.includes('심사');
}

export function GfaCreativeGeneratorView(props: { apiBaseUrl: string }): JSX.Element {
	const [searchParams] = useSearchParams();
	const initialDateFrom = searchParams.get('date_from') || defaultFrom();
	const initialDateTo = searchParams.get('date_to') || defaultTo();
	const initialGoal = searchParams.get('goal') || 'click';
	const initialCreativeId = searchParams.get('creative_id') || '';
	const initialGenerationSource = searchParams.get('generation_source') === 'appeal' ? 'appeal' : 'existing';
	const initialAppealPointId = searchParams.get('appeal_point_id') || '';
	const [dateFrom, setDateFrom] = useState(initialDateFrom);
	const [dateTo, setDateTo] = useState(initialDateTo);
	const [goal, setGoal] = useState<string>(initialGoal);
	const [templateType, setTemplateType] = useState<string>('problem_direct');
	const [candidateCount, setCandidateCount] = useState<number>(3);
	const [sourceCreativeId, setSourceCreativeId] = useState<string>(initialCreativeId);
	const [sources, setSources] = useState<GfaCreativeGeneratorSources | null>(null);
	const [runs, setRuns] = useState<GfaCreativeGeneratorRun[]>([]);
	const [fontOptions, setFontOptions] = useState<GfaCreativeGeneratorFont[]>([]);
	const [selectedRun, setSelectedRun] = useState<GfaCreativeGeneratorRun | null>(null);
	const [loadingSources, setLoadingSources] = useState(false);
	const [generating, setGenerating] = useState(false);
	const [reviewing, setReviewing] = useState<string>('');
	const [message, setMessage] = useState<string>('');
	const [additionalReferenceText, setAdditionalReferenceText] = useState<string>('');
	const [referenceFiles, setReferenceFiles] = useState<File[]>([]);
	const [generationSource, setGenerationSource] = useState<'existing' | 'appeal'>(initialGenerationSource);
	const [appealPointId, setAppealPointId] = useState<string>(initialAppealPointId);
	const [regeneratingImage, setRegeneratingImage] = useState<string>('');
	const [savingCopy, setSavingCopy] = useState<string>('');
	const [copyDrafts, setCopyDrafts] = useState<Record<string, { headline: string; subcopy: string; proofLine: string; cta: string; ctaEnabled: boolean; landingMessage: string }>>({});
	const [overlayDrafts, setOverlayDrafts] = useState<Record<string, OverlayLayout>>({});
	const [activeOverlayKey, setActiveOverlayKey] = useState<OverlayKey>('headline');
	const [imageLockedByRun, setImageLockedByRun] = useState<Record<string, boolean>>({});
	const [brokenImageRunIds, setBrokenImageRunIds] = useState<Record<string, boolean>>({});
	const dateRangeInvalid = isInvalidDateRange(dateFrom, dateTo);

	const imageBrokenKey = (runId: string, kind: 'base' | 'final'): string => `${kind}:${runId}`;
	const setImageBroken = (runId: string, kind: 'base' | 'final', value: boolean) => {
		setBrokenImageRunIds((prev) => ({ ...prev, [imageBrokenKey(runId, kind)]: value }));
	};
	const clearImageBroken = (runId: string) => {
		setBrokenImageRunIds((prev) => ({ ...prev, [runId]: false, [imageBrokenKey(runId, 'base')]: false, [imageBrokenKey(runId, 'final')]: false }));
	};

	const loadSources = async () => {
		if (dateRangeInvalid) {
			setSources(null);
			setSourceCreativeId('');
			setMessage('분석 조회 기간을 확인하세요. 시작일은 종료일보다 늦을 수 없습니다.');
			return;
		}
		setLoadingSources(true);
		setMessage('');
		try {
			const data = await fetchGfaCreativeGeneratorSources({ baseUrl: props.apiBaseUrl, dateFrom, dateTo });
			setSources(data);
			const first =
				(data.candidates || []).find((x) => x.creative_id === sourceCreativeId) ||
				(data.candidates || []).find((x) => x.recommended_goal === goal) ||
				(data.candidates || [])[0];
			setSourceCreativeId(first?.creative_id || '');
		} catch (e) {
			setMessage(errorText(e));
		} finally {
			setLoadingSources(false);
		}
	};

	const loadRuns = async () => {
		try {
			const data = await fetchGfaCreativeGeneratorRuns({ baseUrl: props.apiBaseUrl, limit: 80 });
			setRuns(data);
			setSelectedRun((prev) => prev || data.find((x) => x.status === 'generated') || null);
		} catch (e) {
			setMessage(errorText(e));
		}
	};

	const loadFonts = async () => {
		try {
			const data = await fetchGfaCreativeGeneratorFonts({ baseUrl: props.apiBaseUrl });
			setFontOptions(data);
		} catch {
			setFontOptions([]);
		}
	};

	useEffect(() => {
		void loadSources();
		void loadRuns();
		void loadFonts();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const templates = sources?.templates || [];
	const candidates = sources?.candidates || [];
	const goalCandidates = useMemo(
		() => candidates.filter((x) => !goal || x.recommended_goal === goal || candidates.filter((y) => y.recommended_goal === goal).length === 0),
		[candidates, goal],
	);
	const selectedCandidate = useMemo(
		() => candidates.find((x) => x.creative_id === sourceCreativeId) || goalCandidates[0] || candidates[0],
		[candidates, goalCandidates, sourceCreativeId],
	);
	const selectedTemplate = useMemo(
		() => templates.find((x) => x.type === templateType) || templates[0],
		[templateType, templates],
	);
	const selectedMetrics = selectedCandidate?.metrics || {};

	const createRun = async () => {
		if (dateRangeInvalid) {
			setMessage('분석 조회 기간을 확인하세요. 시작일은 종료일보다 늦을 수 없습니다.');
			return;
		}
		if (!selectedCandidate?.creative_id) {
			setMessage('생성 가능한 소재 후보가 없습니다. 먼저 GFA 전략 도출/소재 분석 데이터를 확인하세요.');
			return;
		}
		setGenerating(true);
		setMessage('');
		try {
			const createdRuns = await createGfaCreativeGeneratorRun({
				baseUrl: props.apiBaseUrl,
				goal,
				templateType,
				sourceCreativeId: selectedCandidate.creative_id,
				dateFrom,
				dateTo,
				candidateCount,
				additionalReferenceText,
				referenceFiles,
				generationSource,
				appealPointId: appealPointId || undefined,
			});
			const firstGenerated = createdRuns.find((x) => x.status === 'generated') || createdRuns[0] || null;
			setSelectedRun(firstGenerated);
			if (firstGenerated?.id) clearImageBroken(firstGenerated.id);
			await loadRuns();
			const successCount = createdRuns.filter((x) => x.status === 'generated').length;
			setMessage(successCount > 0 ? `소재 후보 ${successCount}/${createdRuns.length}장 생성 완료` : `생성 실패: ${friendlyGenerationError(createdRuns[0]?.error || 'unknown')}`);
		} catch (e) {
			setMessage(errorText(e));
		} finally {
			setGenerating(false);
		}
	};

	const copyToClipboard = async (text: string, label: string) => {
		if (!text.trim()) {
			setMessage(`${label} 내용이 없습니다.`);
			return;
		}
		try {
			await navigator.clipboard.writeText(text);
			setMessage(`${label} 복사 완료`);
		} catch {
			setMessage(`${label} 복사 실패. 브라우저 권한을 확인하세요.`);
		}
	};

	const copyDraftFor = (run: GfaCreativeGeneratorRun) => {
		const copy = run.copy_result || {};
		return copyDrafts[run.id] || {
			headline: editableText(copy.headline, ''),
			subcopy: editableText(copy.subcopy, ''),
			proofLine: compactText(copy.proof_line, ''),
			cta: compactText(copy.cta, ''),
			ctaEnabled: copy.cta_enabled !== false,
			landingMessage: compactText(copy.landing_message, ''),
		};
	};

	const setCopyDraftField = (run: GfaCreativeGeneratorRun, key: 'headline' | 'subcopy' | 'proofLine' | 'cta' | 'landingMessage', value: string) => {
		setCopyDrafts((prev) => ({ ...prev, [run.id]: { ...copyDraftFor(run), [key]: value } }));
	};

	const setCopyDraftCtaEnabled = (run: GfaCreativeGeneratorRun, value: boolean) => {
		setCopyDrafts((prev) => ({ ...prev, [run.id]: { ...copyDraftFor(run), ctaEnabled: value } }));
	};

	const overlayFor = (run: GfaCreativeGeneratorRun): OverlayLayout => overlayDrafts[run.id] || overlayFromValue(run.copy_result?.overlay_layout);
	const renderFontOptions = () => {
		const fonts = fontOptions.length ? fontOptions : [
			{ id: 'noto_sans', label: '고딕 기본', source: 'default' },
			{ id: 'noto_serif', label: '명조 기본', source: 'default' },
		];
		return fonts.map((font) => (
			<option key={font.id} value={font.id} style={{ fontFamily: font.family ? `"${font.family}", system-ui, sans-serif` : undefined }}>
				{font.label}{font.source === 'windows' ? ' · Windows' : ''}
			</option>
		));
	};

	const setOverlayItem = (run: GfaCreativeGeneratorRun, key: OverlayKey, patch: Partial<OverlayItem>) => {
		setOverlayDrafts((prev) => {
			const current = prev[run.id] || overlayFor(run);
			return { ...prev, [run.id]: { ...current, [key]: { ...current[key], ...patch } } };
		});
	};

	const renderEditableCanvas = (run: GfaCreativeGeneratorRun, options?: { maxWidth?: number; large?: boolean }): JSX.Element => {
		const imageSrc = run.image_url ? `${assetUrl(props.apiBaseUrl, run.image_url)}${run.updated_at ? `?v=${encodeURIComponent(run.updated_at)}` : ''}` : '';
		const baseImageSrc = run.base_image_url ? `${assetUrl(props.apiBaseUrl, run.base_image_url)}${run.updated_at ? `?v=${encodeURIComponent(run.updated_at)}` : ''}` : '';
		const baseImageBroken = Boolean(brokenImageRunIds[imageBrokenKey(run.id, 'base')]);
		const finalImageBroken = Boolean(brokenImageRunIds[imageBrokenKey(run.id, 'final')] || brokenImageRunIds[run.id]);
		const draft = copyDraftFor(run);
		const canLockImage = Boolean(run.can_lock_image);
		const overlay = overlayFor(run);
		const shouldRenderOverlay = canLockImage && Boolean(baseImageSrc) && !baseImageBroken;
		const overlayText = {
			headline: shouldRenderOverlay ? draft.headline : '',
			subcopy: shouldRenderOverlay ? draft.subcopy : '',
			proof: shouldRenderOverlay ? draft.proofLine : '',
			cta: shouldRenderOverlay && draft.ctaEnabled ? draft.cta : '',
		} as Record<OverlayKey, string>;
		return (
			<GfaCanvasEditor
				baseImageSrc={baseImageSrc}
				finalImageSrc={imageSrc}
				baseImageBroken={baseImageBroken}
				finalImageBroken={finalImageBroken}
				alt={run.source_creative_name || 'generated creative'}
				overlay={overlay}
				texts={overlayText}
				activeKey={activeOverlayKey}
				onActiveKeyChange={setActiveOverlayKey}
				onOverlayChange={(key, patch) => setOverlayItem(run, key, patch)}
				canEdit={canLockImage}
				maxWidth={options?.maxWidth ?? 360}
				large={options?.large}
				fontOptions={fontOptions}
				onImageError={(kind) => setImageBroken(run.id, kind, true)}
				onImageLoad={(kind) => setImageBroken(run.id, kind, false)}
			/>
		);
	};

	const saveRunCopy = async (run: GfaCreativeGeneratorRun): Promise<GfaCreativeGeneratorRun | null> => {
		const draft = copyDraftFor(run);
		setSavingCopy(run.id);
		setMessage('');
		try {
			const next = await updateGfaCreativeGeneratorRunCopy({
				baseUrl: props.apiBaseUrl,
				runId: run.id,
				headline: draft.headline,
				subcopy: draft.subcopy,
				proofLine: draft.proofLine,
				cta: draft.cta,
				ctaEnabled: draft.ctaEnabled,
				overlayLayout: overlayFor(run),
				landingMessage: draft.landingMessage,
				note: '카피 미리보기 수동 수정',
			});
			setSelectedRun(next);
			setRuns((prev) => prev.map((x) => (x.id === next.id ? next : x)));
			setCopyDrafts((prev) => {
				const updated = { ...prev };
				delete updated[run.id];
				return updated;
			});
			setOverlayDrafts((prev) => {
				const updated = { ...prev };
				delete updated[run.id];
				return updated;
			});
			setMessage('카피 수정 저장 완료');
			return next;
		} catch (e) {
			setMessage(errorText(e));
			return null;
		} finally {
			setSavingCopy('');
		}
	};

	const regenerateRunImageFromCopy = async (run: GfaCreativeGeneratorRun) => {
		setRegeneratingImage(run.id);
		setMessage('');
		try {
			const saved = await saveRunCopy(run);
			if (!saved) return;
			const canLockImage = saved.can_lock_image !== false && Boolean(saved.can_lock_image);
			const imageLocked = canLockImage && imageLockedByRun[run.id] !== false;
			const next = await regenerateGfaCreativeGeneratorRunImage({
				baseUrl: props.apiBaseUrl,
				runId: saved.id,
				imageLocked,
				note: imageLocked ? '이미지는 고정하고 수정 저장된 카피만 다시 합성' : '수정 저장된 카피로 이미지까지 재생성',
			});
			setSelectedRun(next);
			setRuns((prev) => prev.map((x) => (x.id === next.id ? next : x)));
			clearImageBroken(next.id);
			setMessage(imageLocked ? '이미지 고정 상태로 카피만 다시 합성 완료' : '수정 저장된 카피로 이미지 재생성 완료');
		} catch (e) {
			setMessage(errorText(e));
		} finally {
			setRegeneratingImage('');
		}
	};

	const upsertRun = (next: GfaCreativeGeneratorRun) => {
		setSelectedRun(next);
		setRuns((prev) => prev.map((x) => (x.id === next.id ? next : x)));
		clearImageBroken(next.id);
	};

	const updateReview = async (run: GfaCreativeGeneratorRun, reviewerStatus: string) => {
		setReviewing(run.id);
		setMessage('');
		try {
			const next = await reviewGfaCreativeGeneratorRun({
				baseUrl: props.apiBaseUrl,
				runId: run.id,
				reviewerStatus,
				reviewerNote: run.reviewer_note || '',
			});
			setSelectedRun(next);
			setRuns((prev) => prev.map((x) => (x.id === next.id ? next : x)));
		} catch (e) {
			setMessage(errorText(e));
		} finally {
			setReviewing('');
		}
	};

	const addEvent = async (run: GfaCreativeGeneratorRun, eventType: 'selected' | 'ad_used' | 'feedback' | 'note') => {
		let note = '';
		let usedCreativeName = '';
		let feedbackSummary = '';
		if (eventType === 'ad_used') {
			usedCreativeName = window.prompt('실제 광고 소재명 또는 광고센터에 등록한 이름을 입력하세요.', run.source_creative_name || '') || '';
			if (!usedCreativeName.trim()) return;
			note = window.prompt('사용 메모를 입력하세요. 예: 7월 구매유도 캠페인 A/B 테스트', '') || '';
		} else if (eventType === 'feedback') {
			feedbackSummary = window.prompt('집행 후 피드백을 입력하세요. 예: CTR은 높았지만 구매전환 약함', run.feedback_summary || '') || '';
			if (!feedbackSummary.trim()) return;
			note = feedbackSummary;
		} else if (eventType === 'selected') {
			note = window.prompt('선택 사유를 입력하세요. 예: 문제 직격형 메시지가 가장 명확함', '') || '소재 후보 선택';
		} else {
			note = window.prompt('기록할 메모를 입력하세요.', '') || '';
			if (!note.trim()) return;
		}
		setReviewing(run.id);
		setMessage('');
		try {
			const next = await addGfaCreativeGeneratorEvent({
				baseUrl: props.apiBaseUrl,
				runId: run.id,
				eventType,
				note,
				usageStatus: eventType === 'ad_used' ? 'used' : undefined,
				usedCreativeName,
				feedbackSummary,
			});
			setSelectedRun(next);
			setRuns((prev) => prev.map((x) => (x.id === next.id ? next : x)));
			setMessage('이력 기록 완료');
		} catch (e) {
			setMessage(errorText(e));
		} finally {
			setReviewing('');
		}
	};

	const renderRunPreview = (run: GfaCreativeGeneratorRun | null): JSX.Element => {
		if (!run) {
			return <div style={{ fontSize: 12, color: '#94a3b8' }}>아직 생성된 시안이 없습니다.</div>;
		}
		const copy = run.copy_result || {};
		const explanation = run.generation_explanation || {};
		const creativeScore = (copy.creative_score_detail || explanation.creative_score || {}) as {
			creative_score?: number;
			candidate_scores?: Record<string, number>;
			strengths?: string[];
			weaknesses?: string[];
			improvement_suggestions?: string[];
		};
		const draft = copyDraftFor(run);
		const scoreValue = estimateCreativeScore(run, draft) || Number(copy.creative_score || creativeScore.creative_score || 0);
		const canLockImage = Boolean(run.can_lock_image);
		const imageLocked = canLockImage && imageLockedByRun[run.id] !== false;
		const overlay = overlayFor(run);
		const renderTypographyControl = (key: OverlayKey, label: string) => {
			const item = overlay[key];
			return (
				<div key={key} style={{ display: 'grid', gridTemplateColumns: '76px minmax(0, 1fr) minmax(0, 1fr)', gap: 6, alignItems: 'center' }}>
					<div style={{ fontSize: 11, color: '#cbd5e1', fontWeight: 800 }}>{label}</div>
					<select value={item.font_family} onChange={(e) => setOverlayItem(run, key, { font_family: e.target.value })} style={{ width: '100%' }}>
						{renderFontOptions()}
					</select>
					<label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: '#94a3b8' }}>
						크기
						<input
							type="range"
							min="0.7"
							max="1.5"
							step="0.05"
							value={item.font_scale}
							onChange={(e) => setOverlayItem(run, key, { font_scale: Number(e.target.value) })}
							style={{ width: '100%' }}
						/>
					</label>
				</div>
			);
		};
		return (
			<div style={{ display: 'grid', gap: 12 }}>
				{renderEditableCanvas(run, { maxWidth: 360 })}
				<GfaCreativeImageReplacementPanel
					apiBaseUrl={props.apiBaseUrl}
					run={run}
					onRunUpdated={upsertRun}
					onMessage={setMessage}
				/>
				<div style={{ display: 'grid', gap: 8, border: '1px solid rgba(148,163,184,0.16)', borderRadius: 12, padding: 10, background: 'rgba(15,23,42,0.42)' }}>
					<div className="card-title" style={{ marginBottom: 0 }}>후보 {run.candidate_index || 1}/{run.candidate_count || 1} · 카피 미리보기/수정</div>
					<label style={{ display: 'grid', gap: 4, fontSize: 12, color: '#cbd5e1' }}>
						메인카피
						<textarea
							className="input"
							value={draft.headline}
							onChange={(e) => setCopyDraftField(run, 'headline', e.target.value)}
							rows={2}
							maxLength={80}
							style={{ width: '100%', resize: 'vertical', minHeight: 56, whiteSpace: 'pre-wrap' }}
						/>
					</label>
					<label style={{ display: 'grid', gap: 4, fontSize: 12, color: '#cbd5e1' }}>
						서브카피
						<textarea
							className="input"
							value={draft.subcopy}
							onChange={(e) => setCopyDraftField(run, 'subcopy', e.target.value)}
							rows={2}
							maxLength={120}
							style={{ width: '100%', resize: 'vertical', minHeight: 56, whiteSpace: 'pre-wrap' }}
						/>
					</label>
					<div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 8 }}>
						<label style={{ display: 'grid', gap: 4, fontSize: 12, color: '#cbd5e1' }}>
							증거/보조문구
							<input value={draft.proofLine} onChange={(e) => setCopyDraftField(run, 'proofLine', e.target.value)} maxLength={60} style={{ width: '100%' }} />
						</label>
						<label style={{ display: 'grid', gap: 4, fontSize: 12, color: '#cbd5e1' }}>
							CTA 표시
							<select value={draft.ctaEnabled ? 'show' : 'hide'} onChange={(e) => setCopyDraftCtaEnabled(run, e.target.value === 'show')} style={{ width: '100%' }}>
								<option value="show">CTA 넣기</option>
								<option value="hide">CTA 빼기</option>
							</select>
						</label>
					</div>
					<label style={{ display: 'grid', gap: 4, fontSize: 12, color: draft.ctaEnabled ? '#cbd5e1' : '#64748b' }}>
						CTA 문구
						<input value={draft.cta} onChange={(e) => setCopyDraftField(run, 'cta', e.target.value)} disabled={!draft.ctaEnabled} maxLength={30} style={{ width: '100%' }} />
					</label>
					<label style={{ display: 'grid', gap: 4, fontSize: 12, color: '#cbd5e1' }}>
						랜딩 메시지
						<input value={draft.landingMessage} onChange={(e) => setCopyDraftField(run, 'landingMessage', e.target.value)} maxLength={120} style={{ width: '100%' }} />
					</label>
					<div style={{ display: 'grid', gap: 6, border: '1px solid rgba(148,163,184,0.14)', borderRadius: 10, padding: 8 }}>
						<div style={{ fontSize: 12, fontWeight: 900, color: '#e5e7eb' }}>텍스트 위치/글꼴/크기</div>
						<div style={{ fontSize: 11, color: '#94a3b8' }}>미리보기 위 텍스트 박스를 드래그하면 위치가 바뀝니다. 저장 후 이미지 반영 시 같은 위치로 합성됩니다.</div>
						{renderTypographyControl('headline', '메인')}
						{renderTypographyControl('subcopy', '서브')}
						{renderTypographyControl('proof', '증거')}
					</div>
					<label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: '#cbd5e1' }}>
						<input
							type="checkbox"
							checked={imageLocked}
							disabled={!canLockImage}
							onChange={(e) => setImageLockedByRun((prev) => ({ ...prev, [run.id]: e.target.checked }))}
						/>
						이미지 고정: 배경 이미지는 그대로 두고 카피만 다시 합성
					</label>
					{!canLockImage ? (
						<div style={{ fontSize: 11, color: '#fbbf24' }}>
							이 시안은 원본 배경/텍스트 레이어 분리 저장 이전에 생성되어 이미지 고정을 사용할 수 없습니다. 먼저 이미지까지 한 번 재생성하면 이후부터 카피만 반영할 수 있습니다.
						</div>
					) : null}
					<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
						<button type="button" className="btn-primary" onClick={() => void saveRunCopy(run)} disabled={savingCopy === run.id}>
							{savingCopy === run.id ? '카피 저장 중...' : '카피만 저장'}
						</button>
						<button type="button" className="btn-ghost" onClick={() => void regenerateRunImageFromCopy(run)} disabled={savingCopy === run.id || regeneratingImage === run.id}>
							{regeneratingImage === run.id ? '이미지 반영 중...' : imageLocked ? '이미지 고정 + 카피만 반영' : '수정 카피로 이미지까지 재생성'}
						</button>
						<div style={{ fontSize: 11, color: '#94a3b8' }}>상단 생성 버튼은 새 후보를 다시 만드는 기능입니다. 카피만 바꾸려면 이미지 고정을 켠 상태로 이 버튼을 사용하세요.</div>
					</div>
				</div>
				{scoreValue > 0 ? (
					<div style={{ display: 'grid', gap: 8, border: '1px solid rgba(34,197,94,0.28)', borderRadius: 12, padding: 10, background: 'rgba(22,101,52,0.12)' }}>
						<div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
							<div style={{ fontSize: 13, fontWeight: 900, color: '#bbf7d0' }}>Creative Score</div>
							<div style={{ fontSize: 22, fontWeight: 900, color: '#86efac' }}>{scoreValue.toFixed(1)}</div>
						</div>
						{creativeScore.candidate_scores ? (
							<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11, color: '#cbd5e1' }}>
								{Object.entries(creativeScore.candidate_scores).slice(0, 7).map(([k, v]) => (
									<span key={k} className="badge-muted">{k} {Number(v || 0).toFixed(0)}</span>
								))}
							</div>
						) : null}
						{(creativeScore.strengths || []).length ? <div style={{ fontSize: 12, color: '#dcfce7' }}>강점: {(creativeScore.strengths || []).join(' · ')}</div> : null}
						{(creativeScore.weaknesses || []).length ? <div style={{ fontSize: 12, color: '#fde68a' }}>약점: {(creativeScore.weaknesses || []).join(' · ')}</div> : null}
						{(creativeScore.improvement_suggestions || []).length ? <div style={{ fontSize: 12, color: '#bfdbfe' }}>추천 개선: {(creativeScore.improvement_suggestions || []).join(' · ')}</div> : null}
					</div>
				) : null}
				<div style={{ display: 'grid', gap: 6, borderTop: '1px solid rgba(148,163,184,0.16)', paddingTop: 10 }}>
					<div style={{ fontSize: 13, fontWeight: 900, color: '#e5e7eb' }}>이 후보를 이렇게 만든 이유</div>
					<div style={{ fontSize: 12, color: '#bfdbfe', lineHeight: 1.5 }}>{compactText(explanation.summary, '제작 설명 없음')}</div>
					{(explanation.why_image || []).map((x, idx) => (
						<div key={`img-${idx}`} style={{ fontSize: 12, color: '#cbd5e1' }}>이미지 {idx + 1}. {x}</div>
					))}
					{(explanation.why_copy || []).map((x, idx) => (
						<div key={`copy-${idx}`} style={{ fontSize: 12, color: '#cbd5e1' }}>카피 {idx + 1}. {x}</div>
					))}
					{explanation.feedback_hint ? <div style={{ fontSize: 12, color: '#fef3c7' }}>{explanation.feedback_hint}</div> : null}
				</div>
				{run.error ? <div style={{ color: '#fca5a5', fontSize: 12, fontWeight: 800 }}>{friendlyGenerationError(run.error)}</div> : null}
				<div style={{ display: 'grid', gap: 8, borderTop: '1px solid rgba(148,163,184,0.16)', paddingTop: 10 }}>
					<div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
						<div style={{ fontSize: 13, fontWeight: 900, color: '#e5e7eb' }}>생성 프롬프트</div>
						<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
							<button type="button" className="btn-ghost" onClick={() => void copyToClipboard(run.copy_prompt || '', 'GPT 카피 프롬프트')}>GPT 복사</button>
							<button type="button" className="btn-ghost" onClick={() => void copyToClipboard(run.image_prompt || '', 'GPT 이미지 프롬프트')}>GPT 이미지 복사</button>
						</div>
					</div>
					<details>
						<summary style={{ cursor: 'pointer', color: '#bfdbfe', fontSize: 12, fontWeight: 800 }}>GPT 카피 생성 프롬프트 보기</summary>
						<pre style={{ marginTop: 8, maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 11, color: '#cbd5e1', background: 'rgba(15,23,42,0.75)', border: '1px solid rgba(148,163,184,0.18)', borderRadius: 8, padding: 10 }}>
							{run.copy_prompt || '프롬프트 없음'}
						</pre>
					</details>
					<details>
						<summary style={{ cursor: 'pointer', color: '#bfdbfe', fontSize: 12, fontWeight: 800 }}>GPT 이미지 생성 프롬프트 보기</summary>
						<pre style={{ marginTop: 8, maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 11, color: '#cbd5e1', background: 'rgba(15,23,42,0.75)', border: '1px solid rgba(148,163,184,0.18)', borderRadius: 8, padding: 10 }}>
							{run.image_prompt || '프롬프트 없음'}
						</pre>
					</details>
				</div>
				<div style={{ display: 'grid', gap: 6, borderTop: '1px solid rgba(148,163,184,0.16)', paddingTop: 10 }}>
					<div style={{ fontSize: 13, fontWeight: 900, color: '#e5e7eb' }}>누적 이력</div>
					<div style={{ fontSize: 12, color: '#cbd5e1' }}>
						검수 {statusLabel(run.reviewer_status)} · 사용상태 {run.usage_status || 'not_used'} · 사용소재 {run.used_creative_name || '-'}
					</div>
					{(run.events || []).length ? (run.events || []).map((ev) => (
						<div key={ev.event_id} style={{ fontSize: 12, color: '#94a3b8' }}>
							{ev.created_at ? new Date(ev.created_at).toLocaleString('ko-KR') : '-'} · {ev.event_type} · {ev.note || '-'}
						</div>
					)) : <div style={{ fontSize: 12, color: '#64748b' }}>아직 누적 이력이 없습니다.</div>}
				</div>
			</div>
		);
	};

	return (
		<div style={{ display: 'grid', gap: 14 }}>
			<div className="card">
				<div className="card-title">GFA 소재 생성</div>
				<div className="card-caption">
					소재 제작 최적값을 기준으로 제작 브리프를 만들고, GPT로 카피/CTA와 광고 이미지 시안을 생성합니다.
				</div>
				<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
					<input className="input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={{ maxWidth: 160, borderColor: dateRangeInvalid ? '#f87171' : undefined }} />
					<span style={{ color: '#94a3b8', fontSize: 12 }}>~</span>
					<input className="input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={{ maxWidth: 160, borderColor: dateRangeInvalid ? '#f87171' : undefined }} />
					<button type="button" className="btn-ghost" onClick={loadSources} disabled={loadingSources || generating || dateRangeInvalid}>
						{loadingSources ? '불러오는 중...' : '분석 소스 새로고침'}
					</button>
					<label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#cbd5e1', fontSize: 12 }}>
						후보
						<select className="input" value={candidateCount} onChange={(e) => setCandidateCount(Number(e.target.value) || 3)} style={{ width: 76 }}>
							<option value={1}>1장</option>
							<option value={2}>2장</option>
							<option value={3}>3장</option>
							<option value={4}>4장</option>
							<option value={5}>5장</option>
						</select>
					</label>
					<button type="button" className="btn-primary" onClick={createRun} disabled={generating || loadingSources || !selectedCandidate || dateRangeInvalid}>
						{generating ? '생성 중...' : '새 후보 생성(GPT 카피 + 이미지)'}
					</button>
					{dateRangeInvalid ? <span style={{ fontSize: 12, fontWeight: 900, color: '#fca5a5' }}>기간 오류: 시작일이 종료일보다 늦습니다.</span> : null}
					{message ? <span style={{ fontSize: 12, fontWeight: 900, color: message.includes('실패') || message.includes('오류') ? '#fca5a5' : '#bbf7d0' }}>{message}</span> : null}
				</div>
			</div>

			<div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 0.8fr) minmax(360px, 1.2fr) minmax(360px, 1.2fr)', gap: 12, alignItems: 'start' }}>
				<div className="card" style={{ display: 'grid', gap: 12 }}>
					<div className="card-title">1. 생성 조건</div>
					<div style={{ display: 'grid', gap: 8 }}>
						<div className="field-label">생성 Source</div>
						<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
							<button
								type="button"
								className={generationSource === 'existing' ? 'btn-primary' : 'btn-ghost'}
								onClick={() => setGenerationSource('existing')}
							>
								기존 소재 분석
							</button>
							<button
								type="button"
								className={generationSource === 'appeal' ? 'btn-primary' : 'btn-ghost'}
								onClick={() => setGenerationSource('appeal')}
							>
								AI 소구포인트
							</button>
						</div>
						{generationSource === 'appeal' ? (
							<>
								<label className="field-label">Appeal Point ID</label>
								<input className="input" value={appealPointId} onChange={(e) => setAppealPointId(e.target.value)} placeholder="예: AP-..." />
								<div style={{ fontSize: 12, color: '#94a3b8' }}>AI 콘텐츠 센터에서 선택한 소구를 현재 GFA 생성 브리프에 연결합니다.</div>
							</>
						) : null}
					</div>
					<div style={{ display: 'grid', gap: 8 }}>
						<div className="field-label">목적</div>
						{GOALS.map((g) => (
							<button
								key={g.key}
								type="button"
								className={goal === g.key ? 'btn-primary' : 'btn-ghost'}
								onClick={() => {
									setGoal(g.key);
									const first = candidates.find((x) => x.recommended_goal === g.key);
									if (first?.creative_id) setSourceCreativeId(first.creative_id);
								}}
								style={{ textAlign: 'left' }}
							>
								<strong>{g.label}</strong>
								<br />
								<span style={{ fontSize: 11, color: '#cbd5e1' }}>{g.hint}</span>
							</button>
						))}
					</div>
					<div style={{ display: 'grid', gap: 6 }}>
						<label className="field-label">시안 구조</label>
						<select className="input" value={templateType} onChange={(e) => setTemplateType(e.target.value)}>
							{templates.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
						</select>
						<div style={{ fontSize: 12, color: '#94a3b8' }}>{selectedTemplate?.psychology || '-'}</div>
					</div>
					<div style={{ display: 'grid', gap: 6 }}>
						<label className="field-label">기준 소재</label>
						<select className="input" value={sourceCreativeId} onChange={(e) => setSourceCreativeId(e.target.value)}>
							{goalCandidates.map((c) => (
								<option key={c.creative_id || c.creative_name} value={c.creative_id || ''}>
									{c.grade || '-'} · {c.creative_name || c.creative_id}
								</option>
							))}
						</select>
					</div>
				</div>

				<div className="card" style={{ display: 'grid', gap: 10 }}>
					<div className="card-title">2. 분석 기반 제작 브리프</div>
					{selectedCandidate ? (
						<>
							<div style={{ display: 'flex', gap: 10 }}>
								{selectedCandidate.image_url ? <img src={assetUrl(props.apiBaseUrl, selectedCandidate.image_url)} alt="" style={{ width: 92, height: 62, objectFit: 'cover', borderRadius: 8 }} /> : null}
								<div>
									<strong>{selectedCandidate.creative_name || selectedCandidate.creative_id}</strong>
									<div style={{ fontSize: 12, color: '#94a3b8' }}>{selectedCandidate.ad_product_type || '-'} · {selectedCandidate.recommended_goal_label || '-'}</div>
									<div style={{ fontSize: 12, color: '#cbd5e1' }}>등급 {selectedCandidate.grade || '-'} · CTR {pct(selectedMetrics.ctr)} · 총CVR {pct(selectedMetrics.total_cvr)} · 구매CVR {pct(selectedMetrics.purchase_cvr)}</div>
								</div>
							</div>
							<div className="badge-muted">이미지: {compactText(selectedCandidate.image_summary, '분석 필요')}</div>
							<div className="badge-muted" style={{ whiteSpace: 'pre-wrap' }}>카피/소구: {compactText(selectedCandidate.copy_summary, '분석 필요')}</div>
							<div className="badge-muted">OpenCV: {compactText(selectedCandidate.opencv_summary, '분석 필요')}</div>
							<div style={{ fontSize: 12, color: '#d1d5db', lineHeight: 1.5 }}>{compactText(selectedCandidate.creative_direction, '제작 방향 데이터 부족')}</div>
							<div style={{ fontSize: 12, color: '#fef3c7' }}>제작 가이드: 문제/혜택/증거/CTA 순서, 메시지 1개, 혜택 1개, CTA 1개. 근거 없는 숫자와 효능은 생성하지 않습니다.</div>
							<div style={{ display: 'grid', gap: 8, border: '1px dashed rgba(248,113,113,0.65)', borderRadius: 10, padding: 10, background: 'rgba(127,29,29,0.12)' }}>
								<div style={{ fontSize: 13, fontWeight: 900, color: '#fecaca' }}>추가 참고자료</div>
								<div style={{ fontSize: 12, color: '#cbd5e1' }}>
									브랜드 톤, 금지 표현, 제품 설명, 외부 참고 이미지 등을 넣으면 GPT 카피와 GPT 이미지 생성에 함께 사용합니다. 비워두면 기존 분석값만으로 생성합니다.
								</div>
								<textarea
									className="input"
									value={additionalReferenceText}
									onChange={(e) => setAdditionalReferenceText(e.target.value)}
									placeholder="예: 브랜드 톤은 고급스럽고 차분하게. 두피 민감 고객 대상. 의학적 치료 표현 금지. CTA는 '지금 확인하기' 계열 선호."
									rows={4}
									style={{ minHeight: 96, resize: 'vertical' }}
								/>
								<input
									className="input"
									type="file"
									multiple
									accept=".txt,.md,.csv,.json,.html,.htm,.docx,image/*"
									onChange={(e) => setReferenceFiles(Array.from(e.target.files || []))}
								/>
								<div style={{ fontSize: 12, color: '#94a3b8' }}>
									{referenceFiles.length ? `첨부 ${referenceFiles.length}개: ${referenceFiles.map((f) => f.name).join(', ')}` : '첨부 없음'}
								</div>
							</div>
						</>
					) : (
						<div style={{ fontSize: 12, color: '#94a3b8' }}>{loadingSources ? '전략 분석 소스 계산 중입니다. 완료되면 후보와 제작 브리프가 표시됩니다.' : '분석 가능한 후보가 없습니다.'}</div>
					)}
				</div>

				<div className="card">
					<div className="card-title">3. 생성 결과 미리보기</div>
					{renderRunPreview(selectedRun)}
				</div>
			</div>

			<div className="card">
				<div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
					<div className="card-title" style={{ marginBottom: 0 }}>생성 이력 / 검수</div>
					<button type="button" className="btn-ghost" onClick={loadRuns}>이력 새로고침</button>
				</div>
				<div style={{ overflowX: 'auto' }}>
					<table className="table" style={{ minWidth: 980 }}>
						<thead>
							<tr>
								<th>생성일</th>
								<th>목적</th>
								<th>구조</th>
								<th>후보</th>
								<th>기준 소재</th>
								<th>상태</th>
								<th>검수</th>
								<th>사용</th>
								<th>액션</th>
							</tr>
						</thead>
						<tbody>
							{runs.map((run) => (
								<tr key={run.id}>
									<td>{run.created_at ? new Date(run.created_at).toLocaleString('ko-KR') : '-'}</td>
									<td>{run.goal_label}</td>
									<td>{run.template_label}</td>
									<td>{run.candidate_index || 1}/{run.candidate_count || 1}</td>
									<td>{run.source_creative_name || run.source_creative_id || '-'}</td>
									<td style={{ color: run.status === 'generated' ? '#bbf7d0' : '#fca5a5', fontWeight: 900 }}>{run.status}</td>
									<td>{statusLabel(run.reviewer_status)}</td>
									<td>{run.usage_status || 'not_used'}<br /><span style={{ color: '#94a3b8' }}>{run.used_creative_name || '-'}</span></td>
									<td>
										<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
											<button type="button" className="btn-ghost" onClick={() => setSelectedRun(run)}>보기</button>
											<button type="button" className="btn-ghost" disabled={reviewing === run.id} onClick={() => addEvent(run, 'selected')}>선택기록</button>
											<button type="button" className="btn-ghost" disabled={reviewing === run.id} onClick={() => addEvent(run, 'ad_used')}>광고사용</button>
											<button type="button" className="btn-ghost" disabled={reviewing === run.id} onClick={() => addEvent(run, 'feedback')}>피드백</button>
											<button type="button" className="btn-ghost" disabled={reviewing === run.id} onClick={() => updateReview(run, 'accepted')}>채택</button>
											<button type="button" className="btn-ghost" disabled={reviewing === run.id} onClick={() => updateReview(run, 'hold')}>보류</button>
											<button type="button" className="btn-ghost" disabled={reviewing === run.id} onClick={() => updateReview(run, 'rejected')}>폐기</button>
										</div>
									</td>
								</tr>
							))}
							{runs.length === 0 ? (
								<tr>
									<td colSpan={9} style={{ color: '#94a3b8' }}>생성 이력이 없습니다.</td>
								</tr>
							) : null}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	);
}

function scoreColor(score: number): string {
	if (score >= 85) return '#86efac';
	if (score >= 70) return '#fde047';
	if (score >= 55) return '#fdba74';
	return '#fca5a5';
}

function renderTextList(items?: string[]): JSX.Element {
	const rows = (items || []).filter((x) => String(x || '').trim());
	if (!rows.length) return <div style={{ color: '#64748b', fontSize: 12 }}>표시할 항목이 없습니다.</div>;
	return (
		<ul style={{ margin: '10px 0 0', paddingLeft: 18, display: 'grid', gap: 7 }}>
			{rows.map((item, idx) => (
				<li key={`${item}-${idx}`} style={{ color: '#334155', fontSize: 12, lineHeight: 1.45 }}>{item}</li>
			))}
		</ul>
	);
}

function renderVisionTags(tags?: Record<string, any>): JSX.Element {
	const entries = Object.entries(tags || {}).filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '');
	if (!entries.length) return <div style={{ color: '#64748b', fontSize: 12 }}>AI가 이미지 태그를 충분히 반환하지 않았습니다.</div>;
	return (
		<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
			{entries.slice(0, 12).map(([key, value]) => (
				<div key={key} style={{ border: '1px solid rgba(148,163,184,0.22)', borderRadius: 10, padding: 10, background: 'rgba(15,23,42,0.55)' }}>
					<div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 900 }}>{key}</div>
					<div style={{ color: '#e5e7eb', fontSize: 12, marginTop: 4, whiteSpace: 'pre-wrap' }}>
						{Array.isArray(value) ? value.join(' · ') : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
					</div>
				</div>
			))}
		</div>
	);
}

function evidenceLabel(level?: string): string {
	return ({ HIGH: '근거 충분', MEDIUM: '참고 가능', LOW: '근거 적음', INSUFFICIENT: '판단하기 어려움' } as Record<string, string>)[String(level || '')] || String(level || '판단하기 어려움');
}

function featureLabel(item?: Record<string, any>): string {
	const feature = compactText(item?.feature || item?.canonical_feature, '특성');
	const value = compactText(item?.value || item?.canonical_value, '');
	const labels: Record<string, string> = {
		purchase_stage: '구매 단계',
		appeal_type: '소구 유형',
		product_visibility: '제품 노출',
		cta: 'CTA',
		pain_point: '고민',
		gender: '성별',
		age_group: '연령대',
		gray_hair: '새치',
		before_after: '비교 표현',
	};
	const values: Record<string, string> = {
		purchase_ready: '구매 준비',
		problem: '문제 제시',
		action: '행동 유도',
		trust: '신뢰',
		benefit: '혜택',
		purchase: '구매',
		detail: '상세 확인',
		high: '잘 보임',
		medium: '일부 보임',
		none: '보이지 않음',
		gray_hair: '새치 고민',
	};
	return `${labels[feature] || feature}${value ? `: ${values[value] || value}` : ''}`;
}

const SIMILAR_VISUAL_FEATURES = new Set(['gray_hair', 'hair_condition', 'before_after', 'body_part_closeup', 'visual_focus', 'product_usage_scene', 'composition']);
const SIMILAR_MESSAGE_FEATURES = new Set(['appeal_type', 'pain_point', 'problem', 'benefit', 'core_promise', 'usp', 'cta']);
const SIMILAR_REQUIRED_FEATURES = new Set(['pain_point', 'problem', 'gray_hair', 'hair_condition', 'before_after']);

function passesSimilarDisplayGate(item: Record<string, any>): boolean {
	const matched = Array.isArray(item.matched_features) ? item.matched_features : [];
	const unmatched = Array.isArray(item.unmatched_features) ? item.unmatched_features : [];
	const matchedPrimary = matched.filter((x: Record<string, any>) => x?.tier === 'PRIMARY').length;
	const visualMatches = matched.filter((x: Record<string, any>) => SIMILAR_VISUAL_FEATURES.has(String(x?.feature || ''))).length;
	const messageMatches = matched.filter((x: Record<string, any>) => SIMILAR_MESSAGE_FEATURES.has(String(x?.feature || ''))).length;
	const missedRequired = unmatched.some((x: Record<string, any>) => SIMILAR_REQUIRED_FEATURES.has(String(x?.feature || '')));
	return !missedRequired && n(item.overall_similarity) >= 0.45 && matchedPrimary >= 2 && visualMatches >= 1 && messageMatches >= 1;
}

function renderFeatureChips(title: string, items?: Array<Record<string, any>>): JSX.Element {
	const rows = (items || []).slice(0, 8);
	return (
		<div>
			<div className="field-label">{title}</div>
			{rows.length ? (
				<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
					{rows.map((item, idx) => (
						<span key={`${title}-${idx}`} style={{ border: '1px solid rgba(148,163,184,0.22)', borderRadius: 999, padding: '4px 8px', color: '#cbd5e1', fontSize: 12 }}>
							{featureLabel(item)}
						</span>
					))}
				</div>
			) : (
				<div style={{ color: '#64748b', fontSize: 12 }}>표시할 항목이 없습니다.</div>
			)}
		</div>
	);
}

function metricBlock(label: string, value: unknown, formatter: (v: unknown) => string = (v) => Math.round(n(v)).toLocaleString('ko-KR'), note?: string): JSX.Element {
	return (
		<div style={{ border: '1px solid #e2e8f0', borderRadius: 14, padding: 12, background: '#ffffff', boxShadow: '0 2px 8px rgba(15,23,42,0.04)' }}>
			<div style={{ color: '#64748b', fontSize: 11, fontWeight: 900 }}>{label}</div>
			<div style={{ color: '#111827', fontSize: 16, fontWeight: 900, marginTop: 5 }}>{formatter(value)}</div>
			{note ? <div style={{ color: note.includes('높은') ? '#059669' : note.includes('낮은') ? '#dc2626' : '#64748b', fontSize: 11.5, fontWeight: 850, marginTop: 5 }}>{note}</div> : null}
		</div>
	);
}

function benchmarkLabel(value: unknown, baseline: unknown, unitLabel = '전체'): string {
	const v = n(value);
	const b = n(baseline);
	if (!Number.isFinite(v) || !Number.isFinite(b) || b <= 0) return '';
	const deltaRatio = (v - b) / b;
	if (deltaRatio >= 0.12) return `${unitLabel}보다 높은 편`;
	if (deltaRatio <= -0.12) return `${unitLabel}보다 낮은 편`;
	return `${unitLabel}와 비슷한 편`;
}

function findEvidenceFeature(result: GfaBannerAnalysisResult, feature: string): Record<string, any> | undefined {
	return result.historical_evidence?.feature_performance_evidence?.features?.find((x) => x.feature === feature);
}

function renderBannerSummary(result: GfaBannerAnalysisResult): JSX.Element {
	const productVisibility = findEvidenceFeature(result, 'product_visibility');
	const purchaseStage = findEvidenceFeature(result, 'purchase_stage');
	const appeal = findEvidenceFeature(result, 'appeal_type');
	const cta = findEvidenceFeature(result, 'cta');
	const painPoint = findEvidenceFeature(result, 'pain_point');
	const evidence = result.historical_evidence;
	const comparable = evidence?.similar_creative_evidence?.comparable_creative_count;
	return (
		<div className="card" style={{ display: 'grid', gap: 12, borderColor: 'rgba(59,130,246,0.28)' }}>
			<div>
				<div className="card-title">1. 신규 배너 분석 요약</div>
				<div className="card-caption">이 영역은 과거 성과보다 먼저, AI가 이 배너를 어떤 소재 구조로 읽었는지 보여줍니다.</div>
			</div>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
				{metricBlock('구매 단계', purchaseStage ? featureLabel(purchaseStage) : '근거 부족', () => purchaseStage ? featureLabel(purchaseStage).replace(/^구매 단계: /, '') : '근거 부족')}
				{metricBlock('주요 소구', appeal ? featureLabel(appeal) : '근거 부족', () => appeal ? featureLabel(appeal).replace(/^소구 유형: /, '') : '근거 부족')}
				{metricBlock('제품 노출', productVisibility ? featureLabel(productVisibility) : result.vision_tags?.product_visibility, () => productVisibility ? featureLabel(productVisibility).replace(/^제품 노출: /, '') : compactText(result.vision_tags?.product_visibility, '근거 부족'))}
				{metricBlock('CTA', cta ? featureLabel(cta) : '근거 부족', () => cta ? featureLabel(cta).replace(/^CTA: /, '') : '근거 부족')}
				{metricBlock('Pain Point', painPoint ? featureLabel(painPoint) : '근거 부족', () => painPoint ? featureLabel(painPoint).replace(/^고민: /, '') : '근거 부족')}
				{metricBlock('비슷한 과거 광고', comparable, (v) => n(v) > 0 ? `${Math.round(n(v)).toLocaleString('ko-KR')}개` : '표시 불가')}
			</div>
			<div style={{ color: '#94a3b8', fontSize: 12 }}>임의 종합 정확도나 성과 점수는 만들지 않습니다. 과거 데이터는 아래 근거 영역에서 별도로 표시합니다.</div>
		</div>
	);
}

function renderCanonicalFeatureBlocks(result: GfaBannerAnalysisResult): JSX.Element {
	const rows = result.historical_evidence?.feature_performance_evidence?.features || [];
	const group = (tier: string) => rows.filter((x) => x.tier === tier).slice(0, 8);
	const section = (title: string, items: typeof rows, empty: string) => (
		<div style={{ border: '1px solid rgba(148,163,184,0.18)', borderRadius: 12, padding: 12, background: 'rgba(15,23,42,0.45)' }}>
			<div style={{ color: '#e5e7eb', fontWeight: 900 }}>{title}</div>
			<div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
				{items.length ? items.map((item, idx) => (
					<span key={`${title}-${idx}`} style={{ border: '1px solid rgba(148,163,184,0.22)', borderRadius: 999, padding: '4px 8px', color: '#cbd5e1', fontSize: 12 }}>
						{featureLabel(item)}
					</span>
				)) : <span style={{ color: '#64748b', fontSize: 12 }}>{empty}</span>}
			</div>
		</div>
	);
	return (
		<div className="card" style={{ display: 'grid', gap: 10 }}>
			<div className="card-title">2. 크리에이티브 구성 요소 분석</div>
			<div className="card-caption">AI가 읽은 표준 광고 요소입니다. 근거가 제한적인 값은 과거 성과 비교의 핵심 근거로 쓰지 않습니다.</div>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
				{section('PRIMARY', group('PRIMARY'), '주요 비교 요소가 충분하지 않습니다.')}
				{section('SECONDARY', group('SECONDARY'), '보조 비교 요소가 충분하지 않습니다.')}
				{section('LIMITED', group('LIMITED'), '제한 요소는 상세 비교에서만 참고합니다.')}
			</div>
			{result.historical_evidence?.status !== 'available' ? <div style={{ color: '#94a3b8', fontSize: 12 }}>일부 특성은 비교 근거에서 제외되었습니다.</div> : null}
		</div>
	);
}

function renderMessageStructure(result: GfaBannerAnalysisResult): JSX.Element {
	const appeal = findEvidenceFeature(result, 'appeal_type');
	const product = findEvidenceFeature(result, 'product_visibility');
	const cta = findEvidenceFeature(result, 'cta');
	const steps = [appeal, product, cta].filter(Boolean) as Record<string, any>[];
	return (
		<div className="card" style={{ display: 'grid', gap: 10 }}>
			<div className="card-title">3. 메시지·표현 구조 분석</div>
			<div className="card-caption">좋고 나쁨보다 이 배너가 어떤 흐름으로 구성됐는지 설명합니다.</div>
			{steps.length ? (
				<div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
					{steps.map((item, idx) => (
						<React.Fragment key={`${item.feature}-${idx}`}>
							<span style={{ border: '1px solid rgba(96,165,250,0.28)', borderRadius: 12, padding: '8px 10px', color: '#e5e7eb', background: 'rgba(30,41,59,0.55)', fontSize: 13, fontWeight: 900 }}>
								{featureLabel(item)}
							</span>
							{idx < steps.length - 1 ? <span style={{ color: '#64748b', fontWeight: 900 }}>→</span> : null}
						</React.Fragment>
					))}
				</div>
			) : (
				<div style={{ color: '#64748b', fontSize: 12 }}>메시지 구조를 만들 표준 특성이 충분하지 않습니다.</div>
			)}
			<div style={{ color: '#cbd5e1', fontSize: 13, lineHeight: 1.7 }}>
				{result.verdict || '배너 이미지와 문구의 구성 요소를 확인합니다.'}
			</div>
		</div>
	);
}

function RenderHistoricalEvidencePanel({ evidence }: { evidence?: GfaBannerAnalysisResult['historical_evidence'] }): JSX.Element {
	if (!evidence) {
		return (
			<div className="card" style={{ color: '#94a3b8', fontSize: 13 }}>
				비슷한 과거 광고의 실제 성과는 이번 응답에 포함되지 않았습니다.
			</div>
		);
	}
	if (evidence.status !== 'available' || !evidence.ok) {
		return (
			<div className="card" style={{ display: 'grid', gap: 8 }}>
				<div className="card-title">5. 비슷한 과거 광고의 실제 성과</div>
				<div style={{ color: '#cbd5e1', fontSize: 13 }}>{evidence.message || '과거 성과 근거를 표시할 수 없습니다.'}</div>
				<div style={{ color: '#94a3b8', fontSize: 12 }}>일부 특성은 비교 근거에서 제외되었습니다.</div>
			</div>
		);
	}
	const similar = evidence.similar_creative_evidence || {};
	const perf = similar.performance || {};
	const strength = (similar.evidence_strength || {}) as Record<string, any>;
	const concentration = (similar.concentration || {}) as Record<string, any>;
	const top = similar.top_similar_creatives?.[0];
	const featureRows = (evidence.feature_performance_evidence?.features || []).slice(0, 6);
	return (
		<div className="card" style={{ display: 'grid', gap: 14 }}>
			<div>
				<div className="card-title">4. 과거 운영 데이터 근거</div>
				<div className="card-caption">Historical Evidence는 신규 배너 판단을 보강하는 보조 근거입니다.</div>
			</div>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
				{metricBlock('비슷한 과거 광고', similar.comparable_creative_count, (v) => `${Math.round(n(v)).toLocaleString('ko-KR')}개`)}
				{metricBlock('과거 노출', perf.impressions)}
				{metricBlock('과거 클릭', perf.clicks)}
				{metricBlock('과거 구매', perf.purchase_conversions)}
				{metricBlock('과거 관찰 CTR', perf.ctr, pct)}
				{metricBlock('과거 구매 CVR', perf.purchase_cvr, pct)}
				{metricBlock('과거 구매 ROAS', perf.purchase_roas, roasMultiple)}
				{metricBlock('비슷한 광고 근거 수준', strength.level, () => evidenceLabel(String(strength.level || '')))}
			</div>
			<details>
				<summary style={{ cursor: 'pointer', color: '#93c5fd', fontSize: 13, fontWeight: 900 }}>상세 근거 보기</summary>
				<div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
					<div style={{ display: 'grid', gap: 10 }}>
						<div className="card-title" style={{ fontSize: 14 }}>왜 비슷한가</div>
						{renderFeatureChips('일치한 요소', top?.matched_features)}
						{renderFeatureChips('다른 요소', top?.unmatched_features)}
						{renderFeatureChips('비교하지 않은 요소', [...(top?.unavailable_features || []), ...(top?.limited_matches_not_scored || [])])}
					</div>
					<div style={{ display: 'grid', gap: 10 }}>
						<div className="card-title" style={{ fontSize: 14 }}>이 광고 요소들의 과거 성과</div>
						<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10 }}>
							{featureRows.map((item, idx) => (
								<div key={`${item.feature}-${item.value}-${idx}`} style={{ border: '1px solid rgba(148,163,184,0.22)', borderRadius: 12, padding: 12, background: 'rgba(15,23,42,0.55)' }}>
									<div style={{ color: '#e5e7eb', fontWeight: 900 }}>{featureLabel(item)}</div>
									<div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>과거 광고 {Math.round(n(item.creative_count)).toLocaleString('ko-KR')}개</div>
									<div style={{ display: 'grid', gap: 3, marginTop: 8, color: '#cbd5e1', fontSize: 12 }}>
										<div>과거 관찰 CTR {pct(item.performance?.ctr)}</div>
										<div>과거 구매 CVR {pct(item.performance?.purchase_cvr)}</div>
										<div>과거 구매 ROAS {roasMultiple(item.performance?.purchase_roas)}</div>
										<div>근거 수준 {evidenceLabel(item.evidence_strength?.level)}</div>
									</div>
								</div>
							))}
						</div>
					</div>
					<div style={{ borderTop: '1px solid rgba(148,163,184,0.16)', paddingTop: 12 }}>
						<div className="card-title" style={{ fontSize: 14 }}>근거와 제한 사항</div>
						<div style={{ color: '#cbd5e1', fontSize: 13, lineHeight: 1.7, marginTop: 6 }}>
							비교 데이터의 양, 구성, 특정 광고 집중도 등의 제한 때문에 근거 수준이 달라질 수 있습니다.
							상위 1개 광고 노출 비중은 {(n(concentration.top_creative_impression_share) * 100).toFixed(1)}%, 광고비 비중은 {(n(concentration.top_creative_spend_share) * 100).toFixed(1)}%입니다.
							이 값은 신규 광고의 성과 보장값이 아닙니다.
						</div>
					</div>
				</div>
			</details>
		</div>
	);
}

function renderReviewPoints(result: GfaBannerAnalysisResult): JSX.Element {
	const evidence = result.historical_evidence;
	const concentration = (evidence?.similar_creative_evidence?.concentration || {}) as Record<string, any>;
	const confirmed = [
		findEvidenceFeature(result, 'cta') ? `${featureLabel(findEvidenceFeature(result, 'cta'))} 확인` : '',
		findEvidenceFeature(result, 'appeal_type') ? `${featureLabel(findEvidenceFeature(result, 'appeal_type'))} 확인` : '',
		findEvidenceFeature(result, 'product_visibility') ? `${featureLabel(findEvidenceFeature(result, 'product_visibility'))} 확인` : '',
		evidence?.status === 'available' ? '과거 유사 광고 데이터 존재' : '',
	].filter(Boolean);
	const warnings = [
		n(concentration.top_creative_impression_share) >= 0.5 ? `유사 광고 비교군이 일부 광고에 집중됨(노출 ${(n(concentration.top_creative_impression_share) * 100).toFixed(1)}%)` : '',
		'연령·성별 등 근거 제한 요소는 주요 성과 비교 근거로 사용하지 않음',
		'과거 광고의 성과는 신규 광고의 성과 보장값이 아님',
	].filter(Boolean);
	return (
		<div className="card" style={{ display: 'grid', gap: 12 }}>
			<div className="card-title">5. 종합 근거 및 검토 포인트</div>
			<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
				<div>
					<div className="field-label">확인된 사항</div>
					{renderTextList(confirmed.length ? confirmed : result.strengths)}
				</div>
				<div>
					<div className="field-label">주의해서 볼 사항</div>
					{renderTextList(warnings)}
				</div>
			</div>
		</div>
	);
}

const bannerUi = {
	page: { maxWidth: 1400, margin: '0 auto', padding: 24, color: '#1e293b', background: '#fcfdfd', minHeight: 'calc(100vh - 96px)', fontFamily: 'Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif' } as React.CSSProperties,
	card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 18, padding: 18, boxShadow: '0 2px 10px rgba(15,23,42,0.035)' } as React.CSSProperties,
	muted: { color: '#64748b', fontSize: 12, lineHeight: 1.55 } as React.CSSProperties,
	title: { margin: 0, color: '#111827', fontSize: 16, fontWeight: 900 } as React.CSSProperties,
};

const BANNER_ANALYSIS_LAST_RESULT_KEY = 'erp2.analytics.gfaBannerAnalysis.lastResult.v1';

type StoredBannerAnalysis = {
	result: GfaBannerAnalysisResult;
	previewUrl?: string;
	note?: string;
	fileName?: string;
	fileSize?: number;
	savedAt?: string;
};

function readStoredBannerAnalysis(): StoredBannerAnalysis | null {
	try {
		const raw = window.localStorage.getItem(BANNER_ANALYSIS_LAST_RESULT_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as StoredBannerAnalysis;
		return parsed?.result ? parsed : null;
	} catch {
		return null;
	}
}

function writeStoredBannerAnalysis(payload: StoredBannerAnalysis): void {
	try {
		window.localStorage.setItem(BANNER_ANALYSIS_LAST_RESULT_KEY, JSON.stringify({ ...payload, savedAt: new Date().toISOString() }));
	} catch {
		try {
			window.localStorage.setItem(BANNER_ANALYSIS_LAST_RESULT_KEY, JSON.stringify({ ...payload, previewUrl: '', savedAt: new Date().toISOString() }));
		} catch {
			// Storage can fail in private mode or when full; analysis should still complete.
		}
	}
}

function clearStoredBannerAnalysis(): void {
	try {
		window.localStorage.removeItem(BANNER_ANALYSIS_LAST_RESULT_KEY);
	} catch {
		// Ignore storage errors; reset should still clear in-memory state.
	}
}

function fileToDataUrl(file: File): Promise<string> {
	return new Promise((resolve) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result || ''));
		reader.onerror = () => resolve('');
		reader.readAsDataURL(file);
	});
}

function BannerShellHeader({ hasResult, onReset, onOpenHistory }: { hasResult: boolean; onReset: () => void; onOpenHistory: () => void }): JSX.Element {
	return (
		<header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', marginBottom: 24 }}>
			<div>
				<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
					<h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, color: '#111827' }}>GFA 광고 소재 분석</h1>
					<span style={{ background: '#eef2ff', color: '#4f46e5', border: '1px solid #e0e7ff', borderRadius: 999, padding: '2px 9px', fontSize: 12, fontWeight: 900 }}>Beta</span>
				</div>
				<p style={{ margin: '6px 0 0', color: '#64748b', fontSize: 14 }}>광고를 집행하기 전에, 전문가의 분석으로 더 좋은 결과를 만들어보세요.</p>
			</div>
			<div style={{ display: 'flex', gap: 10 }}>
				<button type="button" onClick={onOpenHistory} style={{ background: '#111827', border: '1px solid #111827', borderRadius: 12, padding: '10px 14px', color: '#fff', fontSize: 12, fontWeight: 800, boxShadow: '0 1px 4px rgba(15,23,42,0.12)' }}>과거분석 보기</button>
				<button type="button" onClick={onReset} disabled={!hasResult} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '10px 14px', color: hasResult ? '#374151' : '#94a3b8', fontSize: 12, fontWeight: 800, boxShadow: '0 1px 4px rgba(15,23,42,0.06)', cursor: hasResult ? 'pointer' : 'not-allowed' }}>다른 이미지 분석하기</button>
				<button type="button" style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '10px 14px', color: '#374151', fontSize: 12, fontWeight: 800, boxShadow: '0 1px 4px rgba(15,23,42,0.06)' }}>사용 안내</button>
			</div>
		</header>
	);
}

function BannerUploadCard(props: {
	file: File | null;
	previewUrl: string;
	note: string;
	skuId: string;
	contextItems: GfaBannerContentContextItem[];
	analyzing: boolean;
	message: string;
	onFile: (file: File | null) => void;
	onNote: (note: string) => void;
	onSkuId: (skuId: string) => void;
	onAnalyze: () => void;
}): JSX.Element {
	const selectedContext = props.contextItems.find((item) => item.sku_id === props.skuId) || props.contextItems[0] || null;
	return (
		<section style={{ ...bannerUi.card, maxWidth: 560, display: 'grid', gap: 14 }}>
			<div>
				<h2 style={{ margin: 0, color: '#111827', fontSize: 18, fontWeight: 900 }}>분석할 이미지 업로드</h2>
				<p style={{ ...bannerUi.muted, margin: '6px 0 0' }}>신규 배너 이미지를 올리면 AI 분석, 광고 심사 참고, 과거 유사 광고 근거를 함께 확인합니다.</p>
			</div>
			<label style={{ display: 'grid', gap: 6, color: '#475569', fontSize: 12, fontWeight: 900 }}>
				연결 SKU
				<select value={props.skuId} onChange={(e) => props.onSkuId(e.target.value)} style={{ background: '#fff', color: '#334155', border: '1px solid #e2e8f0', borderRadius: 10, padding: 10, fontSize: 12 }}>
					<option value="">상세페이지/제품 이미지 연결 안 함</option>
					{props.contextItems.map((item) => (
						<option key={item.sku_id} value={item.sku_id}>
							{compactText(item.title, item.sku_id)} · 제품이미지 {item.product_image_count || 0} · 상세분석 {item.analyzed_detail_page_count || 0} · 참고소재 {item.reference_media_count || 0}
						</option>
					))}
				</select>
				<span style={{ color: selectedContext?.ready ? '#047857' : '#b45309', fontSize: 11 }}>
					{selectedContext
						? `제품 이미지 ${selectedContext.product_image_count || 0}개, 분석 완료 상세페이지 ${selectedContext.analyzed_detail_page_count || 0}개, 매칭 참고 소재 ${selectedContext.reference_media_count || 0}개를 배너 분석/생성 근거로 사용합니다.`
						: 'SKU를 선택하면 AI 콘텐츠 센터의 상세페이지 분석, 제품 이미지, 그룹 참고 소재가 연결됩니다.'}
				</span>
			</label>
			<input type="file" accept="image/png,image/jpeg,image/webp" style={{ background: '#fff', color: '#334155', border: '1px solid #e2e8f0', borderRadius: 10, padding: 10, fontSize: 12 }} onChange={(e) => props.onFile(e.target.files?.[0] || null)} />
			{props.previewUrl ? <img src={props.previewUrl} alt="업로드 배너 미리보기" style={{ width: '100%', maxHeight: 420, objectFit: 'contain', borderRadius: 14, border: '1px solid #e5e7eb', background: '#f8fafc' }} /> : <div style={{ border: '1px dashed #cbd5e1', borderRadius: 14, padding: 32, textAlign: 'center', color: '#64748b', background: '#f8fafc' }}>JPG/PNG/WEBP 배너 이미지를 선택하세요.</div>}
			<textarea value={props.note} onChange={(e) => props.onNote(e.target.value)} rows={4} placeholder="예: 타깃, 상품명, 의도한 메인카피/CTA, 랜딩 목적 등" style={{ background: '#fff', color: '#334155', border: '1px solid #e2e8f0', borderRadius: 12, padding: 12, fontSize: 13, resize: 'vertical' }} />
			<button type="button" onClick={props.onAnalyze} disabled={props.analyzing || !props.file} style={{ background: props.analyzing || !props.file ? '#cbd5e1' : '#4f46e5', color: '#fff', border: 0, borderRadius: 12, padding: '12px 16px', fontSize: 13, fontWeight: 900, cursor: props.analyzing || !props.file ? 'not-allowed' : 'pointer' }}>{props.analyzing ? 'AI 분석 중...' : 'AI 배너 분석'}</button>
			{props.message ? <div style={{ color: props.message.includes('완료') ? '#16a34a' : '#dc2626', fontSize: 12, fontWeight: 900 }}>{props.message}</div> : null}
		</section>
	);
}

function BannerHero({ result }: { result: GfaBannerAnalysisResult }): JSX.Element {
	const overall = Math.round(n(result.overall_score));
	const good = overall >= 70;
	const quality = ((result as any)?.analysis_quality || {}) as Record<string, any>;
	const missing = Array.isArray(quality.missing_factor_keys) ? quality.missing_factor_keys : [];
	return (
		<section style={{ background: good ? '#e9fbf0' : '#fffbeb', border: `1px solid ${good ? '#c1f3d4' : '#fde68a'}`, borderRadius: 18, padding: 22, marginBottom: 18, display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
			<div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
				<div style={{ width: 54, height: 54, borderRadius: 999, background: good ? '#00c73c' : '#f59e0b', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 26, fontWeight: 900 }}>{good ? '✓' : '!'}</div>
				<div>
					<h2 style={{ margin: 0, color: '#111827', fontSize: 24, fontWeight: 900 }}>{good ? '이 소재는 사용 가능성이 높습니다!' : '이 소재는 수정 후 사용을 권장합니다.'}</h2>
					<p style={{ margin: '6px 0 0', color: '#4b5563', fontSize: 14 }}>{result.verdict || '아래 내용을 참고해 사용 전 검토해보세요.'}</p>
					{quality.validated === false ? <p style={{ margin: '6px 0 0', color: '#b45309', fontSize: 12, fontWeight: 800 }}>일부 평가항목이 응답에서 누락되어 보수적으로 보완했습니다. 누락 {missing.length}개</p> : null}
				</div>
			</div>
			<div style={{ background: good ? '#d2f6de' : '#fef3c7', border: `1px solid ${good ? '#b2ecc5' : '#fde68a'}`, borderRadius: 18, padding: '14px 32px', textAlign: 'center', minWidth: 180 }}>
				<div style={{ color: '#4b5563', fontSize: 12, fontWeight: 800 }}>AI 광고 구성 점검</div>
				<div style={{ color: '#111827', fontSize: 36, fontWeight: 950 }}>{overall} <span style={{ fontSize: 16, color: '#64748b' }}>/ 100</span></div>
			</div>
		</section>
	);
}

function BannerMetricCards({ result, reviewStatus, improvementStatus }: { result: GfaBannerAnalysisResult; reviewStatus: string; improvementStatus: string }): JSX.Element {
	const factors = result.factor_scores || [];
	const compositionScore = Math.round((n(factors.find((x) => x.key === 'hook')?.score) + n(factors.find((x) => x.key === 'alignment')?.score) + n(factors.find((x) => x.key === 'cta')?.score)) / 3 || n(result.overall_score));
	const evidenceLevel = result.historical_evidence?.similar_creative_evidence?.evidence_strength?.level;
	const cards = [
		{ label: '광고 구성 평가', value: `${compositionScore} / 100`, hint: '사람들의 관심을 끌기 좋은 소재인지 확인합니다.', tone: '#0284c7' },
		{ label: '과거 데이터 근거', value: evidenceLabel(evidenceLevel), hint: '비슷한 유형의 과거 운영 데이터를 참고합니다.', tone: '#16a34a' },
		{ label: '네이버 광고 심사', value: reviewStatus, hint: '등록 전 심사상 주의할 요소를 확인합니다.', tone: reviewStatus === '사용 가능' ? '#16a34a' : '#ea580c' },
		{ label: '개선 필요도', value: improvementStatus, hint: '수정 우선순위를 빠르게 확인합니다.', tone: '#ea580c' },
	];
	return (
		<section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 18 }}>
			{cards.map((card) => (
				<div key={card.label} style={{ ...bannerUi.card, display: 'grid', gap: 8 }}>
					<div style={{ color: '#64748b', fontSize: 12, fontWeight: 800 }}>{card.label}</div>
					<div style={{ color: card.tone, fontSize: 22, fontWeight: 950 }}>{card.value}</div>
					<div style={{ ...bannerUi.muted }}>{card.hint}</div>
				</div>
			))}
		</section>
	);
}

function BannerImageCard({ previewUrl, file, result }: { previewUrl: string; file: File | null; result: GfaBannerAnalysisResult }): JSX.Element {
	return (
		<div style={{ ...bannerUi.card, display: 'grid', gap: 12, alignContent: 'start' }}>
			<h3 style={bannerUi.title}>분석한 이미지</h3>
			{previewUrl ? <img src={previewUrl} alt="분석한 배너" style={{ width: '100%', aspectRatio: '1/1', objectFit: 'contain', borderRadius: 14, border: '1px solid #e5e7eb', background: '#f8fafc' }} /> : <div style={{ aspectRatio: '1/1', borderRadius: 14, border: '1px solid #e5e7eb', background: '#f8fafc' }} />}
			<div style={{ color: '#64748b', fontSize: 12 }}>{file?.name || result.filename || '업로드 이미지'}{file ? <><br />{(file.size / 1024 / 1024).toFixed(1)} MB</> : null}</div>
		</div>
	);
}

function textFromList(value: unknown, fallback = '확인된 내용 없음'): string {
	if (Array.isArray(value)) {
		const rows = value.map((x) => compactText(x, '')).filter(Boolean);
		return rows.length ? rows.slice(0, 3).join(', ') : fallback;
	}
	return compactText(value, fallback);
}

function factorText(result: GfaBannerAnalysisResult, key: string, field: 'good' | 'weak' | 'improvement', fallback: string): string {
	const factor = result.factor_scores?.find((x) => x.key === key);
	return compactText(factor?.[field], fallback);
}

function detectedFeatureRows(result: GfaBannerAnalysisResult): Array<{ title: string; observation: string; strategic: string; strength: string; weakness: string; improvement: string }> {
	const detailed = (result.element_analysis || []).filter((item) => compactText(item.title, '') || compactText(item.observation, ''));
	const policyIssue = hasBannerPolicyIssue(result);
	if (detailed.length) {
		return detailed.slice(0, 6).map((item) => {
			if (!policyIssue && isPolicyAnalysisItem(item as Record<string, any>)) {
				return {
					title: '광고 정책/심사 적합성',
					observation: '정책 엔진 기준 전체 체크 결과, 현재 표시된 분석에서는 문제 항목이 없습니다.',
					strategic: '이 항목은 AI 원문 해석보다 네이버 정책 엔진의 최종 판정을 우선 적용했습니다.',
					strength: compactText(item.strength, '정책 관점에서 현재 관찰된 주요 위반 신호는 없습니다.'),
					weakness: '',
					improvement: '상세페이지 근거와 소재 표현의 정합성만 유지하세요.',
				};
			}
			return {
				title: compactText(item.title, '분석 요소'),
				observation: compactText(item.observation, '관찰 내용이 없습니다.'),
				strategic: compactText(item.strategic_meaning || item.strength, '광고적 해석이 없습니다.'),
				strength: compactText(item.strength, ''),
				weakness: compactText(item.weakness, ''),
				improvement: compactText(item.improvement || item.weakness, ''),
			};
		});
	}
	const tags = result.vision_tags || {};
	const copyFactor = result.factor_scores?.find((x) => x.key === 'hook' || x.key === 'copy_hierarchy');
	return [
		{ title: '인물/타깃', observation: textFromList((tags as any).visual_subjects || (tags as any).person, '인물/모델 정보가 명확하지 않습니다.'), strategic: factorText(result, 'audience_fit', 'good', '타깃과 시각 요소의 연결성을 확인합니다.'), strength: factorText(result, 'audience_fit', 'good', ''), weakness: factorText(result, 'audience_fit', 'weak', ''), improvement: factorText(result, 'audience_fit', 'improvement', '') },
		{ title: '헤어/문제상황', observation: textFromList((tags as any).hair_condition_tags, '헤어 관련 관찰값이 제한적입니다.'), strategic: factorText(result, 'message_structure', 'good', '문제 제시와 해결 흐름을 확인합니다.'), strength: factorText(result, 'message_structure', 'good', ''), weakness: factorText(result, 'message_structure', 'weak', ''), improvement: factorText(result, 'message_structure', 'improvement', '') },
		{ title: '제품/오브젝트', observation: textFromList((tags as any).product_visibility, '제품 노출과 사용 장면을 확인합니다.'), strategic: factorText(result, 'object_product', 'good', '제품과 효익의 연결성을 확인합니다.'), strength: factorText(result, 'object_product', 'good', ''), weakness: factorText(result, 'object_product', 'weak', ''), improvement: factorText(result, 'object_product', 'improvement', '') },
		{ title: '레이아웃/시선흐름', observation: textFromList((tags as any).visual_hierarchy_path || (tags as any).composition_tags, '시선 흐름 정보가 제한적입니다.'), strategic: factorText(result, 'visual_salience', 'good', '첫 화면 주목도와 정보 위계를 확인합니다.'), strength: factorText(result, 'visual_salience', 'good', ''), weakness: factorText(result, 'visual_salience', 'weak', ''), improvement: factorText(result, 'visual_salience', 'improvement', '') },
		{ title: '문구/카피', observation: compactText(copyFactor?.good || copyFactor?.weak, '메인카피, 서브카피, CTA의 전달 구조를 확인합니다.'), strategic: factorText(result, 'copy_hierarchy', 'weak', '카피의 정보 우선순위를 확인합니다.'), strength: factorText(result, 'copy_hierarchy', 'good', ''), weakness: factorText(result, 'copy_hierarchy', 'weak', ''), improvement: factorText(result, 'copy_hierarchy', 'improvement', '') },
	];
}

function BannerDetectedFeaturesCard({ result }: { result: GfaBannerAnalysisResult }): JSX.Element {
	const items = detectedFeatureRows(result);
	const visibleItems = items.slice(0, 6);
	const hasMoreItems = items.length > visibleItems.length;
	return (
		<div style={{ ...bannerUi.card, display: 'grid', gap: 12, alignContent: 'start' }}>
			<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
				<h3 style={bannerUi.title}>이런 요소가 보입니다</h3>
				<span style={{ width: 16, height: 16, borderRadius: 999, border: '1px solid #cbd5e1', color: '#64748b', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 900 }}>?</span>
			</div>
			<div style={{ display: 'grid', gap: 12 }}>
				{visibleItems.length ? visibleItems.map((item, idx) => (
					<div key={`${item.title}-${idx}`} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', background: '#ffffff', border: '1px solid #dbeafe', borderRadius: 16, padding: 13, boxShadow: '0 8px 22px rgba(15,23,42,.04)' }}>
						<div style={{ width: 34, height: 34, borderRadius: 999, background: '#eff6ff', display: 'grid', placeItems: 'center', color: '#2563eb', fontWeight: 950, flex: '0 0 auto' }}>{idx + 1}</div>
						<div style={{ minWidth: 0 }}>
							<div style={{ color: '#0f172a', fontSize: 14, fontWeight: 950 }}>{item.title}</div>
							<div style={{ color: '#334155', fontSize: 12.5, lineHeight: 1.65, marginTop: 6 }}><b style={{ color: '#1e40af' }}>관찰</b> {item.observation}</div>
							<div style={{ color: '#475569', fontSize: 12.5, lineHeight: 1.65, marginTop: 5 }}><b style={{ color: '#0f766e' }}>해석</b> {item.strategic}</div>
							{item.strength ? <div style={{ color: '#166534', fontSize: 12, lineHeight: 1.6, marginTop: 5 }}><b>강점</b> {item.strength}</div> : null}
							{item.weakness ? <div style={{ color: '#92400e', fontSize: 12, lineHeight: 1.6, marginTop: 5 }}><b>부족</b> {item.weakness}</div> : null}
							{item.improvement ? <div style={{ color: '#1d4ed8', fontSize: 12, lineHeight: 1.6, marginTop: 5 }}><b>수정</b> {item.improvement}</div> : null}
						</div>
					</div>
				)) : <div style={bannerUi.muted}>표시할 요소가 없습니다.</div>}
			</div>
			{hasMoreItems ? <button type="button" style={{ width: '100%', marginTop: 6, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '9px 10px', color: '#475569', fontSize: 12, fontWeight: 800 }}>더 자세히 보기</button> : null}
		</div>
	);
}

function BannerHistoricalCard({ result, apiBaseUrl }: { result: GfaBannerAnalysisResult; apiBaseUrl: string }): JSX.Element {
	const historical = result.historical_evidence;
	const similar = historical?.similar_creative_evidence;
	const perf = similar?.performance || {};
	const baseline = historical?.feature_performance_evidence?.baseline || {};
	const featureSimilarRows = (historical?.feature_similar_creative_evidence?.features || []).slice(0, 6);
	const visibleFeatureSimilarRows = featureSimilarRows.slice(0, 3);
	const strength = similar?.evidence_strength;
	const concentration = similar?.concentration || {};
	const hasEvidence = historical?.status === 'available' && historical.ok;
	const examples = (similar?.top_similar_creatives || []).filter((item: Record<string, any>) => passesSimilarDisplayGate(item)).slice(0, 3);
	const strictComparableCount = typeof similar?.strict_comparable_candidate_count === 'number' ? Math.round(n(similar.strict_comparable_candidate_count)) : null;
	const comparableCount = strictComparableCount ?? examples.length;
	const hasComparableExamples = hasEvidence && comparableCount > 0 && examples.length > 0;
	const hasFeatureSimilarEvidence = hasEvidence && visibleFeatureSimilarRows.length > 0;
	const showMoreSimilarButton = featureSimilarRows.length > visibleFeatureSimilarRows.length || ((similar?.top_similar_creatives || []).length > examples.length && examples.length > 0);
	return (
		<div style={{ ...bannerUi.card, display: 'grid', gap: 13, alignContent: 'start' }}>
			<div>
				<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
					<h3 style={bannerUi.title}>비슷한 광고의 실제 성과</h3>
					<span style={{ width: 16, height: 16, borderRadius: 999, border: '1px solid #cbd5e1', color: '#64748b', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 900 }}>?</span>
				</div>
				<p style={{ ...bannerUi.muted, margin: '6px 0 0' }}>
					{hasFeatureSimilarEvidence
						? <>모든 요소가 같은 소재를 찾지 않고, 소구점/문제상황/이미지 구조/제품 노출 등 항목별로 유사한 과거 소재를 분리해 보여줍니다.</>
						: <>항목별로 비교 가능한 과거 소재 근거가 부족합니다.</>}<br />
					<span style={{ color: '#94a3b8' }}>실제 운영 데이터를 기반으로 한 참고이며, 현재 광고의 예상 성과가 아닙니다.</span>
				</p>
			</div>
			{hasFeatureSimilarEvidence ? (
				<div style={{ display: 'grid', gap: 10 }}>
					{visibleFeatureSimilarRows.map((row: Record<string, any>, idx) => {
						const rowPerf = row.performance || {};
						const topCreative = Array.isArray(row.top_creatives) ? row.top_creatives[0] : undefined;
						const imageUrl = assetUrl(apiBaseUrl, topCreative?.image_url);
						const rowLabel = featureLabel({ feature: row.feature, value: row.value });
						return (
							<div key={`${row.feature}-${row.value}-${idx}`} style={{ display: 'grid', gridTemplateColumns: imageUrl ? '68px minmax(0, 1fr)' : '1fr', gap: 10, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 14, padding: 10 }}>
								{imageUrl ? <img src={imageUrl} alt={compactText(topCreative?.creative_name, rowLabel)} style={{ width: 68, height: 68, objectFit: 'cover', borderRadius: 12, border: '1px solid #e5e7eb' }} /> : null}
								<div style={{ minWidth: 0 }}>
									<div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
										<div style={{ color: '#111827', fontSize: 13, fontWeight: 950 }}>{rowLabel}</div>
										<span style={{ color: '#475569', fontSize: 11, fontWeight: 850 }}>{Math.round(n(row.creative_count)).toLocaleString('ko-KR')}개</span>
									</div>
									<div style={{ color: '#64748b', fontSize: 11.5, lineHeight: 1.5, marginTop: 4 }}>{compactText(topCreative?.creative_name, '대표 소재 이미지 없음')}</div>
									<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6, marginTop: 8 }}>
										<div style={{ color: '#475569', fontSize: 11 }}>CTR <b style={{ color: '#0f172a' }}>{pct(rowPerf.ctr)}</b><br /><span style={{ color: benchmarkLabel(rowPerf.ctr, (baseline as Record<string, any>).ctr).includes('높은') ? '#059669' : '#64748b' }}>{benchmarkLabel(rowPerf.ctr, (baseline as Record<string, any>).ctr)}</span></div>
										<div style={{ color: '#475569', fontSize: 11 }}>전환율 <b style={{ color: '#0f172a' }}>{pct(rowPerf.purchase_cvr)}</b><br /><span style={{ color: benchmarkLabel(rowPerf.purchase_cvr, (baseline as Record<string, any>).purchase_cvr).includes('높은') ? '#059669' : '#64748b' }}>{benchmarkLabel(rowPerf.purchase_cvr, (baseline as Record<string, any>).purchase_cvr)}</span></div>
										<div style={{ color: '#475569', fontSize: 11 }}>ROAS <b style={{ color: '#0f172a' }}>{roasMultiple(rowPerf.purchase_roas)}</b><br /><span style={{ color: benchmarkLabel(rowPerf.purchase_roas, (baseline as Record<string, any>).purchase_roas).includes('높은') ? '#059669' : '#64748b' }}>{benchmarkLabel(rowPerf.purchase_roas, (baseline as Record<string, any>).purchase_roas)}</span></div>
									</div>
								</div>
							</div>
						);
					})}
				</div>
			) : null}
			{hasComparableExamples ? (
				<>
					<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, textAlign: 'center' }}>
						{metricBlock('과거 관찰 CTR', perf.ctr, pct, benchmarkLabel(perf.ctr, (baseline as Record<string, any>).ctr))}
						{metricBlock('구매 전환율', perf.purchase_cvr, pct, benchmarkLabel(perf.purchase_cvr, (baseline as Record<string, any>).purchase_cvr))}
						{metricBlock('구매 ROAS', perf.purchase_roas, roasMultiple, benchmarkLabel(perf.purchase_roas, (baseline as Record<string, any>).purchase_roas))}
					</div>
					<div>
						<div style={{ color: '#111827', fontSize: 13, fontWeight: 950, marginBottom: 8 }}>비슷한 광고 예시</div>
						<div style={{ display: 'grid', gap: 10 }}>
							{examples.map((item: Record<string, any>, idx) => {
								const matched = Array.isArray(item.matched_features) ? item.matched_features : [];
								const labels = matched.slice(0, 3).map(featureLabel);
								const label = labels[0] || `유사 광고 ${idx + 1}`;
								const itemPerf = item.performance || {};
								const imageUrl = assetUrl(apiBaseUrl, item.image_url);
								return (
									<div key={`${item.creative_id || idx}`} style={{ display: 'grid', gridTemplateColumns: '76px minmax(0, 1fr)', gap: 10, alignItems: 'center', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 14, padding: 9 }}>
										{imageUrl ? (
											<img src={imageUrl} alt={compactText(item.creative_name, label)} style={{ width: 76, height: 76, objectFit: 'cover', borderRadius: 12, border: '1px solid #e5e7eb', background: '#f8fafc' }} />
										) : (
											<div style={{ width: 76, height: 76, borderRadius: 12, border: '1px solid #e5e7eb', background: '#e0f2fe', padding: 8, color: '#075985', display: 'flex', alignItems: 'center', fontSize: 11, fontWeight: 900, lineHeight: 1.35 }}>
												{label}
											</div>
										)}
										<div style={{ minWidth: 0 }}>
											<div style={{ color: '#111827', fontSize: 12.5, fontWeight: 900, lineHeight: 1.35 }}>{compactText(item.creative_name, label)}</div>
											<div style={{ color: '#64748b', fontSize: 11.5, lineHeight: 1.55, marginTop: 4 }}>공통 특징: {labels.length ? labels.join(' · ') : '표시 가능한 공통 특징 없음'}</div>
											<div style={{ color: '#475569', fontSize: 11.5, marginTop: 4 }}>CTR <b style={{ color: '#059669' }}>{pct(itemPerf.ctr ?? perf.ctr)}</b> · 유사도 {Math.round(n(item.overall_similarity) * 100)}%</div>
										</div>
									</div>
								);
							})}
						</div>
					</div>
				</>
			) : (
				<div style={{ background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 14, padding: 14, color: '#475569', fontSize: 12.5, lineHeight: 1.6 }}>
					<b style={{ color: '#111827' }}>종합 유사 소재는 참고 제외</b>
					<div style={{ marginTop: 5 }}>전체 구조가 모두 같은 소재는 드물기 때문에, 위 항목별 근거를 우선 사용합니다. 전체 유사 소재는 핵심 특징이 충분히 겹칠 때만 별도로 표시합니다.</div>
				</div>
			)}
			<div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
				<span style={{ background: hasComparableExamples ? '#fffbeb' : '#f1f5f9', border: `1px solid ${hasComparableExamples ? '#fde68a' : '#cbd5e1'}`, borderRadius: 10, padding: '6px 10px', color: '#334155', fontSize: 12, fontWeight: 800 }}>근거 수준: {hasComparableExamples ? evidenceLabel(strength?.level) : '참고 불가'}</span>
				<span style={{ color: '#64748b', fontSize: 12 }}>엄격 매칭 소재 {comparableCount.toLocaleString('ko-KR')}개</span>
			</div>
			{hasComparableExamples ? (
				<div style={{ ...bannerUi.muted, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 10 }}>
					상위 1개 광고 노출 비중 {(n((concentration as Record<string, any>).top_creative_impression_share) * 100).toFixed(1)}%, 광고비 비중 {(n((concentration as Record<string, any>).top_creative_spend_share) * 100).toFixed(1)}%입니다.
				</div>
			) : <div style={bannerUi.muted}>{historical?.message || '과거 성과 근거를 표시할 수 없습니다.'}</div>}
			{showMoreSimilarButton ? <button type="button" style={{ width: '100%', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '9px 10px', color: '#475569', fontSize: 12, fontWeight: 800 }}>비슷한 광고 더보기</button> : null}
		</div>
	);
}

function BannerComplianceCard({ result, reviewStatus }: { result: GfaBannerAnalysisResult; reviewStatus: string }): JSX.Element {
	const reviewFactor = result.factor_scores?.find((x) => x.key === 'naver_review_fit');
	const compliance = ((result as any)?.naver_compliance || {}) as Record<string, any>;
	const issues = Array.isArray(compliance.issues) ? compliance.issues : [];
	const issueByRule = new Map(issues.map((issue: Record<string, any>) => [String(issue.rule_id || ''), issue]));
	const fallbackPolicyRows = [
		{ rule: 'image_quality', label: '이미지 품질/선명도' },
		{ rule: 'aspect_ratio_safe_area', label: '비율/세이프영역' },
		{ rule: 'text_overload', label: '이미지 내 텍스트 양' },
		{ rule: 'body_part_closeup', label: '특정 신체부위 확대' },
		{ rule: 'before_after_comparison', label: '전후 비교 이미지' },
		{ rule: 'exaggerated_or_unverified_claim', label: '과장/근거 확인 필요 표현' },
		{ rule: 'medical_or_functional_claim', label: '의약품 오인 표현' },
		{ rule: 'misleading_comparison', label: '오해 유발 비교/최상급' },
		{ rule: 'image_relevance', label: '이미지와 광고 대상 관련성' },
		{ rule: 'landing_consistency', label: '랜딩/상세페이지 정합성' },
	];
	const policyChecksRaw = Array.isArray(compliance.checks) ? compliance.checks : [];
	const severityOrder: Record<string, number> = { LIKELY_REJECT: 4, REVIEW_REQUIRED: 3, CAUTION: 2, PASS: 1 };
	const policyChecks = policyChecksRaw.length
		? [...policyChecksRaw].sort((a: Record<string, any>, b: Record<string, any>) => (severityOrder[String(b.status || 'PASS')] || 0) - (severityOrder[String(a.status || 'PASS')] || 0))
		: fallbackPolicyRows.map((row) => {
				const issue = issueByRule.get(row.rule) as Record<string, any> | undefined;
				return { rule_id: row.rule, label: row.label, status: issue?.severity || 'PASS', has_issue: Boolean(issue), observation: issue?.observation, guidance: issue?.guidance };
			});
	const [showAllPolicyChecks, setShowAllPolicyChecks] = React.useState(false);
	const visiblePolicyChecks = showAllPolicyChecks ? policyChecks : policyChecks.slice(0, 10);
	const hiddenPolicyCheckCount = Math.max(0, policyChecks.length - visiblePolicyChecks.length);
	const policyGuideLinks = [
		{ label: '성과형 DA 집행/소재 가이드', href: 'https://ads.naver.com/notice/18005?page=1&searchValue=' },
		{ label: '모바일 DA 이미지배너형', href: 'https://ads.naver.com/adguide/1474' },
		{ label: '모바일 DA 네이티브', href: 'https://ads.naver.com/adguide/1479' },
		{ label: '2:3 이미지피드 제작 가이드', href: 'https://ads.naver.com/notice/28278' },
	];
	const ok = reviewStatus === '사용 가능';
	const policyIssue = hasBannerPolicyIssue(result);
	const reviewComment = policyIssue
		? (reviewFactor?.weak || reviewFactor?.good || '현재 표시할 심사 rule 근거가 충분하지 않습니다.')
		: (reviewFactor?.good || '현재 관찰된 범위에서는 주요 정책 위험이 두드러지지 않습니다.');
	return (
		<div style={{ ...bannerUi.card, display: 'grid', gap: 12, alignContent: 'start' }}>
			<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
				<h3 style={bannerUi.title}>광고 정책 검토 결과</h3>
				<span style={{ width: 16, height: 16, borderRadius: 999, border: '1px solid #cbd5e1', color: '#64748b', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 900 }}>?</span>
			</div>
			<div style={{ background: ok ? '#dcfce7' : '#fffbeb', border: `1px solid ${ok ? '#bbf7d0' : '#fde68a'}`, borderRadius: 14, padding: 12, color: '#111827', fontWeight: 900, display: 'flex', gap: 10, alignItems: 'center' }}>
				<span style={{ width: 32, height: 32, borderRadius: 999, background: ok ? '#16a34a' : '#f59e0b', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 950 }}>{ok ? '✓' : '!'}</span>
				<span>{reviewStatus}</span>
			</div>
			<div style={bannerUi.muted}>{compactText(compliance.summary, '별도 심사 rule 결과가 없으면 보수적으로 검토 필요로 표시합니다.')}</div>
			<div style={{ color: '#64748b', fontSize: 11, fontWeight: 800 }}>
				전체 정책 체크 {policyChecks.length || 0}개 중 문제 {issues.length || 0}개
			</div>
			<div style={{ display: 'grid', gap: 8 }}>
				{visiblePolicyChecks.map((row: Record<string, any>) => {
					const ruleId = String(row.rule_id || row.rule || '');
					const issue = issueByRule.get(ruleId) as Record<string, any> | undefined;
					const status = String(row.status || issue?.severity || 'PASS');
					const caution = Boolean(row.has_issue || issue || status !== 'PASS');
					return (
						<div key={ruleId} style={{ display: 'grid', gap: caution ? 6 : 0 }}>
							<div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
								<div style={{ display: 'flex', gap: 7, alignItems: 'center', color: caution ? '#111827' : '#475569', fontSize: 12, fontWeight: caution ? 900 : 700 }}>
									<span style={{ width: 18, height: 18, borderRadius: 999, background: caution ? '#f59e0b' : '#10b981', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 900 }}>{caution ? '!' : '✓'}</span>
									{compactText(row.label, ruleId)}
								</div>
								<span style={{ background: caution ? '#fef3c7' : '#dcfce7', color: caution ? '#92400e' : '#059669', borderRadius: 999, padding: '3px 8px', fontSize: 10, fontWeight: 900 }}>{policyStatusLabel(status)}</span>
							</div>
							{caution ? (
								<div style={{ marginLeft: 25, background: '#fffbeb', border: '1px solid #fef3c7', borderRadius: 10, padding: 8, color: '#92400e', fontSize: 11, lineHeight: 1.55 }}>
									{compactText(row.observation || issue?.observation, '정책 검토가 필요합니다.')} {compactText(row.guidance || issue?.guidance, '')}
								</div>
							) : null}
						</div>
					);
				})}
			</div>
			{hiddenPolicyCheckCount > 0 || showAllPolicyChecks ? (
				<button type="button" style={{ width: '100%', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '9px 10px', color: '#475569', fontSize: 12, fontWeight: 800 }} onClick={() => setShowAllPolicyChecks((prev) => !prev)}>
					{showAllPolicyChecks ? '정책 항목 접기' : `전체 정책 항목 더보기 (${hiddenPolicyCheckCount}개)`}
				</button>
			) : null}
			<div style={{ color: '#475569', fontSize: 12, lineHeight: 1.6 }}>
				<b>심사 참고 의견</b>
				<div>{reviewComment}</div>
				{policyIssue && reviewFactor?.improvement ? <div style={{ marginTop: 6 }}>{reviewFactor.improvement}</div> : null}
				{!policyIssue ? <div style={{ marginTop: 6, color: '#059669' }}>정책 엔진 판정: 문제 항목 0개 기준으로 AI 원문 리스크 문구를 보정했습니다.</div> : null}
			</div>
			<div style={{ display: 'grid', gap: 6 }}>
				<b style={{ color: '#111827', fontSize: 12 }}>정책 가이드 원문</b>
				<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
					{policyGuideLinks.map((link) => (
						<a key={link.href} href={link.href} target="_blank" rel="noreferrer" style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 999, padding: '7px 10px', color: '#2563eb', fontSize: 11, fontWeight: 900, textDecoration: 'none' }}>
							{link.label}
						</a>
					))}
				</div>
			</div>
		</div>
	);
}

function BannerFactorEvaluation({ result }: { result: GfaBannerAnalysisResult }): JSX.Element {
	const rows = result.factor_scores || [];
	const policyIssue = hasBannerPolicyIssue(result);
	return (
		<section style={{ ...bannerUi.card, marginBottom: 18 }}>
			<div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 14 }}>
				<div>
					<h3 style={{ margin: 0, color: '#111827', fontSize: 18, fontWeight: 900 }}>광고 구성 평가 요소별 분석</h3>
					<p style={{ ...bannerUi.muted, margin: '4px 0 0' }}>앞서 정한 분석 기준별로 잘 된 점, 부족한 점, 수정 방향을 나눠 표시합니다.</p>
				</div>
				<span style={{ color: '#64748b', fontSize: 12, fontWeight: 800 }}>총 {rows.length}개 항목</span>
			</div>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
				{rows.map((factor) => {
					const isPolicyFactor = String(factor.key || '') === 'naver_review_fit';
					const weakText = isPolicyFactor && !policyIssue ? '정책 엔진 기준 현재 문제 항목은 없습니다.' : compactText(factor.weak, '설명이 없습니다.');
					const improvementText = isPolicyFactor && !policyIssue ? '상세페이지 근거와 소재 표현의 일치 여부만 유지 점검하세요.' : compactText(factor.improvement, '설명이 없습니다.');
					return (
						<div key={factor.key} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 14, padding: 12, display: 'grid', gap: 8 }}>
							<div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
								<div style={{ color: '#111827', fontSize: 13, fontWeight: 900 }}>{factor.label}</div>
								<div style={{ color: n(factor.score) >= 75 ? '#16a34a' : n(factor.score) >= 60 ? '#d97706' : '#dc2626', fontSize: 14, fontWeight: 950 }}>{Math.round(n(factor.score))}</div>
							</div>
							<div style={{ color: '#166534', fontSize: 11, lineHeight: 1.5 }}><b>잘 된 점</b><br />{compactText(factor.good, '설명이 없습니다.')}</div>
							<div style={{ color: isPolicyFactor && !policyIssue ? '#475569' : '#92400e', fontSize: 11, lineHeight: 1.5 }}><b>{isPolicyFactor && !policyIssue ? '판정' : '부족한 점'}</b><br />{weakText}</div>
							<div style={{ color: '#1d4ed8', fontSize: 11, lineHeight: 1.5 }}><b>수정 방향</b><br />{improvementText}</div>
						</div>
					);
				})}
			</div>
		</section>
	);
}

function recommendationSourceBadge(text: string, idx: number): JSX.Element {
	const lower = String(text || '').toLowerCase();
	const policy = lower.includes('심사') || lower.includes('가이드') || lower.includes('before') || lower.includes('after') || lower.includes('전후') || lower.includes('확대');
	const historical = lower.includes('과거') || lower.includes('성과') || lower.includes('roas') || lower.includes('ctr') || idx >= 2;
	const label = policy ? '네이버 심사' : historical ? '과거 성과' : '광고 분석';
	const style = policy
		? { background: '#fff1f2', color: '#e11d48', border: '#ffe4e6' }
		: historical
			? { background: '#fff1f2', color: '#e11d48', border: '#ffe4e6' }
			: { background: '#eff6ff', color: '#2563eb', border: '#dbeafe' };
	return <span style={{ background: style.background, color: style.color, border: `1px solid ${style.border}`, borderRadius: 6, padding: '2px 7px', fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap' }}>{label}</span>;
}

function renderRecommendationRows(items?: string[]): JSX.Element {
	const rows = (items || []).filter((x) => String(x || '').trim());
	if (!rows.length) return <div style={{ color: '#64748b', fontSize: 12, marginTop: 10 }}>표시할 항목이 없습니다.</div>;
	return (
		<ul style={{ margin: '12px 0 0', padding: 0, display: 'grid', gap: 10, listStyle: 'none' }}>
			{rows.map((item, idx) => (
				<li key={`${item}-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', color: '#334155', fontSize: 12, lineHeight: 1.45 }}>
					<span style={{ display: 'flex', gap: 7 }}>
						<span style={{ width: 16, height: 16, borderRadius: 999, background: '#16a34a', color: '#fff', display: 'inline-grid', placeItems: 'center', fontSize: 10, fontWeight: 900, flex: '0 0 auto', marginTop: 1 }}>{idx + 1}</span>
						<span>{item}</span>
					</span>
					{recommendationSourceBadge(item, idx)}
				</li>
			))}
		</ul>
	);
}

function BannerRecommendations({ result }: { result: GfaBannerAnalysisResult }): JSX.Element {
	const advice = result.expert_advice || {};
	const policyIssue = hasBannerPolicyIssue(result);
	const columns = [
		{ title: '이런 점은 좋아요!', items: advice.good_points?.length ? advice.good_points : result.strengths, background: '#f0fdf4', border: '#dcfce7', color: '#16a34a' },
		{ title: '먼저 이렇게 수정하세요!', items: advice.fix_first?.length ? advice.fix_first : result.weaknesses, background: '#fffbeb', border: '#fef3c7', color: '#d97706' },
		{ title: '이런 시도도 추천해요!', items: advice.experiments?.length ? advice.experiments : result.recommendations, background: '#eff6ff', border: '#dbeafe', color: '#2563eb' },
	];
	return (
		<section style={{ ...bannerUi.card, padding: 22 }}>
			<h3 style={{ margin: '0 0 4px', color: '#111827', fontSize: 18, fontWeight: 900 }}>전문가의 추천 수정 방향</h3>
			<p style={{ margin: '0 0 16px', color: '#64748b', fontSize: 12 }}>
				{policyIssue ? '정책 이슈가 감지된 항목만 수정 우선 항목으로 분리해 표시합니다.' : '정책 이슈가 없으면 가독성, 상품 인지, 설득 흐름 중심으로 수정 우선순위를 표시합니다.'}
			</p>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
				{columns.map((column) => (
					<div key={column.title} style={{ background: column.background, border: `1px solid ${column.border}`, borderRadius: 16, padding: 16 }}>
						<b style={{ color: column.color, fontSize: 14 }}>{column.title}</b>
						{renderRecommendationRows(column.items)}
					</div>
				))}
			</div>
		</section>
	);
}

function BannerExpertAnalysisV2({ result }: { result: GfaBannerAnalysisResult }): JSX.Element | null {
	const expert = result.expert_analysis_v2;
	if (!expert) return null;
	const dimensions = expert.dimensions || [];
	const policyIssue = hasBannerPolicyIssue(result);
	if (!dimensions.length) return null;
	return (
		<section style={{ ...bannerUi.card, marginBottom: 18, padding: 22 }}>
			<div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 14 }}>
				<div>
					<h3 style={{ margin: 0, color: '#111827', fontSize: 18, fontWeight: 950 }}>전문가 정밀 분석</h3>
					<p style={{ ...bannerUi.muted, margin: '5px 0 0' }}>광고, 심리, 광고 기법, 디자인, 플랫폼 심사 기준으로 분리해 판단 근거를 표시합니다.</p>
				</div>
				<span style={{ color: '#64748b', fontSize: 11, fontWeight: 800 }}>{compactText(expert.taxonomy_version, 'taxonomy-v2')}</span>
			</div>
			{expert.policy_conflict_guard?.policy_risk_promoted_to_fix ? (
				<div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 14, padding: 12, color: '#92400e', fontSize: 12.5, lineHeight: 1.6, marginBottom: 14 }}>
					<b>정책 충돌 보정 적용</b>
					<div>클릭 유도에 도움이 되더라도 심사 리스크가 있는 요소는 좋은 점이 아니라 수정 우선 항목으로 분류했습니다.</div>
				</div>
			) : null}
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
				{dimensions.map((dimension) => {
					const score = n(dimension.score);
					const scoreColor = score >= 80 ? '#059669' : score >= 65 ? '#d97706' : '#dc2626';
					const criteria = (dimension.criteria || []).slice(0, 5);
					return (
						<div key={dimension.key || dimension.title} style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 15, display: 'grid', gap: 10 }}>
							<div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
								<div style={{ color: '#0f172a', fontSize: 15, fontWeight: 950 }}>{dimension.title}</div>
								<div style={{ color: scoreColor, fontSize: 16, fontWeight: 950 }}>{Math.round(score)}</div>
							</div>
							<div style={{ color: '#475569', fontSize: 12.5, lineHeight: 1.6 }}>{compactText(dimension.summary, '세부 기준별 분석을 확인하세요.')}</div>
							<div style={{ display: 'grid', gap: 9 }}>
								{criteria.map((criterion, idx) => (
									<div key={`${criterion.key || criterion.label}-${idx}`} style={{ background: '#f8fafc', border: '1px solid #eef2f7', borderRadius: 12, padding: 10 }}>
										<div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
											<b style={{ color: '#111827', fontSize: 12.5 }}>{criterion.label}</b>
											<span style={{ color: n(criterion.score) >= 75 ? '#059669' : n(criterion.score) >= 60 ? '#d97706' : '#dc2626', fontSize: 12, fontWeight: 950 }}>{Math.round(n(criterion.score))}</span>
										</div>
										<div style={{ color: '#334155', fontSize: 11.5, lineHeight: 1.55, marginTop: 5 }}><b>관찰</b> {compactText(criterion.observation, '관찰 근거 없음')}</div>
										<div style={{ color: '#475569', fontSize: 11.5, lineHeight: 1.55, marginTop: 4 }}><b>해석</b> {compactText(criterion.interpretation, '해석 근거 없음')}</div>
										{criterion.risk && (policyIssue || dimension.key !== 'platform_compliance') ? <div style={{ color: '#92400e', fontSize: 11.5, lineHeight: 1.55, marginTop: 4 }}><b>{dimension.key === 'platform_compliance' ? '주의점' : '리스크'}</b> {criterion.risk}</div> : null}
										{criterion.improvement ? <div style={{ color: '#1d4ed8', fontSize: 11.5, lineHeight: 1.55, marginTop: 4 }}><b>수정</b> {criterion.improvement}</div> : null}
									</div>
								))}
							</div>
						</div>
					);
				})}
			</div>
			{expert.priority_actions?.length ? (
				<div style={{ marginTop: 14, background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 14, padding: 14 }}>
					<b style={{ color: '#3730a3', fontSize: 13 }}>우선 실행 항목</b>
					{renderRecommendationRows(expert.priority_actions)}
				</div>
			) : null}
		</section>
	);
}

function BannerProgrammaticAnalysis({ result }: { result: GfaBannerAnalysisResult }): JSX.Element | null {
	const analysis = result.programmatic_analysis_v1;
	const checks = analysis?.checks || [];
	if (!analysis || !checks.length) return null;
	const cv = analysis.opencv_metrics || {};
	const cvObjectCount = Math.round(n(cv.estimated_object_region_count));
	const cvObjectDetected = cvObjectCount > 0 && n(cv.largest_object_area_ratio) > 0;
	const scoreLabels: Record<string, string> = {
		marketing: '마케팅',
		funnel: '퍼널',
		smp: 'SMP',
		copy_framework: '카피 구조',
		psychology: '심리',
		design: '디자인',
		safe_zone: '세이프존',
		product: '상품 인지',
		compliance: '정책',
	};
	return (
		<section style={{ ...bannerUi.card, marginBottom: 18, padding: 22 }}>
			<div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 14 }}>
				<div>
					<h3 style={{ margin: 0, color: '#111827', fontSize: 18, fontWeight: 950 }}>프로그램 기준 분석</h3>
					<p style={{ ...bannerUi.muted, margin: '5px 0 0' }}>AI 관찰값을 기준으로 프로그램이 고정 규칙으로 판정한 결과입니다.</p>
				</div>
				<span style={{ color: '#64748b', fontSize: 11, fontWeight: 800 }}>{compactText(analysis.version, 'programmatic-v1')}</span>
			</div>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 14 }}>
				{Object.entries(analysis.dimension_scores || {}).map(([key, value]) => (
					<div key={key} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 10 }}>
						<div style={{ color: '#64748b', fontSize: 11, fontWeight: 900 }}>{scoreLabels[key] || key}</div>
						<div style={{ color: n(value) >= 80 ? '#059669' : n(value) >= 65 ? '#d97706' : '#dc2626', fontSize: 18, fontWeight: 950, marginTop: 3 }}>{Math.round(n(value))}</div>
					</div>
				))}
			</div>
			{Object.keys(cv).length ? (
				<div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 14, padding: 12, marginBottom: 14 }}>
					<b style={{ color: '#111827', fontSize: 13 }}>OpenCV 측정 근거</b>
					<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginTop: 8, color: '#475569', fontSize: 12 }}>
						<div>텍스트 영역 <b>{(n(cv.estimated_text_area_ratio) * 100).toFixed(1)}%</b></div>
						<div>텍스트 박스 <b>{Math.round(n(cv.estimated_text_box_count))}개</b></div>
						<div>작은 텍스트 후보 <b>{Math.round(n(cv.small_text_box_count))}개</b></div>
						<div>하단 텍스트 후보 <b>{Math.round(n(cv.bottom_text_box_count))}개</b></div>
						{cvObjectDetected ? (
							<>
								<div>주요 오브젝트 <b>{(n(cv.largest_object_area_ratio) * 100).toFixed(1)}%</b></div>
								<div>오브젝트 위치 <b>{String(cv.largest_object_zone || '-')}</b></div>
								<div>오브젝트 후보 <b>{cvObjectCount}개</b></div>
							</>
						) : (
							<>
								<div>상품 영역 탐지 <b>OpenCV 미검출</b></div>
								<div style={{ gridColumn: 'span 2' }}>배경/인물/제품 경계가 복잡해 윤곽 후보를 못 잡은 상태입니다. 상품이 없다는 의미는 아니며 AI 상품 관찰값으로 보완합니다.</div>
							</>
						)}
						<div>대비 <b>{n(cv.contrast_score).toFixed(2)}</b></div>
						<div>선명도 <b>{n(cv.sharpness_score).toFixed(2)}</b></div>
					</div>
				</div>
			) : null}
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
				{checks.map((check) => {
					const score = n(check.score);
					const color = check.status === 'PASS' ? '#059669' : check.status === 'CAUTION' ? '#d97706' : '#dc2626';
					return (
						<div key={check.key || check.label} style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 13 }}>
							<div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
								<b style={{ color: '#111827', fontSize: 13 }}>{check.label}</b>
								<span style={{ color, fontSize: 13, fontWeight: 950 }}>{check.status} {Math.round(score)}</span>
							</div>
							<div style={{ color: '#334155', fontSize: 12, lineHeight: 1.55, marginTop: 6 }}><b>근거</b> {compactText(check.evidence, '-')}</div>
							<div style={{ color: check.status === 'PASS' ? '#475569' : '#92400e', fontSize: 12, lineHeight: 1.55, marginTop: 5 }}><b>{check.status === 'PASS' ? '판정' : '문제'}</b> {compactText(check.issue, '-')}</div>
							<div style={{ color: '#1d4ed8', fontSize: 12, lineHeight: 1.55, marginTop: 5 }}><b>수정</b> {compactText(check.action, '-')}</div>
						</div>
					);
				})}
			</div>
			{analysis.limits ? <div style={{ ...bannerUi.muted, marginTop: 12 }}>{analysis.limits}</div> : null}
		</section>
	);
}

function BannerActionBar({ onDownloadImage, onDownloadBaseImage }: { onDownloadImage: () => void; onDownloadBaseImage: () => void }): JSX.Element {
	return (
		<div className="print-hide" style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap', marginTop: 20, paddingBottom: 18 }}>
			<button type="button" onClick={onDownloadImage} style={{ background: '#4f46e5', color: '#fff', border: 0, borderRadius: 12, padding: '12px 18px', fontSize: 13, fontWeight: 900, boxShadow: '0 2px 8px rgba(79,70,229,0.16)' }}>배너 이미지 다운로드</button>
			<button type="button" onClick={onDownloadBaseImage} style={{ background: '#fff', color: '#374151', border: '1px solid #dbeafe', borderRadius: 12, padding: '12px 18px', fontSize: 13, fontWeight: 900, boxShadow: '0 2px 8px rgba(15,23,42,0.05)' }}>Base 이미지 다운로드</button>
			<button type="button" onClick={() => window.print()} style={{ background: '#fff', color: '#374151', border: '1px solid #e5e7eb', borderRadius: 12, padding: '12px 18px', fontSize: 13, fontWeight: 900, boxShadow: '0 2px 8px rgba(15,23,42,0.05)' }}>보고서 다운로드/인쇄</button>
		</div>
	);
}

function BannerHistoryModal(props: {
	open: boolean;
	loading: boolean;
	items: GfaBannerAnalysisHistoryItem[];
	error: string;
	onClose: () => void;
	onRefresh: () => void;
	onSelect: (historyId: string) => void;
}): JSX.Element | null {
	if (!props.open) return null;
	return (
		<div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,0.55)', display: 'grid', placeItems: 'center', padding: 24 }}>
			<div style={{ width: 'min(980px, 96vw)', maxHeight: '86vh', overflow: 'hidden', background: '#fff', borderRadius: 20, border: '1px solid #e5e7eb', boxShadow: '0 24px 80px rgba(15,23,42,0.24)', display: 'grid', gridTemplateRows: 'auto 1fr auto' }}>
				<div style={{ padding: 18, borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
					<div>
						<h2 style={{ margin: 0, color: '#111827', fontSize: 18, fontWeight: 900 }}>과거 배너 분석</h2>
						<p style={{ ...bannerUi.muted, margin: '4px 0 0' }}>저장된 분석을 선택하면 해당 결과 화면으로 다시 불러옵니다.</p>
					</div>
					<div style={{ display: 'flex', gap: 8 }}>
						<button type="button" onClick={props.onRefresh} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '8px 11px', color: '#374151', fontSize: 12, fontWeight: 800 }}>새로고침</button>
						<button type="button" onClick={props.onClose} style={{ background: '#111827', border: 0, borderRadius: 10, padding: '8px 11px', color: '#fff', fontSize: 12, fontWeight: 800 }}>닫기</button>
					</div>
				</div>
				<div style={{ overflow: 'auto', padding: 18 }}>
					{props.error ? <div style={{ color: '#dc2626', fontSize: 12, fontWeight: 800, marginBottom: 10 }}>{props.error}</div> : null}
					{props.loading ? (
						<div style={bannerUi.muted}>과거 분석을 불러오는 중입니다.</div>
					) : (
						<table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
							<thead>
								<tr style={{ background: '#f8fafc', color: '#475569', textAlign: 'left' }}>
									<th style={{ padding: 10, borderBottom: '1px solid #e5e7eb' }}>분석일자</th>
									<th style={{ padding: 10, borderBottom: '1px solid #e5e7eb' }}>파일명</th>
									<th style={{ padding: 10, borderBottom: '1px solid #e5e7eb' }}>점수</th>
									<th style={{ padding: 10, borderBottom: '1px solid #e5e7eb' }}>등급</th>
									<th style={{ padding: 10, borderBottom: '1px solid #e5e7eb' }}>생성</th>
									<th style={{ padding: 10, borderBottom: '1px solid #e5e7eb' }}>분석 요약</th>
									<th style={{ padding: 10, borderBottom: '1px solid #e5e7eb' }} />
								</tr>
							</thead>
							<tbody>
								{props.items.length ? props.items.map((item) => (
									<tr key={item.history_id}>
										<td style={{ padding: 10, borderBottom: '1px solid #f1f5f9', color: '#475569', whiteSpace: 'nowrap' }}>{item.created_at ? new Date(item.created_at).toLocaleString('ko-KR') : '-'}</td>
										<td style={{ padding: 10, borderBottom: '1px solid #f1f5f9', color: '#111827', fontWeight: 800 }}>{item.filename || '-'}</td>
										<td style={{ padding: 10, borderBottom: '1px solid #f1f5f9', color: '#0284c7', fontWeight: 900 }}>{Math.round(n(item.overall_score))}</td>
										<td style={{ padding: 10, borderBottom: '1px solid #f1f5f9', color: '#475569' }}>{item.grade || '-'}</td>
										<td style={{ padding: 10, borderBottom: '1px solid #f1f5f9', color: item.generated_count ? '#059669' : '#94a3b8', fontWeight: 900, whiteSpace: 'nowrap' }}>
											{item.generated_count ? `${item.generated_count}건` : '-'}
										</td>
										<td style={{ padding: 10, borderBottom: '1px solid #f1f5f9', color: '#64748b', maxWidth: 360 }}>{compactText(item.verdict, '-')}</td>
										<td style={{ padding: 10, borderBottom: '1px solid #f1f5f9', textAlign: 'right' }}>
											<button type="button" onClick={() => props.onSelect(item.history_id)} style={{ background: '#4f46e5', color: '#fff', border: 0, borderRadius: 10, padding: '7px 10px', fontSize: 12, fontWeight: 900 }}>불러오기</button>
										</td>
									</tr>
								)) : (
									<tr>
										<td colSpan={7} style={{ padding: 22, color: '#64748b', textAlign: 'center' }}>저장된 배너 분석이 없습니다.</td>
									</tr>
								)}
							</tbody>
						</table>
					)}
				</div>
				<div style={{ padding: 14, borderTop: '1px solid #e5e7eb', color: '#64748b', fontSize: 12 }}>최근 분석 순으로 최대 50건을 표시합니다.</div>
			</div>
		</div>
	);
}

const MaskBrushEditor = forwardRef<MaskBrushEditorHandle, {
	imageSrc: string;
	disabled?: boolean;
	annotationVisible?: boolean;
	onMaskChange: (hasMask: boolean) => void;
}>(function MaskBrushEditor(props, ref): JSX.Element {
	const [brushSize, setBrushSize] = useState(46);
	const [eraseMode, setEraseMode] = useState(false);
	const drawingRef = useRef(false);
	const lastPointRef = useRef<{ x: number; y: number } | null>(null);
	const overlayRef = useRef<HTMLCanvasElement | null>(null);
	const maskRef = useRef<HTMLCanvasElement | null>(null);
	const canvasSize = 1024;

	const clearMask = () => {
		[overlayRef.current, maskRef.current].forEach((canvas) => {
			const ctx = canvas?.getContext('2d');
			if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
		});
		props.onMaskChange(false);
	};

	useImperativeHandle(ref, () => ({
		exportSemanticMaskBlob: () => {
			const canvas = maskRef.current;
			if (!canvas) return Promise.reject(new Error('마스크 이미지를 만들 수 없습니다.'));
			return exportSanitizedSemanticMaskBlob(canvas);
		},
		clearLayers: clearMask,
	}), []);

	useEffect(() => {
		clearMask();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [props.imageSrc]);

	const pointFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
		const rect = e.currentTarget.getBoundingClientRect();
		return {
			x: ((e.clientX - rect.left) / Math.max(1, rect.width)) * canvasSize,
			y: ((e.clientY - rect.top) / Math.max(1, rect.height)) * canvasSize,
		};
	};

	const drawTo = (e: React.PointerEvent<HTMLCanvasElement>) => {
		if (!drawingRef.current || props.disabled) return;
		const overlay = overlayRef.current;
		const mask = maskRef.current;
		const overlayCtx = overlay?.getContext('2d');
		const maskCtx = mask?.getContext('2d');
		if (!overlay || !mask || !overlayCtx || !maskCtx) return;
		const pt = pointFromEvent(e);
		const last = lastPointRef.current || pt;
		[
			{ ctx: overlayCtx, strokeStyle: GFA_UI_ANNOTATION_STROKE_STYLE },
			{ ctx: maskCtx, strokeStyle: GFA_SEMANTIC_MASK_STROKE },
		].forEach(({ ctx, strokeStyle }) => {
			ctx.save();
			ctx.globalCompositeOperation = eraseMode ? 'destination-out' : 'source-over';
			ctx.strokeStyle = strokeStyle;
			ctx.lineWidth = brushSize;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			ctx.beginPath();
			ctx.moveTo(last.x, last.y);
			ctx.lineTo(pt.x, pt.y);
			ctx.stroke();
			ctx.restore();
		});
		lastPointRef.current = pt;
		props.onMaskChange(true);
	};

	const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
		if (props.disabled) return;
		e.preventDefault();
		e.currentTarget.setPointerCapture(e.pointerId);
		drawingRef.current = true;
		lastPointRef.current = pointFromEvent(e);
		drawTo(e);
	};
	const endDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
		try {
			e.currentTarget.releasePointerCapture(e.pointerId);
		} catch {
			// ignore pointer capture release races
		}
		drawingRef.current = false;
		lastPointRef.current = null;
	};

	return (
		<div style={{ display: 'grid', gap: 8 }}>
			<div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(148,163,184,0.24)', background: '#020617' }}>
				{props.imageSrc ? <img src={props.imageSrc} alt="mask target" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }} /> : null}
				<canvas
					ref={overlayRef}
					width={canvasSize}
					height={canvasSize}
					onPointerDown={startDraw}
					onPointerMove={drawTo}
					onPointerUp={endDraw}
					onPointerLeave={endDraw}
					style={{
						position: 'absolute',
						inset: 0,
						width: '100%',
						height: '100%',
						cursor: eraseMode ? 'cell' : 'crosshair',
						touchAction: 'none',
						visibility: props.annotationVisible === false ? 'hidden' : 'visible',
					}}
				/>
				<canvas ref={maskRef} width={canvasSize} height={canvasSize} style={{ display: 'none' }} />
			</div>
			<div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr auto auto', alignItems: 'center' }}>
				<label style={{ display: 'grid', gap: 4, color: '#cbd5e1', fontSize: 12, fontWeight: 800 }}>
					브러시 크기
					<input type="range" min="12" max="120" step="2" value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} />
				</label>
				<button type="button" className={eraseMode ? 'btn-primary' : 'btn-ghost'} onClick={() => setEraseMode((v) => !v)}>
					{eraseMode ? '지우개 중' : '지우개'}
				</button>
				<button type="button" className="btn-ghost" onClick={clearMask}>마스크 초기화</button>
			</div>
			<div style={{ color: '#fef3c7', fontSize: 11, lineHeight: 1.45 }}>
				초록 마킹은 화면에만 표시됩니다. 원본 이미지와 AI 입력에는 포함되지 않으며, 실제 전송은 흰색 semantic mask입니다.
			</div>
		</div>
	);
});

const MASK_EDIT_PRESETS = [
	{ label: '오브젝트 삭제', prompt: '선택한 영역의 불필요한 오브젝트만 삭제하고 주변 배경과 빛, 그림자를 자연스럽게 이어줘.' },
	{ label: '배경 정리', prompt: '선택한 영역의 배경을 더 깔끔하고 상업 광고처럼 정리하되 제품과 인물은 유지해줘.' },
	{ label: '소품 제거', prompt: '선택한 영역의 작은 소품이나 산만한 요소를 제거하고 자연스러운 배경으로 채워줘.' },
	{ label: '색감 보정', prompt: '선택한 영역의 색감과 밝기를 주변과 자연스럽게 맞춰 더 고급스럽게 보정해줘.' },
	{ label: '참고 이미지 반영', prompt: '첨부한 참고 이미지의 질감, 색감, 형태를 선택 영역 안에만 자연스럽게 반영해줘.' },
];

const HAIR_NATIVE_PRESETS = [
	{ label: 'Hair 길이', prompt: '머리카락 길이를 어깨 아래까지 자연스럽게 늘려줘.' },
	{ label: 'Hair 웨이브', prompt: '전체 머리카락에 자연스럽고 부드러운 웨이브를 만들어줘.' },
	{ label: 'Hair 윤기/끝정리', prompt: '머리카락을 건강하고 자연스러운 윤기가 나도록 하고 끝부분을 가지런하게 정리해줘.' },
];

const SHOW_LEGACY_PARTIAL_IMAGE_EDIT = false;

function GfaProfessionalEditorModal(props: {
	title: string;
	subtitle: string;
	run: GfaCreativeGeneratorRun;
	draft: ProfessionalEditorCopyDraft;
	overlay: OverlayLayout;
	activeOverlayKey: OverlayKey;
	fontOptions: GfaCreativeGeneratorFont[];
	canvas: JSX.Element;
	replacementPanel?: JSX.Element | null;
	savingCopy: boolean;
	regeneratingCopy: boolean;
	regeneratingImage: boolean;
	maskEditing: boolean;
	maskEditPrompt: string;
	maskEditMode: 'default' | 'hair_native_transform';
	hasEditMask: boolean;
	maskReferenceImages: File[];
	maskEditPreview: ProfessionalEditorMaskPreview | null;
	maskEditorRef: React.MutableRefObject<MaskBrushEditorHandle | null>;
	maskTargetSrc: string;
	maskPreviewSrc: string;
	onClose: () => void;
	onSave: () => void;
	onRegenerateCopy: () => void;
	onRegenerateImage: () => void;
	onActiveKeyChange: (key: OverlayKey) => void;
	onCopyField: (key: 'headline' | 'subcopy' | 'proofLine' | 'cta', value: string) => void;
	onOverlayChange: (key: OverlayKey, patch: Partial<OverlayItem>) => void;
	onMaskEditPrompt: (value: string) => void;
	onMaskEditMode: (value: 'default' | 'hair_native_transform') => void;
	onMaskChange: (has: boolean) => void;
	onMaskReferenceImages: (files: File[]) => void;
	onMaskPreview: () => void;
	onApplyPreview: () => void;
	onCancelPreview: () => void;
}): JSX.Element {
	const labels: Record<OverlayKey, string> = { headline: '메인카피', subcopy: '서브카피', proof: '증거/보조문구', cta: 'CTA' };
	const darkEditorInputStyle: React.CSSProperties = {
		background: '#020617',
		color: '#e5e7eb',
		border: '1px solid rgba(148,163,184,0.28)',
	};
	const busy = props.savingCopy || props.regeneratingCopy || props.regeneratingImage || props.maskEditing;
	return (
		<div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(2,6,23,0.86)', display: 'grid', placeItems: 'center', padding: 18 }}>
			<div style={{ width: 'min(1280px, 96vw)', maxHeight: '92vh', overflow: 'hidden', borderRadius: 16, border: '1px solid rgba(148,163,184,0.28)', background: '#020617', display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)' }}>
				<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid rgba(148,163,184,0.18)' }}>
					<div>
						<div style={{ fontSize: 15, fontWeight: 900, color: '#e5e7eb' }}>{props.title}</div>
						<div style={{ fontSize: 12, color: '#94a3b8' }}>{props.subtitle}</div>
					</div>
					<div style={{ display: 'flex', gap: 8 }}>
						<button type="button" className="btn-primary" onClick={props.onSave} disabled={props.savingCopy}>{props.savingCopy ? '저장 중...' : '편집 저장'}</button>
						<button type="button" className="btn-ghost" onClick={props.onRegenerateCopy} disabled={busy}>{props.regeneratingCopy ? '카피 생성 중...' : '카피만 새로 생성'}</button>
						<button type="button" className="btn-ghost" onClick={props.onRegenerateImage} disabled={props.savingCopy || props.regeneratingImage}>{props.regeneratingImage ? '합성 중...' : '최종 이미지 반영'}</button>
						<button type="button" className="btn-ghost" onClick={props.onClose}>닫기</button>
					</div>
				</div>
				<div style={{ display: 'grid', gridTemplateColumns: 'minmax(520px, 1fr) 390px', gap: 14, padding: 14, overflow: 'auto' }}>
					<div>{props.canvas}</div>
					<div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
						<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
							{(['headline', 'subcopy', 'proof', 'cta'] as OverlayKey[]).map((key) => (
								<button key={key} type="button" className={props.activeOverlayKey === key ? 'btn-primary' : 'btn-ghost'} onClick={() => props.onActiveKeyChange(key)}>{labels[key]}</button>
							))}
						</div>
						<textarea className="input" style={darkEditorInputStyle} value={props.draft.headline} rows={2} onChange={(e) => props.onCopyField('headline', e.target.value)} placeholder="메인카피" />
						<textarea className="input" style={darkEditorInputStyle} value={props.draft.subcopy} rows={2} onChange={(e) => props.onCopyField('subcopy', e.target.value)} placeholder="서브카피" />
						<input className="input" style={darkEditorInputStyle} value={props.draft.proofLine} onChange={(e) => props.onCopyField('proofLine', e.target.value)} placeholder="증거/보조문구" />
						<input className="input" style={darkEditorInputStyle} value={props.draft.cta} onChange={(e) => props.onCopyField('cta', e.target.value)} placeholder="CTA" />
						<LayerPropertyPanel
							overlay={props.overlay}
							activeKey={props.activeOverlayKey}
							onActiveKeyChange={props.onActiveKeyChange}
							onOverlayChange={props.onOverlayChange}
							fontOptions={props.fontOptions}
							dark
						/>
						{props.replacementPanel ? <div>{props.replacementPanel}</div> : null}
						{SHOW_LEGACY_PARTIAL_IMAGE_EDIT ? (
						<div style={{ display: 'grid', gap: 8, border: '1px solid rgba(148,163,184,0.16)', borderRadius: 12, padding: 10, background: 'rgba(15,23,42,0.72)' }}>
							<div style={{ fontSize: 13, fontWeight: 900, color: '#e5e7eb' }}>부분 이미지 수정</div>
							<div style={{ color: '#94a3b8', fontSize: 11, lineHeight: 1.45 }}>
								ChatGPT 부분 수정처럼 바꿀 영역만 칠한 뒤 지시문을 입력하세요. Hair Native는 머리 구조 변경을 Native Edit에 맡기고, 서버 카피/CTA는 다시 합성합니다.
							</div>
							<label style={{ display: 'grid', gap: 6, color: '#cbd5e1', fontSize: 12, fontWeight: 800 }}>
								수정 모드
								<select
									className="input"
									style={darkEditorInputStyle}
									value={props.maskEditMode}
									onChange={(e) => props.onMaskEditMode(e.target.value as 'default' | 'hair_native_transform')}
									disabled={props.maskEditing}
								>
									<option value="default" style={{ background: '#020617', color: '#fff' }}>일반 부분 수정 · Frozen Hair/Product V1 유지</option>
									<option value="hair_native_transform" style={{ background: '#020617', color: '#fff' }}>Hair Native 변환 · Locked Asset Restore</option>
								</select>
							</label>
							<MaskBrushEditor
								ref={props.maskEditorRef}
								imageSrc={props.maskTargetSrc}
								disabled={props.maskEditing}
								annotationVisible={!props.maskEditPreview}
								onMaskChange={props.onMaskChange}
							/>
							<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
								{(props.maskEditMode === 'hair_native_transform' ? HAIR_NATIVE_PRESETS : MASK_EDIT_PRESETS).map((preset) => (
									<button
										key={preset.label}
										type="button"
										className="btn-ghost"
										onClick={() => props.onMaskEditPrompt(props.maskEditPrompt.trim() ? `${props.maskEditPrompt.trim()}\n${preset.prompt}` : preset.prompt)}
										disabled={props.maskEditing}
										style={{ fontSize: 11, padding: '6px 8px' }}
									>
										{preset.label}
									</button>
								))}
							</div>
							{props.maskEditMode === 'hair_native_transform' ? (
								<div style={{ color: '#bfdbfe', fontSize: 11, lineHeight: 1.45, background: 'rgba(30,64,175,0.22)', border: '1px solid rgba(147,197,253,0.22)', borderRadius: 10, padding: 8 }}>
									rough hair 영역과 새 머리카락이 뻗을 방향만 칠하세요. 얼굴 전체, 목 전체, 상반신 전체를 넓게 칠하면 Native 결과가 불안정해질 수 있습니다.
								</div>
							) : null}
							<label style={{ display: 'grid', gap: 6, color: '#cbd5e1', fontSize: 12, fontWeight: 800 }}>
								참고 이미지 업로드
								<input
									className="input"
									style={darkEditorInputStyle}
									type="file"
									accept="image/png,image/jpeg,image/webp"
									multiple
									onChange={(e) => props.onMaskReferenceImages(Array.from(e.target.files || []).slice(0, 4))}
								/>
							</label>
							{props.maskReferenceImages.length ? (
								<div style={{ color: '#bfdbfe', fontSize: 11, lineHeight: 1.45 }}>
									첨부 이미지 {props.maskReferenceImages.length}장: {props.maskReferenceImages.map((file) => file.name).join(', ')}
								</div>
							) : (
								<div style={{ color: '#94a3b8', fontSize: 11 }}>참고 이미지는 최대 4장까지 함께 전송됩니다.</div>
							)}
							<textarea
								className="input"
								style={darkEditorInputStyle}
								value={props.maskEditPrompt}
								rows={3}
								onChange={(e) => props.onMaskEditPrompt(e.target.value)}
								placeholder="예: 선택 영역의 나뭇잎 오브젝트만 삭제하고 주변 배경은 자연스럽게 채워줘."
							/>
							<button
								type="button"
								className="btn-primary"
								onClick={props.onMaskPreview}
								disabled={props.maskEditing || !props.hasEditMask || !props.maskEditPrompt.trim()}
							>
								{props.maskEditing ? '부분 수정 중...' : '마스크 영역 미리보기 생성'}
							</button>
							{props.maskEditPreview?.imageUrl ? (
								<div style={{ display: 'grid', gap: 8, border: '1px solid rgba(34,197,94,0.35)', borderRadius: 12, padding: 8, background: 'rgba(22,101,52,0.18)' }}>
									<div style={{ color: '#bbf7d0', fontSize: 12, fontWeight: 900 }}>부분 수정 미리보기</div>
									<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
										<div style={{ display: 'grid', gap: 4 }}>
											<div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 800 }}>원본</div>
											<img src={props.maskTargetSrc} alt="masked edit original" style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(148,163,184,0.25)' }} />
										</div>
										<div style={{ display: 'grid', gap: 4 }}>
											<div style={{ color: '#bbf7d0', fontSize: 11, fontWeight: 800 }}>수정 미리보기</div>
											<img src={props.maskPreviewSrc} alt="masked edit preview" style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(187,247,208,0.25)' }} />
										</div>
									</div>
									<div style={{ display: 'flex', gap: 8 }}>
										<button type="button" className="btn-primary" onClick={props.onApplyPreview} disabled={props.maskEditing}>수정 결과 저장</button>
										<button type="button" className="btn-ghost" onClick={props.onCancelPreview} disabled={props.maskEditing}>취소</button>
									</div>
								</div>
							) : null}
						</div>
						) : null}
					</div>
				</div>
			</div>
		</div>
	);
}

function BannerAnalysisGenerationPanel(props: {
	apiBaseUrl: string;
	result: GfaBannerAnalysisResult;
	previewUrl: string;
	note: string;
	skuId: string;
	onGenerationChange?: (generation: GfaBannerAnalysisGenerationResult) => void;
}): JSX.Element {
	const [generating, setGenerating] = useState(false);
	const [generation, setGeneration] = useState<GfaBannerAnalysisGenerationResult | null>(null);
	const [message, setMessage] = useState('');
	const [editorOpen, setEditorOpen] = useState(false);
	const [fontOptions, setFontOptions] = useState<GfaCreativeGeneratorFont[]>([]);
	const [activeOverlayKey, setActiveOverlayKey] = useState<OverlayKey>('headline');
	const [adPlacement, setAdPlacement] = useState('naver_gfa:feed');
	const [generationFocus, setGenerationFocus] = useState<'source_image_focus' | 'similar_creative_focus'>('source_image_focus');
	const [copyDrafts, setCopyDrafts] = useState<Record<string, { headline: string; subcopy: string; proofLine: string; cta: string; ctaEnabled: boolean; landingMessage: string }>>({});
	const [overlayDrafts, setOverlayDrafts] = useState<Record<string, OverlayLayout>>({});
	const [savingCopy, setSavingCopy] = useState('');
	const [regeneratingCopy, setRegeneratingCopy] = useState('');
	const [regeneratingImage, setRegeneratingImage] = useState('');
	const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});
	const [maskEditPrompt, setMaskEditPrompt] = useState('');
	const [maskEditMode, setMaskEditMode] = useState<'default' | 'hair_native_transform'>('default');
	const [maskEditingImage, setMaskEditingImage] = useState('');
	const [hasEditMask, setHasEditMask] = useState(false);
	const [maskReferenceImages, setMaskReferenceImages] = useState<File[]>([]);
	const [maskEditPreview, setMaskEditPreview] = useState<{ runId: string; imageUrl: string; baseImageUrl?: string; prompt: string; editMode?: string } | null>(null);
	const maskEditorRef = useRef<MaskBrushEditorHandle | null>(null);
	const run = generation?.runs?.find((x) => x.status === 'generated') || generation?.runs?.[0] || null;
	const adPlacementOptions = [
		{ value: 'naver_gfa:feed', label: '네이버 GFA · 피드영역', spec: '1:1 정사각 · 1200x1200 권장', disabled: false },
		{ value: 'naver_gfa:message', label: '네이버 GFA · 메시지/배너영역', spec: '준비중', disabled: true },
		{ value: 'naver_gfa:pc', label: '네이버 GFA · PC 배너', spec: '준비중', disabled: true },
		{ value: 'kakao:feed', label: '카카오 · 피드', spec: '준비중', disabled: true },
		{ value: 'meta:feed', label: 'Meta · 피드', spec: '준비중', disabled: true },
	];
	const generationFocusOptions = [
		{ value: 'source_image_focus' as const, label: '기존 분석이미지 중점', desc: '원본 배너의 인물/제품/장면을 유지하고 분석 수정사항을 우선 반영' },
		{ value: 'similar_creative_focus' as const, label: '유사 소재 중점', desc: '참고 소재의 장면/구도/질감을 더 적극 활용하되 분석 수정사항은 유지' },
	];
	const selectedAdPlacement = adPlacementOptions.find((item) => item.value === adPlacement) ?? adPlacementOptions[0]!;
	const selectedGenerationFocus = generationFocusOptions.find((item) => item.value === generationFocus) ?? generationFocusOptions[0]!;
	const darkSelectStyle: React.CSSProperties = {
		background: '#020617',
		color: '#fff',
		borderColor: '#334155',
	};

	useEffect(() => {
		let cancelled = false;
		fetchGfaCreativeGeneratorFonts({ baseUrl: props.apiBaseUrl })
			.then((items) => {
				if (!cancelled) setFontOptions(items);
			})
			.catch(() => {
				if (!cancelled) setFontOptions([]);
			});
		return () => {
			cancelled = true;
		};
	}, [props.apiBaseUrl]);

	useEffect(() => {
		const savedGeneration = props.result.generation_result_v1;
		if (savedGeneration?.runs?.length) {
			setGeneration(savedGeneration);
		} else {
			setGeneration(null);
		}
	}, [props.result.history?.history_id, props.result.generation_result_v1]);

	const copyDraftFor = (item: GfaCreativeGeneratorRun) => {
		const copy = item.copy_result || {};
		return copyDrafts[item.id] || {
			headline: editableText(copy.headline, ''),
			subcopy: editableText(copy.subcopy, ''),
			proofLine: compactText(copy.proof_line, ''),
			cta: compactText(copy.cta, ''),
			ctaEnabled: copy.cta_enabled !== false,
			landingMessage: compactText(copy.landing_message, ''),
		};
	};
	const overlayFor = (item: GfaCreativeGeneratorRun): OverlayLayout => overlayDrafts[item.id] || overlayFromValue(item.copy_result?.overlay_layout);
	const setCopyDraftField = (item: GfaCreativeGeneratorRun, key: 'headline' | 'subcopy' | 'proofLine' | 'cta' | 'landingMessage', value: string) => {
		setCopyDrafts((prev) => ({ ...prev, [item.id]: { ...copyDraftFor(item), [key]: value } }));
	};
	const setOverlayItem = (item: GfaCreativeGeneratorRun, key: OverlayKey, patch: Partial<OverlayItem>) => {
		setOverlayDrafts((prev) => {
			const current = prev[item.id] || overlayFor(item);
			return { ...prev, [item.id]: { ...current, [key]: { ...current[key], ...patch } } };
		});
	};
	const updateRun = (next: GfaCreativeGeneratorRun) => {
		setGeneration((prev) => prev ? { ...prev, runs: prev.runs.map((x) => (x.id === next.id ? next : x)) } : prev);
	};
	const saveRunCopy = async (item: GfaCreativeGeneratorRun): Promise<GfaCreativeGeneratorRun | null> => {
		const draft = copyDraftFor(item);
		setSavingCopy(item.id);
		setMessage('');
		try {
			const next = await updateGfaCreativeGeneratorRunCopy({
				baseUrl: props.apiBaseUrl,
				runId: item.id,
				headline: draft.headline,
				subcopy: draft.subcopy,
				proofLine: draft.proofLine,
				cta: draft.cta,
				ctaEnabled: draft.ctaEnabled,
				overlayLayout: overlayFor(item),
				landingMessage: draft.landingMessage,
				note: '배너 분석 기반 생성 결과 편집 저장',
			});
			updateRun(next);
			setCopyDrafts((prev) => {
				const out = { ...prev };
				delete out[item.id];
				return out;
			});
			setOverlayDrafts((prev) => {
				const out = { ...prev };
				delete out[item.id];
				return out;
			});
			setMessage('편집 저장 완료');
			return next;
		} catch (e) {
			setMessage(errorText(e));
			return null;
		} finally {
			setSavingCopy('');
		}
	};
	const regenerateFromEditor = async (item: GfaCreativeGeneratorRun) => {
		setRegeneratingImage(item.id);
		setMessage('');
		try {
			const saved = await saveRunCopy(item);
			if (!saved) return;
			const next = await regenerateGfaCreativeGeneratorRunImage({
				baseUrl: props.apiBaseUrl,
				runId: saved.id,
				imageLocked: Boolean(saved.can_lock_image),
				note: '배너 분석 기반 생성 결과 편집 후 최종 합성',
			});
			updateRun(next);
			setMessage('편집 내용을 최종 이미지에 반영했습니다.');
		} catch (e) {
			setMessage(errorText(e));
		} finally {
			setRegeneratingImage('');
		}
	};
	const regenerateCopyOnlyFromEditor = async (item: GfaCreativeGeneratorRun) => {
		setRegeneratingCopy(item.id);
		setMessage('');
		try {
			const next = await regenerateGfaCreativeGeneratorRunCopy({
				baseUrl: props.apiBaseUrl,
				runId: item.id,
				note: '전문 편집기에서 카피만 새로 생성',
			});
			updateRun(next);
			setCopyDrafts((prev) => {
				const out = { ...prev };
				delete out[item.id];
				return out;
			});
			setOverlayDrafts((prev) => {
				const out = { ...prev };
				delete out[item.id];
				return out;
			});
			setMessage('이미지는 유지하고 카피만 새로 생성했습니다.');
		} catch (e) {
			setMessage(errorText(e));
		} finally {
			setRegeneratingCopy('');
		}
	};
	const editMaskedImageFromEditor = async (item: GfaCreativeGeneratorRun) => {
		const prompt = maskEditPrompt.trim();
		if (!prompt) {
			setMessage('마스크 영역을 어떻게 수정할지 입력하세요.');
			return;
		}
		const editor = maskEditorRef.current;
		if (!editor || !hasEditMask) {
			setMessage('수정할 부위를 먼저 마스킹하세요.');
			return;
		}
		setMaskEditingImage(item.id);
		setMessage('');
		try {
			const maskBlob = await editor.exportSemanticMaskBlob();
			const result = await editGfaCreativeGeneratorRunImageMasked({
				baseUrl: props.apiBaseUrl,
				runId: item.id,
				prompt,
				mask: maskBlob,
				referenceImages: maskReferenceImages,
				editMode: maskEditMode,
				note: '전문 편집기 마스크 영역 이미지 수정',
			});
			if (result.run) updateRun(result.run);
			editor.clearLayers();
			setHasEditMask(false);
			if (result.preview?.image_url) {
				setMaskEditPreview({
					runId: item.id,
					imageUrl: result.preview.image_url,
					baseImageUrl: result.preview.base_image_url,
					prompt,
					editMode: result.preview.edit_mode || maskEditMode,
				});
				setMessage(maskEditMode === 'hair_native_transform' ? 'Hair Native + Locked Asset Restore 미리보기를 생성했습니다. 결과 저장을 눌러야 최종 반영됩니다.' : '마스크 영역 수정 미리보기를 생성했습니다. 결과 저장을 눌러야 최종 반영됩니다.');
			} else {
				setMessage('마스크 영역 이미지 수정 완료');
			}
		} catch (e) {
			setMessage(errorText(e));
		} finally {
			setMaskEditingImage('');
		}
	};
	const applyMaskedImagePreview = async (item: GfaCreativeGeneratorRun) => {
		if (!maskEditPreview?.imageUrl) {
			setMessage('저장할 부분 수정 미리보기가 없습니다.');
			return;
		}
		setMaskEditingImage(item.id);
		setMessage('');
		try {
			const next = await applyGfaCreativeGeneratorRunImagePreview({
				baseUrl: props.apiBaseUrl,
				runId: item.id,
				imageUrl: maskEditPreview.imageUrl,
				baseImageUrl: maskEditPreview.baseImageUrl,
				prompt: maskEditPreview.prompt,
				editMode: maskEditPreview.editMode,
				note: '전문 편집기 마스크 수정 결과 저장',
			});
			updateRun(next);
			maskEditorRef.current?.clearLayers();
			setHasEditMask(false);
			setMaskEditPreview(null);
			setMaskEditPrompt('');
			setMaskReferenceImages([]);
			setMessage('부분 수정 결과를 최종 이미지에 저장했습니다.');
		} catch (e) {
			setMessage(errorText(e));
		} finally {
			setMaskEditingImage('');
		}
	};
	const generate = async () => {
		setGenerating(true);
		setMessage('');
		try {
			const historyId = props.result.history?.history_id || String((props.result as any).history_id || '');
			const data = await generateGfaBannerFromAnalysis({
				baseUrl: props.apiBaseUrl,
				result: props.result,
				imageDataUrl: props.previewUrl,
				historyId,
				note: props.note,
				skuId: props.skuId || String(props.result.content_context_v1?.sku_id || ''),
				goal: 'click',
				adMedia: adPlacement.split(':')[0],
				adPlacement: adPlacement.split(':')[1],
				generationFocus,
				candidateCount: 1,
			});
			setGeneration(data);
			props.onGenerationChange?.(data);
			const first = data.runs?.find((x) => x.status === 'generated') || data.runs?.[0];
			setMessage(first?.status === 'generated' ? '분석 기반 새 이미지 생성 완료' : friendlyGenerationError(first?.error || '생성 실패'));
		} catch (e) {
			setMessage(errorText(e));
		} finally {
			setGenerating(false);
		}
	};
	const renderCanvas = (item: GfaCreativeGeneratorRun, large = false, editable = false) => {
		const imageSrc = item.image_url ? `${assetUrl(props.apiBaseUrl, item.image_url)}${item.updated_at ? `?v=${encodeURIComponent(item.updated_at)}` : ''}` : '';
		const baseImageSrc = item.base_image_url ? `${assetUrl(props.apiBaseUrl, item.base_image_url)}${item.updated_at ? `?v=${encodeURIComponent(item.updated_at)}` : ''}` : '';
		const draft = copyDraftFor(item);
		const canEdit = Boolean(editable && item.can_lock_image && baseImageSrc && !brokenImages[`base:${item.id}`]);
		return (
			<GfaCanvasEditor
				baseImageSrc={baseImageSrc}
				finalImageSrc={imageSrc}
				baseImageBroken={Boolean(brokenImages[`base:${item.id}`])}
				finalImageBroken={Boolean(brokenImages[`final:${item.id}`])}
				alt={item.source_creative_name || 'analysis generated banner'}
				overlay={overlayFor(item)}
				texts={{ headline: draft.headline, subcopy: draft.subcopy, proof: draft.proofLine, cta: draft.ctaEnabled ? draft.cta : '' }}
				activeKey={activeOverlayKey}
				onActiveKeyChange={setActiveOverlayKey}
				onOverlayChange={(key, patch) => setOverlayItem(item, key, patch)}
				canEdit={canEdit}
				maxWidth={large ? 720 : 420}
				large={large}
				fontOptions={fontOptions}
				onImageError={(kind) => setBrokenImages((prev) => ({ ...prev, [`${kind}:${item.id}`]: true }))}
				onImageLoad={(kind) => setBrokenImages((prev) => ({ ...prev, [`${kind}:${item.id}`]: false }))}
			/>
		);
	};
	const priorityRows = generation?.priority_changes || [];
	const draft = run ? copyDraftFor(run) : null;
	const overlay = run ? overlayFor(run) : null;
	const audit = (run?.generation_explanation as any)?.generation_alignment_audit || (run?.copy_result as any)?.creative_score_detail?.generation_alignment_audit || null;
	const overlayPlan = (run?.copy_result as any)?.overlay_design_plan || null;
	const maskTargetSrc = run
		? `${assetUrl(props.apiBaseUrl, run.base_image_url || run.image_url || '')}${run.updated_at ? `?v=${encodeURIComponent(run.updated_at)}` : ''}`
		: '';
	const maskPreviewSrc = maskEditPreview?.imageUrl ? `${assetUrl(props.apiBaseUrl, maskEditPreview.imageUrl)}?v=${encodeURIComponent(maskEditPreview.prompt)}` : '';
	const auditScoreColor = (score: unknown) => n(score) >= 85 ? '#059669' : n(score) >= 65 ? '#d97706' : '#dc2626';
	const auditMiniCard = (label: string, score: unknown, detail: string) => (
		<div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 10 }}>
			<div style={{ color: '#64748b', fontSize: 11, fontWeight: 900 }}>{label}</div>
			<div style={{ color: auditScoreColor(score), fontSize: 18, fontWeight: 950, marginTop: 2 }}>{score == null ? '-' : `${Math.round(n(score))}%`}</div>
			<div style={{ color: '#475569', fontSize: 11, lineHeight: 1.45, marginTop: 4 }}>{detail}</div>
		</div>
	);

	return (
		<section className="print-hide" style={{ background: '#fff', border: '1px solid #dbeafe', borderRadius: 20, padding: 18, marginTop: 18, boxShadow: '0 12px 28px rgba(37,99,235,0.08)' }}>
			<div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
				<div>
					<h2 style={{ margin: 0, color: '#111827', fontSize: 18, fontWeight: 950 }}>분석 기반 새 이미지 생성</h2>
					<p style={{ ...bannerUi.muted, margin: '5px 0 0' }}>분석 엔진의 수정 우선순위와 광고 가이드 기준을 생성 브리프로 변환해 새 배너를 만듭니다.</p>
				</div>
				<div style={{ display: 'grid', gap: 6, minWidth: 280 }}>
					<label style={{ display: 'grid', gap: 4, color: '#475569', fontSize: 12, fontWeight: 900 }}>
						광고 매체 / 게시 위치
						<select className="input" style={darkSelectStyle} value={adPlacement} onChange={(e) => setAdPlacement(e.target.value)} disabled={generating}>
							{adPlacementOptions.map((item) => (
								<option key={item.value} value={item.value} disabled={item.disabled} style={{ background: '#020617', color: '#fff' }}>
									{item.label} {item.disabled ? '(준비중)' : ''}
								</option>
							))}
						</select>
					</label>
					<div style={{ color: '#64748b', fontSize: 11 }}>{selectedAdPlacement.spec}</div>
					<label style={{ display: 'grid', gap: 4, color: '#475569', fontSize: 12, fontWeight: 900 }}>
						생성 기준
						<select className="input" style={darkSelectStyle} value={generationFocus} onChange={(e) => setGenerationFocus(e.target.value as 'source_image_focus' | 'similar_creative_focus')} disabled={generating}>
							{generationFocusOptions.map((item) => (
								<option key={item.value} value={item.value} style={{ background: '#020617', color: '#fff' }}>{item.label}</option>
							))}
						</select>
					</label>
					<div style={{ color: '#64748b', fontSize: 11, lineHeight: 1.45 }}>{selectedGenerationFocus.desc}</div>
					<button type="button" onClick={generate} disabled={generating || selectedAdPlacement.disabled} style={{ background: generating || selectedAdPlacement.disabled ? '#94a3b8' : '#4f46e5', color: '#fff', border: 0, borderRadius: 12, padding: '12px 18px', fontSize: 13, fontWeight: 900, boxShadow: '0 8px 18px rgba(79,70,229,0.18)' }}>
						{generating ? '새 이미지 생성 중...' : '선택 규격으로 새 이미지 생성'}
					</button>
				</div>
			</div>
			{message ? <div style={{ marginTop: 10, color: message.includes('완료') ? '#047857' : '#b45309', fontSize: 12, fontWeight: 900 }}>{message}</div> : null}
			{run ? (
				<div style={{ display: 'grid', gridTemplateColumns: 'minmax(360px, 720px) minmax(0, 1fr)', gap: 16, alignItems: 'start', marginTop: 16 }}>
					<div>
						{renderCanvas(run, true, false)}
						<button type="button" onClick={() => setEditorOpen(true)} style={{ marginTop: 10, width: '100%', background: '#111827', color: '#fff', border: 0, borderRadius: 12, padding: '10px 14px', fontSize: 13, fontWeight: 900 }}>전문 편집기 열기</button>
					</div>
					<div style={{ display: 'grid', gap: 10 }}>
						<b style={{ color: '#111827', fontSize: 14 }}>수정 우선순위 요약</b>
						{priorityRows.length ? priorityRows.slice(0, 5).map((item, idx) => (
							<div key={`${item.key || idx}`} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 10 }}>
								<div style={{ color: '#1d4ed8', fontSize: 12, fontWeight: 950 }}>{idx + 1}. {compactText(item.label, '수정 항목')} · {Math.round(n(item.score))}점</div>
								<div style={{ color: '#334155', fontSize: 12, marginTop: 4 }}>{compactText(item.action || item.issue, '-')}</div>
							</div>
						)) : <div style={bannerUi.muted}>생성 브리프의 수정 우선순위가 없습니다.</div>}
						{audit ? (
							<div style={{ display: 'grid', gap: 10, marginTop: 6, borderTop: '1px solid #e2e8f0', paddingTop: 10 }}>
								<b style={{ color: '#111827', fontSize: 14 }}>생성 반영 검증</b>
								<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
									{auditMiniCard('종합 반영률', audit.overall_score, compactText(audit.status, '-'))}
									{auditMiniCard('분석 문제 반영', audit.analysis_reflection?.score, `${n(audit.analysis_reflection?.represented_in_prompt)}/${n(audit.analysis_reflection?.priority_total)}개 반영`)}
									{auditMiniCard('가이드 준수', audit.guide_compliance?.score, `카피 ${Math.round(n(audit.guide_compliance?.copy_score))}% · 가이드 ${Math.round(n(audit.guide_compliance?.guide_presence_score))}%`)}
									{auditMiniCard('임의 생성 억제', audit.anti_randomness?.score, '참조/제품보존/텍스트 오버레이 규칙')}
								</div>
								{(audit.analysis_reflection?.missing_or_weak_items || []).length ? (
									<div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 12, padding: 10, color: '#9a3412', fontSize: 12, lineHeight: 1.55 }}>
										<b>미반영 또는 약한 항목</b>
										<ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
											{audit.analysis_reflection.missing_or_weak_items.slice(0, 4).map((item: Record<string, any>, idx: number) => (
												<li key={`${item.key || idx}`}>{compactText(item.label || item.key, '수정 항목')} - {compactText(item.action, '프롬프트 반영 근거 약함')}</li>
											))}
										</ul>
									</div>
								) : null}
								{Array.isArray(audit.limits) && audit.limits.length ? <div style={{ ...bannerUi.muted, fontSize: 11 }}>{audit.limits.join(' ')}</div> : null}
							</div>
						) : run.status === 'generated' ? (
							<div style={{ background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 12, padding: 10, color: '#64748b', fontSize: 12 }}>
								이 생성물은 검증 기능 추가 이전 결과라 반영률 데이터가 없습니다. 새로 생성하면 분석 반영 검증이 표시됩니다.
							</div>
						) : null}
						{overlayPlan ? (
							<div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: 10, color: '#166534', fontSize: 12, lineHeight: 1.55 }}>
								<b>자동 카피 배치/강조 설계</b>
								<div style={{ marginTop: 4 }}>{compactText(overlayPlan.source, '배너 제작 가이드 기반')}</div>
								{Array.isArray(overlayPlan.principles) ? <div style={{ marginTop: 4 }}>{overlayPlan.principles.slice(0, 3).join(' · ')}</div> : null}
							</div>
						) : null}
						<textarea readOnly value={compactText(run.image_prompt, '')} rows={5} style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 12, padding: 10, color: '#475569', background: '#f8fafc', fontSize: 11 }} />
					</div>
				</div>
			) : null}
			{editorOpen && run && draft ? (
				<GfaProfessionalEditorModal
					title="분석 기반 생성 이미지 편집"
					subtitle="텍스트 레이어 위치, 크기, 색상, 배경을 수정한 뒤 최종 이미지에 반영합니다."
					run={run}
					draft={draft}
					overlay={overlay || overlayFor(run)}
					activeOverlayKey={activeOverlayKey}
					fontOptions={fontOptions}
					canvas={renderCanvas(run, true, true)}
					replacementPanel={(
						<GfaCreativeImageReplacementPanel
							apiBaseUrl={props.apiBaseUrl}
							run={run}
							onRunUpdated={updateRun}
							onMessage={setMessage}
						/>
					)}
					savingCopy={savingCopy === run.id}
					regeneratingCopy={regeneratingCopy === run.id}
					regeneratingImage={regeneratingImage === run.id}
					maskEditing={maskEditingImage === run.id}
					maskEditPrompt={maskEditPrompt}
					maskEditMode={maskEditMode}
					hasEditMask={hasEditMask}
					maskReferenceImages={maskReferenceImages}
					maskEditPreview={maskEditPreview}
					maskEditorRef={maskEditorRef}
					maskTargetSrc={maskTargetSrc}
					maskPreviewSrc={maskPreviewSrc}
					onClose={() => setEditorOpen(false)}
					onSave={() => void saveRunCopy(run)}
					onRegenerateCopy={() => void regenerateCopyOnlyFromEditor(run)}
					onRegenerateImage={() => void regenerateFromEditor(run)}
					onActiveKeyChange={setActiveOverlayKey}
					onCopyField={(key, value) => setCopyDraftField(run, key, value)}
					onOverlayChange={(key, patch) => setOverlayItem(run, key, patch)}
					onMaskEditPrompt={setMaskEditPrompt}
					onMaskEditMode={setMaskEditMode}
					onMaskChange={setHasEditMask}
					onMaskReferenceImages={setMaskReferenceImages}
					onMaskPreview={() => void editMaskedImageFromEditor(run)}
					onApplyPreview={() => void applyMaskedImagePreview(run)}
					onCancelPreview={() => {
						maskEditorRef.current?.clearLayers();
						setHasEditMask(false);
						setMaskEditPreview(null);
					}}
				/>
			) : null}
		</section>
	);
}

export function GfaBannerAnalysisView(props: { apiBaseUrl: string }): JSX.Element {
	const [file, setFile] = useState<File | null>(null);
	const [previewUrl, setPreviewUrl] = useState<string>('');
	const [note, setNote] = useState<string>('');
	const [analyzing, setAnalyzing] = useState(false);
	const [message, setMessage] = useState<string>('');
	const [result, setResult] = useState<GfaBannerAnalysisResult | null>(null);
	const [historyOpen, setHistoryOpen] = useState(false);
	const [historyLoading, setHistoryLoading] = useState(false);
	const [historyItems, setHistoryItems] = useState<GfaBannerAnalysisHistoryItem[]>([]);
	const [historyError, setHistoryError] = useState('');
	const [contentContexts, setContentContexts] = useState<GfaBannerContentContextItem[]>([]);
	const [skuId, setSkuId] = useState('');

	useEffect(() => {
		if (!file) {
			return;
		}
		let cancelled = false;
		fileToDataUrl(file).then((url) => {
			if (!cancelled && url) setPreviewUrl(url);
		});
		return () => { cancelled = true; };
	}, [file]);

	useEffect(() => {
		let cancelled = false;
		fetchGfaBannerContentContexts({ baseUrl: props.apiBaseUrl })
			.then((items) => {
				if (cancelled) return;
				setContentContexts(items);
				setSkuId((prev) => prev || items.find((item) => item.ready)?.sku_id || items[0]?.sku_id || '');
			})
			.catch(() => {
				if (!cancelled) setContentContexts([]);
			});
		return () => {
			cancelled = true;
		};
	}, [props.apiBaseUrl]);

	useEffect(() => {
		const stored = readStoredBannerAnalysis();
		if (!stored) return;
		setResult(stored.result);
		setPreviewUrl(stored.previewUrl || '');
		setNote(stored.note || '');
		setMessage('이전 분석 결과를 불러왔습니다.');
	}, []);

	const reset = () => {
		setResult(null);
		setFile(null);
		setPreviewUrl('');
		setNote('');
		setMessage('');
		clearStoredBannerAnalysis();
	};

	const loadHistory = async () => {
		setHistoryLoading(true);
		setHistoryError('');
		try {
			const items = await fetchGfaBannerAnalysisHistory({ baseUrl: props.apiBaseUrl, limit: 50 });
			setHistoryItems(items);
		} catch (e) {
			setHistoryError(errorText(e));
		} finally {
			setHistoryLoading(false);
		}
	};

	const openHistory = () => {
		setHistoryOpen(true);
		void loadHistory();
	};

	const selectHistory = async (historyId: string) => {
		setHistoryLoading(true);
		setHistoryError('');
		try {
			const item = await fetchGfaBannerAnalysisHistoryDetail({ baseUrl: props.apiBaseUrl, historyId });
			if (!item.result) throw new Error('저장된 분석 결과가 비어 있습니다.');
			const resultWithGeneration = {
				...item.result,
				history: item.result.history || {
					history_id: item.history_id,
					filename: item.filename,
					content_type: item.content_type,
					image_size_bytes: item.image_size_bytes,
					note: item.note,
					created_at: item.created_at,
				},
				generation_result_v1: item.generation_result_v1 || item.result.generation_result_v1,
			};
			setResult(resultWithGeneration);
			setPreviewUrl(item.image_data_url || '');
			setFile(null);
			setNote(item.note || '');
			setSkuId(String(item.result?.content_context_v1?.sku_id || skuId || ''));
			setMessage('과거 분석 결과를 불러왔습니다.');
			writeStoredBannerAnalysis({
				result: resultWithGeneration,
				previewUrl: item.image_data_url || '',
				note: item.note || '',
				fileName: item.filename || '',
				fileSize: item.image_size_bytes || 0,
			});
			setHistoryOpen(false);
		} catch (e) {
			setHistoryError(errorText(e));
		} finally {
			setHistoryLoading(false);
		}
	};

	const runAnalysis = async () => {
		if (!file) {
			setMessage('분석할 배너 이미지를 먼저 업로드하세요.');
			return;
		}
		setAnalyzing(true);
		setMessage('');
		try {
			const data = await analyzeGfaBannerImage({ baseUrl: props.apiBaseUrl, file, note, skuId });
			const persistedPreviewUrl = previewUrl || await fileToDataUrl(file);
			setResult(data);
			setMessage('배너 분석이 완료되었습니다.');
			writeStoredBannerAnalysis({
				result: data,
				previewUrl: persistedPreviewUrl,
				note,
				fileName: file.name,
				fileSize: file.size,
			});
		} catch (e) {
			setMessage(errorText(e));
		} finally {
			setAnalyzing(false);
		}
	};
	const downloadCurrentBannerImage = async () => {
		if (!result) {
			setMessage('다운로드할 이미지가 없습니다.');
			return;
		}
		const generatedRun = result.generation_result_v1?.runs?.find((item) => item.status === 'generated' && item.image_url) || result.generation_result_v1?.runs?.find((item) => item.image_url);
		const fallbackHistoryImageSrc = result.history?.history_id
			? `${props.apiBaseUrl}/gfa/banner-analysis/history/${encodeURIComponent(result.history.history_id)}/image`
			: '';
		const src = generatedRun?.image_url ? assetUrl(props.apiBaseUrl, generatedRun.image_url) : previewUrl || fallbackHistoryImageSrc;
		if (!src) {
			setMessage('다운로드할 이미지가 없습니다.');
			return;
		}
		try {
			const baseName = generatedRun?.id ? `generated-banner-${generatedRun.id}.png` : file?.name || result.filename || 'analyzed-banner.png';
			await downloadImageOnly(src, baseName);
			setMessage('배너 이미지를 다운로드했습니다.');
		} catch (e) {
			setMessage(errorText(e));
		}
	};
	const downloadCurrentBaseImage = async () => {
		if (!result) {
			setMessage('다운로드할 Base 이미지가 없습니다.');
			return;
		}
		const generatedRun = result.generation_result_v1?.runs?.find((item) => item.status === 'generated' && item.base_image_url) || result.generation_result_v1?.runs?.find((item) => item.base_image_url);
		const src = generatedRun?.base_image_url ? assetUrl(props.apiBaseUrl, generatedRun.base_image_url) : '';
		if (!src) {
			setMessage('카피/CTA가 빠진 Base 이미지가 없습니다. 새로 생성한 이미지의 clean base가 있을 때 다운로드할 수 있습니다.');
			return;
		}
		try {
			await downloadImageOnly(src, `base-banner-${generatedRun?.id || 'image'}.png`);
			setMessage('Base 이미지를 다운로드했습니다.');
		} catch (e) {
			setMessage(errorText(e));
		}
	};
	const applyGenerationToCurrentAnalysis = (generationResult: GfaBannerAnalysisGenerationResult) => {
		setResult((prev) => {
			if (!prev) return prev;
			const next = { ...prev, generation_result_v1: generationResult };
			writeStoredBannerAnalysis({
				result: next,
				previewUrl,
				note,
				fileName: file?.name || next.filename || '',
				fileSize: file?.size || next.history?.image_size_bytes || 0,
			});
			return next;
		});
	};

	const factors = result?.factor_scores || [];
	const improvementScore = n(factors.find((x) => x.key === 'design_layout')?.score || factors.find((x) => x.key === 'text_readability')?.score);
	const compliancePayload = result ? ((result as any)?.naver_compliance || (result as any)?.compliance_review || (result as any)?.naver_compliance_review) : null;
	const complianceState = compactText(compliancePayload?.status || compliancePayload?.state, '');
	const reviewStatus = ({ PASS: '사용 가능', CAUTION: '주의 필요', REVIEW_REQUIRED: '검토 필요', LIKELY_REJECT: '수정 필요' } as Record<string, string>)[complianceState] || '검토 필요';
	const improvementStatus = improvementScore >= 80 ? '소폭 수정 권장' : improvementScore >= 65 ? '일부 수정 권장' : '수정 필요';
	const historyImageSrc = result?.history?.history_id
		? `${props.apiBaseUrl}/gfa/banner-analysis/history/${encodeURIComponent(result.history.history_id)}/image`
		: '';
	const analysisImageSrc = previewUrl || historyImageSrc;

	return (
		<div style={bannerUi.page}>
			<BannerShellHeader hasResult={Boolean(result)} onReset={reset} onOpenHistory={openHistory} />
			<BannerHistoryModal
				open={historyOpen}
				loading={historyLoading}
				items={historyItems}
				error={historyError}
				onClose={() => setHistoryOpen(false)}
				onRefresh={loadHistory}
				onSelect={selectHistory}
			/>
			{!result ? (
				<BannerUploadCard
					file={file}
					previewUrl={previewUrl}
					note={note}
					skuId={skuId}
					contextItems={contentContexts}
					analyzing={analyzing}
					message={message}
					onFile={(selected) => { setFile(selected); setResult(null); setMessage(''); }}
					onNote={setNote}
					onSkuId={setSkuId}
					onAnalyze={runAnalysis}
				/>
			) : (
				<div className="gfa-banner-print-area">
					<BannerHero result={result} />
					<BannerMetricCards result={result} reviewStatus={reviewStatus} improvementStatus={improvementStatus} />
					{result.content_context_v1 ? (
						<section style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 16, padding: 14, marginBottom: 14, color: '#166534', fontSize: 12 }}>
							<b>AI 콘텐츠 센터 연결</b>
							<div style={{ marginTop: 6 }}>
								SKU {compactText(result.content_context_v1.sku_id, '-')} · 상세페이지 분석 {n(result.content_context_v1.detail_page_count)}개 · 제품 이미지 {result.content_context_v1.product_image?.asset_id ? '연결됨' : '미연결'} · 참고 소재 {n(result.content_context_v1.reference_media_count)}개
							</div>
							<div style={{ marginTop: 4, color: '#15803d' }}>정책/주장 정합성은 상세페이지 분석 근거와 비교하고, 새 이미지 생성 시 제품 이미지는 콘텐츠 센터 업로드본을 우선 참조하며 그룹 참고 소재로 장면/구도를 다양화합니다.</div>
						</section>
					) : null}
					<main style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14, marginBottom: 18 }}>
						<BannerImageCard previewUrl={analysisImageSrc} file={file} result={result} />
						<BannerDetectedFeaturesCard result={result} />
						<BannerHistoricalCard result={result} apiBaseUrl={props.apiBaseUrl} />
						<BannerComplianceCard result={result} reviewStatus={reviewStatus} />
					</main>
					<BannerProgrammaticAnalysis result={result} />
					<BannerExpertAnalysisV2 result={result} />
					<BannerFactorEvaluation result={result} />
					<BannerRecommendations result={result} />
					<BannerAnalysisGenerationPanel apiBaseUrl={props.apiBaseUrl} result={result} previewUrl={previewUrl} note={note} skuId={skuId} onGenerationChange={applyGenerationToCurrentAnalysis} />
					<BannerActionBar onDownloadImage={() => void downloadCurrentBannerImage()} onDownloadBaseImage={() => void downloadCurrentBaseImage()} />
				</div>
			)}
		</div>
	);
	/*
	const [file, setFile] = useState<File | null>(null);
	const [previewUrl, setPreviewUrl] = useState<string>('');
	const [note, setNote] = useState<string>('');
	const [analyzing, setAnalyzing] = useState(false);
	const [message, setMessage] = useState<string>('');
	const [result, setResult] = useState<GfaBannerAnalysisResult | null>(null);

	useEffect(() => {
		if (!file) {
			setPreviewUrl('');
			return;
		}
		const url = URL.createObjectURL(file);
		setPreviewUrl(url);
		return () => URL.revokeObjectURL(url);
	}, [file]);

	const runAnalysis = async () => {
		if (!file) {
			setMessage('분석할 배너 이미지를 먼저 업로드하세요.');
			return;
		}
		setAnalyzing(true);
		setMessage('');
		try {
			const data = await analyzeGfaBannerImage({ baseUrl: props.apiBaseUrl, file, note });
			setResult(data);
			setMessage('배너 분석이 완료되었습니다.');
		} catch (e) {
			setMessage(errorText(e));
		} finally {
			setAnalyzing(false);
		}
	};

	const overall = Number(result?.overall_score || 0);
	const factors = result?.factor_scores || [];
	const criteriaTargets = result?.criteria?.score_targets as Record<string, number> | undefined;
	const historical = result?.historical_evidence;
	const similar = historical?.similar_creative_evidence;
	const historicalPerf = similar?.performance || {};
	const historicalStrength = similar?.evidence_strength;
	const compositionScore = Math.round((n(factors.find((x) => x.key === 'hook')?.score) + n(factors.find((x) => x.key === 'alignment')?.score) + n(factors.find((x) => x.key === 'cta')?.score)) / 3 || overall);
	const reviewFactor = factors.find((x) => x.key === 'naver_review_fit');
	const improvementScore = n(factors.find((x) => x.key === 'design_layout')?.score || factors.find((x) => x.key === 'text_readability')?.score);
	const compliancePayload = (result as any)?.naver_compliance || (result as any)?.compliance_review || (result as any)?.naver_compliance_review;
	const complianceState = compactText(compliancePayload?.status || compliancePayload?.state, '');
	const reviewStatus = ({ PASS: '사용 가능', CAUTION: '주의 필요', REVIEW_REQUIRED: '검토 필요', LIKELY_REJECT: '수정 필요' } as Record<string, string>)[complianceState] || '검토 필요';
	const improvementStatus = improvementScore >= 80 ? '소폭 수정 권장' : improvementScore >= 65 ? '일부 수정 권장' : '수정 필요';

	return (
		<div style={{ maxWidth: 1400, margin: '0 auto', padding: 24, color: '#1e293b', background: '#fcfdfd', minHeight: '100vh', fontFamily: 'Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif' }}>
			<header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', marginBottom: 24 }}>
				<div>
					<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
						<h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, color: '#111827' }}>GFA 광고 소재 분석</h1>
						<span style={{ background: '#eef2ff', color: '#4f46e5', border: '1px solid #e0e7ff', borderRadius: 999, padding: '2px 9px', fontSize: 12, fontWeight: 900 }}>Beta</span>
					</div>
					<p style={{ margin: '6px 0 0', color: '#64748b', fontSize: 14 }}>광고를 집행하기 전에, 전문가의 분석으로 더 좋은 결과를 만들어보세요.</p>
				</div>
				<div style={{ display: 'flex', gap: 10 }}>
					<button type="button" onClick={() => { setResult(null); setFile(null); setMessage(''); }} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '10px 14px', color: '#374151', fontSize: 12, fontWeight: 800, boxShadow: '0 1px 4px rgba(15,23,42,0.06)' }}>다른 이미지 분석하기</button>
					<button type="button" style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '10px 14px', color: '#374151', fontSize: 12, fontWeight: 800, boxShadow: '0 1px 4px rgba(15,23,42,0.06)' }}>어떻게 사용하나요?</button>
				</div>
			</header>

			{!result ? (
				<div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 520px)', gap: 14 }}>
					<div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 18, padding: 22, display: 'grid', gap: 12 }}>
						<h2 style={{ margin: 0, color: '#111827', fontSize: 18 }}>분석할 이미지 업로드</h2>
						<input
							type="file"
							accept="image/png,image/jpeg,image/webp"
							style={{ background: '#fff', color: '#334155', border: '1px solid #e2e8f0', borderRadius: 10, padding: 10, fontSize: 12 }}
							onChange={(e) => { const selected = e.target.files?.[0] || null; setFile(selected); setResult(null); setMessage(''); }}
						/>
						{previewUrl ? <img src={previewUrl} alt="업로드 배너 미리보기" style={{ width: '100%', maxHeight: 420, objectFit: 'contain', borderRadius: 14, border: '1px solid #e5e7eb' }} /> : <div style={{ border: '1px dashed #cbd5e1', borderRadius: 14, padding: 28, textAlign: 'center', color: '#64748b' }}>JPG/PNG/WEBP 배너 이미지를 선택하세요.</div>}
						<textarea
							value={note}
							onChange={(e) => setNote(e.target.value)}
							rows={4}
							placeholder="예: 타깃, 상품명, 의도한 메인카피/CTA, 랜딩 목적 등"
							style={{ background: '#fff', color: '#334155', border: '1px solid #e2e8f0', borderRadius: 12, padding: 12, fontSize: 13, resize: 'vertical' }}
						/>
						<button type="button" onClick={runAnalysis} disabled={analyzing || !file} style={{ background: analyzing || !file ? '#cbd5e1' : '#4f46e5', color: '#fff', border: 0, borderRadius: 12, padding: '12px 16px', fontSize: 13, fontWeight: 900, cursor: analyzing || !file ? 'not-allowed' : 'pointer' }}>{analyzing ? 'AI 분석 중...' : 'AI 배너 분석'}</button>
						{message ? <div style={{ color: message.includes('완료') ? '#16a34a' : '#dc2626', fontSize: 12, fontWeight: 900 }}>{message}</div> : null}
					</div>
				</div>
			) : (
				<>
					<section style={{ background: '#e9fbf0', border: '1px solid #c1f3d4', borderRadius: 18, padding: 22, marginBottom: 18, display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'center' }}>
						<div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
							<div style={{ width: 54, height: 54, borderRadius: 999, background: '#00c73c', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 32, fontWeight: 900 }}>✓</div>
							<div>
								<h2 style={{ margin: 0, color: '#111827', fontSize: 24, fontWeight: 900 }}>{overall >= 70 ? '이 소재는 사용 가능성이 높습니다!' : '이 소재는 수정 후 사용을 권장합니다.'}</h2>
								<p style={{ margin: '6px 0 0', color: '#4b5563', fontSize: 14 }}>{result.verdict || '아래 내용을 참고해 사용 전 검토해보세요.'}</p>
							</div>
						</div>
						<div style={{ background: '#d2f6de', border: '1px solid #b2ecc5', borderRadius: 18, padding: '14px 32px', textAlign: 'center', minWidth: 180 }}>
							<div style={{ color: '#4b5563', fontSize: 12, fontWeight: 800 }}>AI 광고 구성 점검</div>
							<div style={{ color: '#111827', fontSize: 36, fontWeight: 950 }}>{overall.toFixed(0)} <span style={{ fontSize: 16, color: '#64748b' }}>/ 100</span></div>
						</div>
					</section>

					<section style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14, marginBottom: 18 }}>
						{metricBlock('광고 구성 평가', compositionScore, (v) => `${Math.round(n(v))} / 100`)}
						{metricBlock('과거 데이터 근거', historicalStrength?.level, () => evidenceLabel(historicalStrength?.level))}
						{metricBlock('네이버 광고 심사', reviewStatus, () => reviewStatus)}
						{metricBlock('개선 필요도', improvementStatus, () => improvementStatus)}
					</section>

					<main style={{ display: 'grid', gridTemplateColumns: '1.05fr 1fr 1.15fr 1fr', gap: 14, marginBottom: 18 }}>
						<div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 18, padding: 18 }}>
							<h3 style={{ margin: '0 0 12px', color: '#111827', fontSize: 16, fontWeight: 900 }}>분석한 이미지</h3>
							{previewUrl ? <img src={previewUrl} alt="분석한 배너" style={{ width: '100%', aspectRatio: '1/1', objectFit: 'contain', borderRadius: 14, border: '1px solid #e5e7eb', background: '#f8fafc' }} /> : null}
							<div style={{ color: '#64748b', fontSize: 12, marginTop: 10 }}>{file?.name || result.filename || '업로드 이미지'}<br />{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : ''}</div>
						</div>
						<div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 18, padding: 18, display: 'grid', gap: 10 }}>
							<h3 style={{ margin: 0, color: '#111827', fontSize: 16, fontWeight: 900 }}>이런 요소가 보입니다</h3>
							{[findEvidenceFeature(result, 'gender'), findEvidenceFeature(result, 'gray_hair'), findEvidenceFeature(result, 'product_visibility'), findEvidenceFeature(result, 'appeal_type'), findEvidenceFeature(result, 'cta')].map((item, idx) => (
								<div key={idx} style={{ display: 'flex', gap: 10, alignItems: 'center', background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: 14, padding: 10 }}>
									<div style={{ width: 32, height: 32, borderRadius: 999, background: '#e2e8f0', display: 'grid', placeItems: 'center', color: '#475569', fontWeight: 900 }}>{idx + 1}</div>
									<div style={{ color: '#475569', fontSize: 12, fontWeight: 800 }}>{item ? featureLabel(item) : '근거가 부족한 요소'}</div>
								</div>
							))}
						</div>
						<div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 18, padding: 18 }}>
							<h3 style={{ margin: 0, color: '#111827', fontSize: 16, fontWeight: 900 }}>비슷한 광고의 실제 성과</h3>
							<p style={{ color: '#64748b', fontSize: 11, lineHeight: 1.5 }}>이와 유사한 특징의 과거 운영 광고를 분석한 결과입니다. 현재 광고의 성과 보장값이 아닙니다.</p>
							<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, textAlign: 'center', margin: '14px 0' }}>
								{metricBlock('과거 관찰 CTR', historicalPerf.ctr, pct)}
								{metricBlock('구매 전환율', historicalPerf.purchase_cvr, pct)}
								{metricBlock('구매 ROAS', historicalPerf.purchase_roas, roasMultiple)}
							</div>
							<div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginTop: 10 }}>
								<span style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '6px 10px', color: '#334155', fontSize: 12, fontWeight: 800 }}>근거 수준: {evidenceLabel(historicalStrength?.level)}</span>
								<details>
									<summary style={{ color: '#475569', fontSize: 12, cursor: 'pointer', fontWeight: 800 }}>비슷한 광고 더보기</summary>
									<div style={{ marginTop: 10 }}>{historical ? <RenderHistoricalEvidencePanel evidence={historical} /> : null}</div>
								</details>
							</div>
						</div>
						<div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 18, padding: 18 }}>
							<h3 style={{ margin: '0 0 12px', color: '#111827', fontSize: 16, fontWeight: 900 }}>광고 정책 검토 결과</h3>
							<div style={{ background: reviewStatus === '사용 가능' ? '#dcfce7' : '#fffbeb', border: `1px solid ${reviewStatus === '사용 가능' ? '#bbf7d0' : '#fde68a'}`, borderRadius: 14, padding: 12, color: '#111827', fontWeight: 900 }}>{reviewStatus}</div>
							<div style={{ color: '#64748b', fontSize: 11, lineHeight: 1.5, marginTop: 8 }}>
								{compliancePayload ? '네이버 심사 rule 결과를 표시합니다.' : '별도 심사 rule 결과가 없어 AI 분석의 심사 참고 의견만 표시합니다.'}
							</div>
							<div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
								<div style={{ color: '#475569', fontSize: 12, lineHeight: 1.6 }}>
									<b>심사 참고 의견</b>
									<div>{reviewFactor?.weak || reviewFactor?.good || '현재 표시할 심사 rule 근거가 충분하지 않습니다.'}</div>
									{reviewFactor?.improvement ? <div style={{ marginTop: 6 }}>{reviewFactor.improvement}</div> : null}
								</div>
							</div>
						</div>
					</main>

					<section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 18, padding: 22 }}>
						<h3 style={{ margin: '0 0 4px', color: '#111827', fontSize: 18, fontWeight: 900 }}>전문가의 추천 수정 방향</h3>
						<p style={{ margin: '0 0 16px', color: '#64748b', fontSize: 12 }}>지금 이대로도 좋지만, 아래 부분을 수정하면 더 좋은 결과를 기대할 수 있어요.</p>
						<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
							<div style={{ background: '#f0fdf4', border: '1px solid #dcfce7', borderRadius: 16, padding: 16 }}><b style={{ color: '#16a34a' }}>이런 점은 좋아요!</b>{renderTextList(result.strengths)}</div>
							<div style={{ background: '#fffbeb', border: '1px solid #fef3c7', borderRadius: 16, padding: 16 }}><b style={{ color: '#d97706' }}>이렇게 수정하면 더 좋아요!</b>{renderTextList(result.weaknesses)}</div>
							<div style={{ background: '#eff6ff', border: '1px solid #dbeafe', borderRadius: 16, padding: 16 }}><b style={{ color: '#2563eb' }}>이런 시도도 추천해요!</b>{renderTextList(result.recommendations)}</div>
						</div>
					</section>
				</>
			)}
		</div>
	);
	*/
}
