import React from 'react';
import axios from 'axios';
import { ShortsNarrationFitPanel } from './ShortsNarrationFitPanel';

type SkuOption = { sku_id: string; title?: string; product_url?: string; is_active?: boolean };
type AppealOption = { appeal_id: string; sku_id: string; label: string; safety_gate?: string };
type ArtifactOption = { artifact_id: string; sku_id: string; channel: string; title: string; created_at?: string | null; revision_no?: number };

type StageDetail = { id: string; label: string; purpose: string; product: boolean };
type StoryType = { id: string; label: string; purpose: string; stages: string[]; stageDetails: StageDetail[] };
type VisualTemplate = { id: string; label: string; description: string; motion: string[]; transition: string; subtitlePosition: string; preview: string };
type Voice = { voiceId: string; displayName: string; gender: string; ageStyle: string; tone: string; provider: string; providerVoiceId?: string; previewUrl?: string | null; cost?: string; commercialUse?: string };
type VoiceRole = 'PRIMARY' | 'SECONDARY' | 'RESERVE';
type VoiceProfile = { id: string; label: string; contentType: string; status: string; storyTypes: string[]; primary: string | null; secondary: string | null; reserve: string[] };
type FidelityResult = { status: string; transcription?: string; similarity?: number; reviewRequired: boolean; error?: string };
type SubtitleStyle = { id: string; label: string; color: string; stroke: string; background: string; highlightColor: string; fontWeight: number };
type MusicEligibility = { humanReviewStatus: string; commercialUseStatus: string; durationStatus: string; requiredDurationMs: number; excessMs: number | null; shortfallMs: number | null; eligible: boolean; blockedReasons: string[] };
type LibraryTrack = { musicId: string; title: string; moodTags?: string[]; durationMs?: number | null; url?: string | null; approvalStatus: string; usageCount?: number; termsMetadata?: { commercialUseStatus?: string }; eligibility?: MusicEligibility };
type NarrationStatus = 'PENDING_TTS' | 'READY' | 'STALE' | 'FAILED';
type NarrationPlanEntry = {
	sceneOrder: number;
	sceneId: string;
	status: NarrationStatus;
	audioAssetId?: string | null;
	url?: string | null;
	staleReasons?: string[];
	durationMs?: number | null;
	timingStatus: string;
	reviewRequired?: boolean;
	reviewCode?: string;
	targetDurationMs?: number | null;
	targetSceneDurationMs?: number | null;
	estimatedNarrationDurationMs?: number | null;
	actualNarrationDurationMs?: number | null;
	timingAuthority?: 'ACTUAL' | 'ESTIMATED' | 'NONE';
	estimationErrorMs?: number | null;
	budget?: { speechChars: number; preferredTextBudget: number | null; hardTextBudget: number | null; budgetStatus: string };
	provider?: string;
	fidelity?: FidelityResult | null;
};
type VoicePlan = { voiceId: string; displayName?: string | null; provider: string; profileId?: string | null; profileLabel?: string | null; profileRole?: VoiceRole | null; selectionSource: string; estimatorApplies: boolean; estimatorNote?: string | null };
type NarrationTimeline = {
	videoTargetDurationMs: number | null;
	reservedNonSpeechDurationMs: number;
	availableNarrationDurationMs: number | null;
	narrationActualTotalMs: number | null;
	narrationActualMeasuredMs: number;
	measuredScenes: number;
	narrationEstimatedTotalMs: number | null;
	narrationAuthorityTotalMs: number | null;
	totalTimingAuthority: string;
	totalTimingStatus: string;
	automaticTimingMutation: string;
};
type AudioPlan = {
	narration: NarrationPlanEntry[];
	narrationSummary: { scenes: number; ready: number; stale: number; pending: number; failed: number; timingReviewRequired: number; fidelityReviewRequired?: number };
	voice?: VoicePlan;
	timeline?: NarrationTimeline;
	estimator?: { estimatorVersion: string; profileId: string };
	music: { musicId: string | null; status: string; url: string | null; title: string | null; durationMs: number | null; approvalStatus: string | null; eligibility?: MusicEligibility | null };
	aiVoiceDisclosure: { aiGenerated: boolean; disclosureRequired: boolean };
};
type Option = { id: string; label: string; sample?: string; note?: string; enabled?: boolean };

type Registry = {
	version: string;
	contentSources: Option[];
	durations: number[];
	storyTypes: StoryType[];
	visualTemplates: VisualTemplate[];
	paces: Option[];
	narrationTones: Option[];
	voiceProvider: { provider: string; model: string; status: string; note: string };
	voices: Voice[];
	voiceProfiles?: VoiceProfile[];
	voiceProfileRoleLabels?: Record<VoiceRole, string>;
	musicProvider: { provider: string; model: string; status: string; note: string };
	musicMoods: Option[];
	subtitleStyles: SubtitleStyle[];
	highlightModes: Option[];
};

type ResolvedConfig = {
	mode: 'QUICK' | 'CUSTOM';
	duration: number;
	storyType: string;
	templateId: string;
	pace: string;
	voice: { voiceId: string; style: string; provider?: string; profileId?: string | null; profileRole?: VoiceRole | null; selectionSource?: string };
	narrationTone: string;
	music: { enabled: boolean; mood: string | null; trackId: string | null; volume: number; ducking: boolean };
	subtitle: { enabled: boolean; styleId: string; highlightMode: string; keywordHighlight: boolean };
};

type ShortsConfig = { version: string; selected: Record<string, any>; resolved: ResolvedConfig; aiRecommended: string[]; musicSelectionBlocked?: { trackId: string; blockedReasons: string[] } };
type ScenePlanScene = { order: number; stage: string; stageLabel: string; purpose: string; startSec: number; endSec: number; durationSec: number; productLocked: boolean; spokenCharsTarget: number };
type RenderScene = {
	order: number;
	stage: string;
	stageLabel?: string;
	startSec: number;
	endSec: number;
	durationSec: number;
	motion: string;
	transitionIn: string;
	layers: Array<{ type: string; source: string; url?: string | null; locked?: boolean }>;
	subtitle: { enabled: boolean; text: string; styleId: string; highlightMode: string; highlights: string[]; position: string };
	voice: { voiceId: string; text: string; status: string; url?: string | null };
};
type PlanResponse = {
	config: ShortsConfig;
	scene_plan: { storyLabel: string; totalDurationSec: number; scenes: ScenePlanScene[] };
	render_plan: { status: string; templateId: string; totalDurationSec: number; scenes: RenderScene[]; music: { enabled: boolean; mood: string | null; trackId: string | null; status: string }; audioPlan: AudioPlan; productLockedAsset: { url: string | null; rule: string } };
	estimate: {
		writerCalls: number;
		imageCalls: number;
		ttsCalls: number;
		musicCalls: number;
		renderJobs: number;
		note: string;
		audio: { narrationCalls: number; narrationReused: number; musicStatus: string; musicCalls: number; newBgmCalls: number; note: string };
	};
	music_track?: LibraryTrack | null;
	music_recommendation?: LibraryTrack | null;
	claim_grounding?: {
		status: string;
		scenesWithClaims: number;
		scenes: number;
		contentGroundingStatus: string;
		catalogAuthority?: string | null;
		totals?: Record<string, number>;
		riskCounts?: Record<string, number>;
		narrationFitGate?: { eligible: boolean; readiness?: string; blockers: string[]; unresolved: number };
		perScene?: Array<{
			order: number;
			stage?: string;
			status: string;
			uncoveredFields?: string[];
			claims: Array<{ claimId: string; claimType: string; field: string; claimText: string; evidenceRefs: string[]; groundingStatus: string; reasons: string[] }>;
		}>;
	};
};

const CLAIM_GROUNDING_LABEL: Record<string, string> = {
	LEGACY_CLAIM_GROUNDING_MISSING: '장면별 근거 미연결 (기존 숏츠)',
	TRACEABILITY_INCOMPLETE: '일부 장면 근거 미연결',
	TRACEABLE: '장면별 근거 연결됨',
};

const CLAIM_STATUS_LABEL: Record<string, string> = {
	GROUNDED: '확인 완료',
	EDITORIAL: '연결 문장',
	UNRESOLVED: '확인 필요',
	UNSUPPORTED: '근거 없음',
	INVALID_REF: '잘못된 참조',
};

const CLAIM_FIELD_LABEL: Record<string, string> = { voice_over: '나레이션', subtitle: '자막', on_screen_text: '화면 문구', cta: 'CTA' };

const CLAIM_RISK_LABEL: Record<string, string> = {
	REVIEW_GENERALIZATION_OVERREACH: '리뷰 다수 표현',
	EFFICACY_SENSITIVE_REVIEW_REQUIRED: '민감 효능 리뷰',
	ATTRIBUTION_MISSING: '출처 표시 누락',
};

function claimRiskSummary(riskCounts?: Record<string, number>): string {
	const parts = Object.keys(CLAIM_RISK_LABEL).filter((k) => riskCounts?.[k]).map((k) => `${CLAIM_RISK_LABEL[k]} ${riskCounts?.[k]}`);
	return parts.length ? `근거 확인 필요: ${parts.join(' / ')}` : '';
}

function ClaimGroundingDetails({ grounding }: { grounding: NonNullable<PlanResponse['claim_grounding']> }) {
	if (!grounding.perScene?.length) return null;
	return (
		<details style={{ fontSize: 11 }} data-testid="shorts-claim-grounding-details">
			<summary style={{ cursor: 'pointer', color: '#475569', fontWeight: 700 }}>
				장면별 근거 상세 · {grounding.catalogAuthority === 'GENERATION_TIME_EVIDENCE_SNAPSHOT' ? '생성 시점 근거 기준' : '생성 시점 근거 없음'}
				{grounding.narrationFitGate ? ` · 대사 축약 진입 ${grounding.narrationFitGate.eligible ? '가능' : '불가 (근거 확인 보류)'}` : ''}
			</summary>
			<div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
				{grounding.perScene.map((scene) => (
					<div key={scene.order} style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 6 }}>
						<div style={{ fontWeight: 800 }}>
							Scene {scene.order} {scene.stage || ''}
							{scene.uncoveredFields?.length ? ` · 근거 미표시 필드: ${scene.uncoveredFields.map((f) => CLAIM_FIELD_LABEL[f] || f).join(', ')}` : ''}
						</div>
						{scene.claims.map((claim) => (
							<div key={claim.claimId} style={{ display: 'grid', gridTemplateColumns: '70px 60px minmax(0,1fr)', gap: 6, color: claim.groundingStatus === 'GROUNDED' || claim.groundingStatus === 'EDITORIAL' ? '#334155' : '#b45309' }}>
								<span style={{ fontWeight: 800 }}>{CLAIM_STATUS_LABEL[claim.groundingStatus] || claim.groundingStatus}</span>
								<span>{CLAIM_FIELD_LABEL[claim.field] || claim.field}</span>
								<span>
									{claim.claimText}
									{claim.evidenceRefs.length ? <span style={{ color: '#64748b' }}> · {claim.evidenceRefs.join(', ')}</span> : null}
									{claim.reasons.length ? <span style={{ color: '#b45309' }}> · {claim.reasons.map((r) => CLAIM_RISK_LABEL[r] || r).join(', ')}</span> : null}
								</span>
							</div>
						))}
					</div>
				))}
			</div>
		</details>
	);
}

const AUTO = 'AUTO';

const ui: Record<string, React.CSSProperties> = {
	card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, boxShadow: '0 1px 2px rgba(15,23,42,0.05)', padding: 16 },
	label: { display: 'grid', gap: 6, fontSize: 12, fontWeight: 900, color: '#475569' },
	input: { border: '1px solid #cbd5e1', borderRadius: 12, padding: '10px 12px', fontWeight: 800 },
	button: { border: '1px solid #cbd5e1', background: '#fff', color: '#334155', borderRadius: 10, padding: '8px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer' },
	primary: { border: '1px solid #2563eb', background: '#2563eb', color: '#fff', borderRadius: 10, padding: '10px 14px', fontSize: 13, fontWeight: 900, cursor: 'pointer' },
	disabled: { border: '1px solid #e2e8f0', background: '#f8fafc', color: '#94a3b8', borderRadius: 10, padding: '8px 12px', fontSize: 12, fontWeight: 800, cursor: 'not-allowed' },
	muted: { color: '#64748b', fontSize: 12 },
};

const PREVIEW_KEYFRAMES = `
@keyframes shortsZoomIn { from { transform: scale(1); } to { transform: scale(1.18); } }
@keyframes shortsZoomOut { from { transform: scale(1.18); } to { transform: scale(1); } }
@keyframes shortsPanLeft { from { transform: scale(1.15) translateX(6%); } to { transform: scale(1.15) translateX(-6%); } }
@keyframes shortsPanRight { from { transform: scale(1.15) translateX(-6%); } to { transform: scale(1.15) translateX(6%); } }
@keyframes shortsPanUp { from { transform: scale(1.15) translateY(6%); } to { transform: scale(1.15) translateY(-6%); } }
@keyframes shortsSlideUp { from { transform: translateY(30%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
@keyframes shortsFade { from { opacity: 0; } to { opacity: 1; } }
`;

function motionAnimation(motion: string, seconds: number): string {
	const name =
		motion === 'zoom_out' ? 'shortsZoomOut'
			: motion === 'pan_left' ? 'shortsPanLeft'
				: motion === 'pan_right' ? 'shortsPanRight'
					: motion === 'pan_up' ? 'shortsPanUp'
						: motion === 'slide_up' ? 'shortsSlideUp'
							: 'shortsZoomIn';
	const duration = motion === 'zoom_in_slow' ? seconds * 1.6 : seconds;
	return `${name} ${Math.max(1, duration)}s ease-out forwards`;
}

const PREVIEW_BACKGROUNDS: Record<string, string> = {
	dynamic: 'linear-gradient(160deg,#0f172a,#7c3aed 55%,#f43f5e)',
	magazine: 'linear-gradient(180deg,#f5f5f4,#e7e5e4 60%,#a8a29e)',
	clean: 'linear-gradient(180deg,#f8fafc,#e0f2fe 70%,#bae6fd)',
	review: 'linear-gradient(180deg,#fff7ed,#fed7aa 60%,#fb923c)',
};

function SubtitleText({ text, style, highlights, size = 15 }: { text: string; style?: SubtitleStyle; highlights?: string[]; size?: number }): JSX.Element {
	const s = style || { color: '#fff', stroke: 'none', background: 'none', highlightColor: '#facc15', fontWeight: 800 } as SubtitleStyle;
	const parts: Array<{ text: string; hit: boolean }> = [];
	const keys = (highlights || []).filter(Boolean);
	let rest = text;
	while (rest) {
		const hits = keys.map((key) => ({ key, idx: rest.indexOf(key) })).filter((x) => x.idx >= 0).sort((a, b) => a.idx - b.idx);
		const first = hits[0];
		if (!first) {
			parts.push({ text: rest, hit: false });
			break;
		}
		if (first.idx > 0) parts.push({ text: rest.slice(0, first.idx), hit: false });
		parts.push({ text: first.key, hit: true });
		rest = rest.slice(first.idx + first.key.length);
	}
	const shadow = s.stroke && s.stroke !== 'none' ? `-1px -1px 0 ${s.stroke}, 1px -1px 0 ${s.stroke}, -1px 1px 0 ${s.stroke}, 1px 1px 0 ${s.stroke}, 0 2px 4px rgba(0,0,0,0.35)` : '0 1px 3px rgba(0,0,0,0.35)';
	return (
		<span style={{ display: 'inline', background: s.background !== 'none' ? s.background : 'transparent', color: s.color, fontWeight: s.fontWeight, fontSize: size, lineHeight: 1.45, padding: s.background !== 'none' ? '2px 6px' : 0, borderRadius: 6, textShadow: shadow, boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone' }}>
			{parts.map((part, idx) => <span key={idx} style={part.hit ? { color: s.highlightColor } : undefined}>{part.text}</span>)}
		</span>
	);
}

function TemplatePreview({ template, active }: { template: VisualTemplate; active: boolean }): JSX.Element {
	const [tick, setTick] = React.useState(0);
	React.useEffect(() => {
		const timer = window.setInterval(() => setTick((value) => value + 1), 2200);
		return () => window.clearInterval(timer);
	}, []);
	const motion = template.motion[tick % template.motion.length] || 'zoom_in';
	return (
		<div style={{ position: 'relative', aspectRatio: '9 / 16', borderRadius: 10, overflow: 'hidden', background: '#0f172a', border: active ? '2px solid #2563eb' : '1px solid #e2e8f0' }}>
			<div key={tick} style={{ position: 'absolute', inset: 0, background: PREVIEW_BACKGROUNDS[template.preview] || PREVIEW_BACKGROUNDS.dynamic, animation: motionAnimation(motion, 2.2) }} />
			{template.preview === 'review' ? (
				<div key={`card-${tick}`} style={{ position: 'absolute', left: '10%', right: '10%', top: '30%', background: '#fff', borderRadius: 8, padding: 6, fontSize: 9, fontWeight: 800, color: '#7c2d12', animation: 'shortsSlideUp 0.6s ease-out' }}>★★★★★ 재구매 의사 있어요</div>
			) : null}
			{template.preview === 'magazine' ? <div style={{ position: 'absolute', left: 8, top: 10, fontSize: 13, fontWeight: 950, color: '#1c1917', letterSpacing: -0.5 }}>ISSUE<br />HAIR</div> : null}
			{template.preview === 'clean' ? <div style={{ position: 'absolute', left: '32%', right: '32%', top: '34%', bottom: '30%', borderRadius: 8, background: 'linear-gradient(180deg,#a3e635,#4d7c0f)', boxShadow: '0 6px 14px rgba(0,0,0,0.2)' }} /> : null}
			<div style={{ position: 'absolute', left: 6, right: 6, bottom: 10, textAlign: 'center', fontSize: 9, fontWeight: 900, color: template.preview === 'magazine' || template.preview === 'clean' ? '#0f172a' : '#fff' }}>{template.label}</div>
		</div>
	);
}

function ChoiceButton({ active, onClick, children, disabled, title }: { active: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean; title?: string }): JSX.Element {
	return (
		<button type="button" title={title} disabled={disabled} onClick={onClick} style={{ textAlign: 'left', border: active ? '2px solid #2563eb' : '1px solid #e2e8f0', background: disabled ? '#f8fafc' : active ? '#eff6ff' : '#fff', color: disabled ? '#94a3b8' : '#0f172a', borderRadius: 12, padding: '9px 11px', fontSize: 12, fontWeight: 850, cursor: disabled ? 'not-allowed' : 'pointer', minWidth: 0 }}>
			{children}
		</button>
	);
}

function AiChoice({ active, onClick, recommended }: { active: boolean; onClick: () => void; recommended?: string }): JSX.Element {
	return (
		<ChoiceButton active={active} onClick={onClick}>
			<div style={{ color: '#7c3aed', fontWeight: 950 }}>✨ AI 추천</div>
			{recommended ? <div style={{ color: '#64748b', fontSize: 11, marginTop: 3 }}>{recommended}</div> : null}
		</ChoiceButton>
	);
}

function Section({ no, title, help, children, right }: { no: string; title: string; help?: string; children: React.ReactNode; right?: React.ReactNode }): JSX.Element {
	return (
		<section style={{ ...ui.card, display: 'grid', gap: 12 }}>
			<div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
				<div>
					<div style={{ fontWeight: 950, fontSize: 15 }}>{no} {title}</div>
					{help ? <div style={{ ...ui.muted, marginTop: 3 }}>{help}</div> : null}
				</div>
				{right}
			</div>
			{children}
		</section>
	);
}

function grid(min: number): React.CSSProperties {
	return { display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`, gap: 8 };
}

function errorMessage(error: unknown): string {
	const anyError = error as any;
	const detail = anyError?.response?.data?.detail;
	if (typeof detail === 'string') return detail;
	if (detail) return JSON.stringify(detail);
	return String(anyError?.message || '요청에 실패했습니다.');
}

let sharedAudio: HTMLAudioElement | null = null;

function playAudio(baseUrl: string, url: string): Promise<void> {
	sharedAudio?.pause();
	sharedAudio = new Audio(/^https?:/.test(url) ? url : `${baseUrl}${url}`);
	return sharedAudio.play();
}

function stopAudio(): void {
	sharedAudio?.pause();
	sharedAudio = null;
}

async function playSequence(baseUrl: string, urls: string[], onScene: (index: number) => void): Promise<void> {
	for (let index = 0; index < urls.length; index += 1) {
		onScene(index);
		const url = urls[index] || '';
		const audio = new Audio(/^https?:/.test(url) ? url : `${baseUrl}${url}`);
		sharedAudio?.pause();
		sharedAudio = audio;
		await new Promise<void>((resolve, reject) => {
			audio.onended = () => resolve();
			audio.onerror = () => reject(new Error('play_failed'));
			audio.onpause = () => { if (!audio.ended) reject(new Error('stopped')); };
			audio.play().catch(reject);
		});
	}
}

const DEFAULT_ROLE_LABELS: Record<VoiceRole, string> = { PRIMARY: '기본 추천', SECONDARY: '대체', RESERVE: '예비' };

function providerLabel(provider?: string): string {
	return String(provider || '').toUpperCase() === 'GEMINI' ? 'Gemini' : 'OpenAI';
}

function profileForStory(profiles: VoiceProfile[] | undefined, storyType?: string): VoiceProfile | undefined {
	return (profiles || []).find((profile) => profile.status === 'HUMAN_SELECTED_VOICE_PROFILE' && Boolean(storyType) && profile.storyTypes.includes(String(storyType)));
}

function profileRole(profile: VoiceProfile | undefined, voiceId: string): VoiceRole | null {
	if (!profile) return null;
	if (profile.primary === voiceId) return 'PRIMARY';
	if (profile.secondary === voiceId) return 'SECONDARY';
	return profile.reserve.includes(voiceId) ? 'RESERVE' : null;
}

function profileVoiceIds(profile: VoiceProfile): string[] {
	return [profile.primary, profile.secondary, ...profile.reserve].filter((id): id is string => Boolean(id));
}

const FIDELITY_LABEL: Record<string, string> = {
	EXACT: '대본 일치',
	NORMALIZED_MATCH: '대본 일치',
	MINOR_PRONUNCIATION_VARIATION: '발음 확인 권장',
	TEXT_MUTATION: '대본 차이 · 검수 필요',
	HALLUCINATED_CONTENT: '대본 불일치 · 검수 필요',
	NO_SPEECH: '음성 없음 · 검수 필요',
	TRANSCRIPTION_FAILED: '받아쓰기 실패 · 직접 청취 필요',
};

function formatSec(ms?: number | null): string {
	return typeof ms === 'number' && ms > 0 ? `${(ms / 1000).toFixed(1)}초` : '-';
}

function useMusicLibrary(baseUrl: string, requiredSec = 30): { tracks: LibraryTrack[]; error: string; reload: () => Promise<void> } {
	const [tracks, setTracks] = React.useState<LibraryTrack[]>([]);
	const [error, setError] = React.useState('');
	const reload = React.useCallback(async () => {
		try {
			const response = await axios.get<{ items?: LibraryTrack[] }>(`${baseUrl}/content/shorts/music`, { params: { required_duration_sec: requiredSec } });
			setTracks(response.data.items || []);
			setError('');
		} catch (err) {
			setError(errorMessage(err));
		}
	}, [baseUrl, requiredSec]);
	React.useEffect(() => { void reload(); }, [reload]);
	return { tracks, error, reload };
}

const APPROVAL_LABEL: Record<string, string> = { APPROVED: '승인됨', GENERATED: '검수 대기', REJECTED: '반려', DISABLED: '사용 중지' };
const COMMERCIAL_LABEL: Record<string, string> = { UNVERIFIED: '확인 필요', VERIFIED_ALLOWED: '허용', VERIFIED_RESTRICTED: '제한', NOT_ALLOWED: '불가' };
const MUSIC_DURATION_LABEL: Record<string, string> = { MUSIC_DURATION_FIT: '길이 맞음', MUSIC_LONG_ENOUGH: '길이 충분', MUSIC_EXTENSION_REQUIRED: '연장 필요', MUSIC_DURATION_UNKNOWN: '길이 미확인' };
const SMALL_BUTTON: React.CSSProperties = { ...ui.button, padding: '4px 8px', fontSize: 11 };

function MusicStatusLines({ track }: { track: LibraryTrack }): JSX.Element {
	const e = track.eligibility;
	const commercial = e?.commercialUseStatus || track.termsMetadata?.commercialUseStatus || 'UNVERIFIED';
	const tone = (ok: boolean) => ({ color: ok ? '#047857' : '#b45309', fontWeight: 900 });
	return (
		<div style={{ fontSize: 11, color: '#64748b', display: 'grid', gap: 1 }} data-testid="shorts-music-status">
			<span>음질 검수: <span style={tone(track.approvalStatus === 'APPROVED')}>{APPROVAL_LABEL[track.approvalStatus] || track.approvalStatus}</span></span>
			<span>사용 조건: <span style={tone(commercial === 'VERIFIED_ALLOWED')}>{COMMERCIAL_LABEL[commercial] || commercial}</span></span>
			<span>길이: {formatSec(track.durationMs)}{e ? <> · <span style={tone(e.durationStatus === 'MUSIC_DURATION_FIT' || e.durationStatus === 'MUSIC_LONG_ENOUGH')}>{MUSIC_DURATION_LABEL[e.durationStatus] || e.durationStatus}</span></> : null}</span>
		</div>
	);
}

function musicBlockNote(track: LibraryTrack): string {
	const reasons = track.eligibility?.blockedReasons || [];
	if (reasons.some((r) => r.startsWith('HUMAN_REVIEW_'))) return '음질 검수 승인 필요';
	if (reasons.some((r) => r.startsWith('COMMERCIAL_USE_'))) return '음원 사용 조건 확인 필요';
	if (reasons.includes('MUSIC_EXTENSION_REQUIRED')) return '영상보다 짧아 연장 필요';
	return reasons.length ? '사용 불가' : '';
}

function MusicLibrary({
	baseUrl,
	tracks,
	moods,
	moodFilter,
	selectedId,
	onSelect,
	onChanged,
}: {
	baseUrl: string;
	tracks: LibraryTrack[];
	moods: Option[];
	moodFilter: string | null;
	selectedId: string | null;
	onSelect: (track: LibraryTrack) => void;
	onChanged: () => Promise<void>;
}): JSX.Element {
	const [showAll, setShowAll] = React.useState(false);
	const [busy, setBusy] = React.useState('');
	const [note, setNote] = React.useState('');
	const [creating, setCreating] = React.useState(false);
	const [newMood, setNewMood] = React.useState(moodFilter || moods[0]?.id || 'CALM');
	const [prompt, setPrompt] = React.useState<{ prompt: string; expectedDurationSec: number; variant: number } | null>(null);
	const moodLabel = (id: string) => moods.find((mood) => mood.id === id)?.label || id;
	const selectable = tracks.filter((track) => (track.approvalStatus === 'APPROVED' || track.approvalStatus === 'GENERATED') && track.url && (!moodFilter || (track.moodTags || []).includes(moodFilter)));
	const visible = showAll ? selectable : selectable.slice(0, 6);
	const nextVariant = (mood: string) => tracks.filter((track) => (track.moodTags || []).includes(mood)).length + 1;

	const play = (track: LibraryTrack) => {
		if (track.url) playAudio(baseUrl, track.url).catch(() => setNote('음악을 재생하지 못했습니다.'));
	};
	const review = async (track: LibraryTrack, status: 'APPROVED' | 'REJECTED') => {
		setBusy(track.musicId);
		try {
			await axios.post(`${baseUrl}/content/shorts/music/${track.musicId}/review`, { status, actor: 'shorts_ui' });
			await onChanged();
			setNote(`'${track.title}' ${APPROVAL_LABEL[status]} 처리했습니다.`);
		} catch (err) {
			setNote(errorMessage(err));
		} finally {
			setBusy('');
		}
	};
	const loadPrompt = async (mood: string) => {
		setNewMood(mood);
		try {
			const variant = nextVariant(mood);
			const response = await axios.post<{ preview: { prompt: string; expectedDurationSec: number } }>(`${baseUrl}/content/shorts/music/prompt-preview`, { mood, variant });
			setPrompt({ ...response.data.preview, variant });
		} catch (err) {
			setNote(errorMessage(err));
		}
	};
	const create = async () => {
		if (!prompt) return;
		if (!window.confirm(`새 BGM 1곡을 만듭니다.\nAI 음악 생성(Gemini) 1회 호출 · 약 ${prompt.expectedDurationSec}초 · 보컬 없음\n만든 곡은 '검수 대기'로 저장되며, 음질 승인과 음원 사용 조건 확인이 모두 끝나기 전에는 숏츠에 쓰이지 않습니다.\n진행할까요?`)) return;
		setBusy('NEW');
		try {
			const response = await axios.post<{ item: LibraryTrack }>(`${baseUrl}/content/shorts/music/generate`, { mood: newMood, variant: prompt.variant, actor: 'shorts_ui' });
			await onChanged();
			setCreating(false);
			setPrompt(null);
			setNote(`새 BGM '${response.data.item.title}'을 저장했습니다. 들어보고 승인 또는 반려하세요.`);
		} catch (err) {
			setNote(errorMessage(err));
		} finally {
			setBusy('');
		}
	};

	return (
		<div style={{ display: 'grid', gap: 8 }} data-testid="shorts-music-library">
			{visible.length ? (
				<div style={grid(230)}>
					{visible.map((track) => (
						<div key={track.musicId} style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr)', gap: 6, alignItems: 'center', border: selectedId === track.musicId ? '2px solid #2563eb' : '1px solid #e2e8f0', background: selectedId === track.musicId ? '#eff6ff' : '#fff', borderRadius: 12, padding: 8 }}>
							<button type="button" style={SMALL_BUTTON} onClick={() => play(track)} title="미리듣기">▶</button>
							<button
								type="button"
								disabled={!track.eligibility?.eligible}
								title={track.eligibility?.eligible ? '이 곡 사용' : musicBlockNote(track)}
								onClick={() => onSelect(track)}
								style={{ border: 'none', background: 'transparent', textAlign: 'left', cursor: track.eligibility?.eligible ? 'pointer' : 'default', padding: 0, minWidth: 0 }}
							>
								<div style={{ fontSize: 12, fontWeight: 900, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.title}</div>
								<div style={{ fontSize: 11, color: '#64748b' }}>{(track.moodTags || []).map(moodLabel).join(', ')}</div>
								<MusicStatusLines track={track} />
								{!track.eligibility?.eligible ? <div style={{ fontSize: 11, fontWeight: 900, color: '#b45309' }}>선택 불가 · {musicBlockNote(track)}</div> : null}
							</button>
							{track.approvalStatus === 'GENERATED' ? (
								<div style={{ gridColumn: '1 / -1', display: 'flex', gap: 6 }}>
									<button type="button" style={SMALL_BUTTON} disabled={busy === track.musicId} onClick={() => void review(track, 'APPROVED')}>승인</button>
									<button type="button" style={SMALL_BUTTON} disabled={busy === track.musicId} onClick={() => void review(track, 'REJECTED')}>반려</button>
								</div>
							) : null}
						</div>
					))}
				</div>
			) : (
				<div style={{ ...ui.muted, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: 10 }}>
					{moodFilter ? `'${moodLabel(moodFilter)}' 분위기의 음악이 라이브러리에 없습니다.` : '음악 라이브러리가 비어 있습니다.'} 곡이 없으면 음악은 ‘곡 배정 대기’로 남고 자동 생성하지 않습니다.
				</div>
			)}
			<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
				{selectable.length > 6 ? <button type="button" style={SMALL_BUTTON} onClick={() => setShowAll((value) => !value)}>{showAll ? '접기' : `전체 음악 보기 (${selectable.length})`}</button> : null}
				<button type="button" style={SMALL_BUTTON} onClick={() => { setCreating((value) => !value); if (!creating) void loadPrompt(moodFilter || newMood); }}>+ 새 BGM 만들기</button>
				{note ? <span style={{ fontSize: 11, fontWeight: 800, color: '#475569' }}>{note}</span> : null}
			</div>
			{creating ? (
				<div style={{ display: 'grid', gap: 8, border: '1px dashed #cbd5e1', borderRadius: 12, padding: 10, background: '#f8fafc' }}>
					<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
						{moods.map((mood) => <button key={mood.id} type="button" style={newMood === mood.id ? { ...ui.primary, padding: '4px 8px', fontSize: 11 } : SMALL_BUTTON} onClick={() => void loadPrompt(mood.id)}>{mood.label}</button>)}
					</div>
					<div style={{ fontSize: 11, color: '#475569', lineHeight: 1.5 }}>
						<strong>생성 프롬프트 미리보기</strong>
						<div style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', marginTop: 4 }}>{prompt?.prompt || '불러오는 중...'}</div>
					</div>
					<div style={{ display: 'flex', gap: 6 }}>
						<button type="button" style={busy === 'NEW' || !prompt ? ui.disabled : ui.primary} disabled={busy === 'NEW' || !prompt} onClick={() => void create()}>{busy === 'NEW' ? 'BGM 생성 중... (최대 1~2분)' : '이 프롬프트로 1곡 만들기 (1회 호출)'}</button>
						<button type="button" style={ui.button} onClick={() => { setCreating(false); setPrompt(null); }}>취소</button>
					</div>
				</div>
			) : null}
		</div>
	);
}

export type ShortsInitialSource = { sourceType: 'APPEAL' | 'ARTIFACT' | 'TOPIC'; skuId?: string; appealId?: string; artifactId?: string };

export function ShortsGeneratorView({
	apiBaseUrl,
	initialSource,
	skus,
	appeals,
	artifacts,
	reload,
	onCreated,
}: {
	apiBaseUrl?: string;
	initialSource?: ShortsInitialSource;
	skus: SkuOption[];
	appeals: AppealOption[];
	artifacts: ArtifactOption[];
	reload: () => Promise<void>;
	onCreated: (artifactId: string) => void;
}): JSX.Element {
	const baseUrl = apiBaseUrl || 'http://localhost:5189';
	const activeSkus = React.useMemo(() => skus.filter((item) => item.is_active !== false), [skus]);
	const [registry, setRegistry] = React.useState<Registry | null>(null);
	const [registryError, setRegistryError] = React.useState('');
	const [mode, setMode] = React.useState<'QUICK' | 'CUSTOM'>('QUICK');
	const [sourceType, setSourceType] = React.useState<'ARTIFACT' | 'APPEAL' | 'TOPIC'>(initialSource?.sourceType || 'APPEAL');
	const [skuId, setSkuId] = React.useState(initialSource?.skuId || '');
	const [appealId, setAppealId] = React.useState(initialSource?.appealId || '');
	const [sourceArtifactId, setSourceArtifactId] = React.useState(initialSource?.artifactId || '');
	const [topicTitle, setTopicTitle] = React.useState('');
	const [additionalContext, setAdditionalContext] = React.useState('');
	const [files, setFiles] = React.useState<FileList | null>(null);
	const [uploadedAssets, setUploadedAssets] = React.useState<Array<{ asset_id: string; original_filename?: string | null; filename: string }>>([]);
	const [uploading, setUploading] = React.useState(false);
	const [duration, setDuration] = React.useState<string>(AUTO);
	const [storyType, setStoryType] = React.useState(AUTO);
	const [templateId, setTemplateId] = React.useState(AUTO);
	const [pace, setPace] = React.useState(AUTO);
	const [voiceId, setVoiceId] = React.useState(AUTO);
	const [voiceGender, setVoiceGender] = React.useState('');
	const [voiceAge, setVoiceAge] = React.useState('');
	const [narrationTone, setNarrationTone] = React.useState(AUTO);
	const [musicMood, setMusicMood] = React.useState(AUTO);
	const [musicTrackId, setMusicTrackId] = React.useState(AUTO);
	const musicLibrary = useMusicLibrary(baseUrl, duration === AUTO ? 30 : Number(duration) || 30);
	const [voicePreviews, setVoicePreviews] = React.useState<Record<string, string | null>>({});
	const [voicePreviewErrors, setVoicePreviewErrors] = React.useState<Record<string, string>>({});
	const [voicePreviewBusy, setVoicePreviewBusy] = React.useState('');
	const [subtitleEnabled, setSubtitleEnabled] = React.useState(true);
	const [subtitleStyleId, setSubtitleStyleId] = React.useState(AUTO);
	const [highlightMode, setHighlightMode] = React.useState(AUTO);
	const [plan, setPlan] = React.useState<PlanResponse | null>(null);
	const [planError, setPlanError] = React.useState('');
	const [generating, setGenerating] = React.useState(false);
	const [message, setMessage] = React.useState('');
	const [previewIndex, setPreviewIndex] = React.useState(0);

	React.useEffect(() => {
		let alive = true;
		axios.get<{ registry: Registry }>(`${baseUrl}/content/shorts/registry`)
			.then((response) => { if (alive) setRegistry(response.data.registry); })
			.catch((error) => { if (alive) setRegistryError(errorMessage(error)); });
		axios.get<{ voices: Voice[] }>(`${baseUrl}/content/shorts/voices`)
			.then((response) => { if (alive) setVoicePreviews(Object.fromEntries((response.data.voices || []).map((voice) => [voice.voiceId, voice.previewUrl || null]))); })
			.catch(() => undefined);
		return () => { alive = false; };
	}, [baseUrl]);

	React.useEffect(() => {
		if (!skuId && activeSkus[0]?.sku_id) setSkuId(activeSkus[0].sku_id);
	}, [activeSkus, skuId]);

	const skuAppeals = React.useMemo(() => appeals.filter((item) => item.sku_id === skuId && item.safety_gate !== 'HOLD'), [appeals, skuId]);
	const sourceArtifacts = React.useMemo(() => artifacts.filter((item) => ['blog', 'instagram', 'shorts'].includes(String(item.channel || '').toLowerCase())), [artifacts]);
	const sourceArtifact = sourceArtifacts.find((item) => item.artifact_id === sourceArtifactId) || null;
	const effectiveSkuId = sourceType === 'ARTIFACT' ? sourceArtifact?.sku_id || '' : skuId;

	React.useEffect(() => {
		if (!appeals.length) return;
		if (sourceType === 'APPEAL' && appealId && !skuAppeals.some((item) => item.appeal_id === appealId)) setAppealId('');
	}, [appealId, appeals.length, skuAppeals, sourceType]);

	const config = React.useMemo(() => ({
		mode,
		duration: duration === AUTO ? null : Number(duration),
		aspectRatio: '9:16',
		storyType,
		templateId,
		pace,
		voice: { voiceId },
		narrationTone,
		music: { mood: musicMood, trackId: musicTrackId === AUTO ? null : musicTrackId, volume: 0.18, ducking: true },
		subtitle: { enabled: subtitleEnabled, styleId: subtitleStyleId, highlightMode },
	}), [mode, duration, storyType, templateId, pace, voiceId, narrationTone, musicMood, musicTrackId, subtitleEnabled, subtitleStyleId, highlightMode]);

	React.useEffect(() => {
		const timer = window.setTimeout(() => {
			axios.post<PlanResponse>(`${baseUrl}/content/shorts/plan`, {
				sku_id: effectiveSkuId || null,
				source_type: sourceType,
				appeal_id: sourceType === 'APPEAL' ? appealId || null : null,
				source_artifact_id: sourceType === 'ARTIFACT' ? sourceArtifactId || null : null,
				topic_title: sourceType === 'TOPIC' ? topicTitle : null,
				config,
			})
				.then((response) => { setPlan(response.data); setPlanError(''); setPreviewIndex(0); })
				.catch((error) => setPlanError(errorMessage(error)));
		}, 300);
		return () => window.clearTimeout(timer);
	}, [baseUrl, config, effectiveSkuId, sourceType, appealId, sourceArtifactId, topicTitle, musicLibrary.tracks]);

	const scenePlan = plan?.scene_plan.scenes || [];
	React.useEffect(() => {
		if (!scenePlan.length) return undefined;
		const current = scenePlan[previewIndex % scenePlan.length];
		const timer = window.setTimeout(() => setPreviewIndex((value) => (value + 1) % scenePlan.length), Math.max(1200, (current?.durationSec || 3) * 450));
		return () => window.clearTimeout(timer);
	}, [previewIndex, scenePlan]);

	const resolved = plan?.config.resolved;
	const aiFields = new Set(plan?.config.aiRecommended || []);
	const storyById = new Map((registry?.storyTypes || []).map((item) => [item.id, item]));
	const templateById = new Map((registry?.visualTemplates || []).map((item) => [item.id, item]));
	const voiceById = new Map((registry?.voices || []).map((item) => [item.voiceId, item]));
	const toneById = new Map((registry?.narrationTones || []).map((item) => [item.id, item]));
	const moodById = new Map((registry?.musicMoods || []).map((item) => [item.id, item]));
	const subtitleById = new Map((registry?.subtitleStyles || []).map((item) => [item.id, item]));
	const highlightById = new Map((registry?.highlightModes || []).map((item) => [item.id, item]));
	const paceById = new Map((registry?.paces || []).map((item) => [item.id, item]));
	const resolvedVoice = resolved ? voiceById.get(resolved.voice.voiceId) : undefined;
	const resolvedTemplate = resolved ? templateById.get(resolved.templateId) : undefined;
	const resolvedSubtitle = resolved ? subtitleById.get(resolved.subtitle.styleId) : undefined;
	const resolvedTone = resolved ? toneById.get(resolved.narrationTone) : undefined;
	const voiceLabel = (voice?: Voice) => voice ? `${voice.gender === 'female' ? '여성' : '남성'} / ${voice.ageStyle} / ${voice.tone} (${voice.displayName})` : '-';
	const recommend = (field: string, label?: string) => (aiFields.has(field) && label ? label : undefined);
	const custom = mode === 'CUSTOM';

	const voiceProfile = profileForStory(registry?.voiceProfiles, resolved?.storyType);
	const roleLabels = registry?.voiceProfileRoleLabels || DEFAULT_ROLE_LABELS;
	const filteredVoices = (registry?.voices || []).filter((voice) => (!voiceGender || voice.gender === voiceGender) && (!voiceAge || voice.ageStyle.includes(voiceAge)));
	const libraryMoodFilter = musicMood === AUTO ? resolved?.music.mood || null : musicMood === 'NONE' ? null : musicMood;
	const resolvedTrack = musicLibrary.tracks.find((track) => track.musicId === resolved?.music.trackId) || null;

	const previewVoice = async (voice: Voice) => {
		setVoicePreviewErrors((prev) => ({ ...prev, [voice.voiceId]: '' }));
		try {
			const existing = voicePreviews[voice.voiceId];
			if (existing) {
				await playAudio(baseUrl, existing);
				return;
			}
			if (!window.confirm(`'${voice.displayName}' 미리듣기 음성이 아직 없습니다.\n고정 안내 문장으로 한 번만 만들고(${providerLabel(voice.provider)} TTS 1회) 저장해, 다음부터는 저장된 파일을 재생합니다.\n진행할까요?`)) return;
			setVoicePreviewBusy(voice.voiceId);
			const response = await axios.post<{ item: { url: string } }>(`${baseUrl}/content/shorts/voices/${voice.voiceId}/preview`);
			const url = response.data.item.url;
			setVoicePreviews((prev) => ({ ...prev, [voice.voiceId]: url }));
			await playAudio(baseUrl, url);
		} catch (error) {
			setVoicePreviewErrors((prev) => ({ ...prev, [voice.voiceId]: errorMessage(error) }));
		} finally {
			setVoicePreviewBusy('');
		}
	};

	const uploadFiles = async () => {
		const target = effectiveSkuId;
		const selectedFiles = Array.from(files || []);
		if (!target || !selectedFiles.length) {
			setMessage(target ? '업로드할 첨부 파일을 선택하세요.' : '첨부 전에 연관 SKU를 선택하세요.');
			return;
		}
		setUploading(true);
		setMessage('');
		try {
			const uploaded: typeof uploadedAssets = [];
			for (const file of selectedFiles) {
				const form = new FormData();
				form.append('sku_id', target);
				form.append('asset_type', 'ingredient_document');
				form.append('product_url', activeSkus.find((item) => item.sku_id === target)?.product_url || '');
				form.append('category', 'manual_content_reference');
				form.append('keywords', topicTitle || 'shorts generator');
				form.append('file', file);
				const response = await axios.post<{ item?: { asset_id: string; original_filename?: string | null; filename: string } }>(`${baseUrl}/content/assets/upload`, form);
				if (response.data?.item) uploaded.push(response.data.item);
			}
			setUploadedAssets((prev) => [...prev, ...uploaded]);
			setFiles(null);
			setMessage(`첨부 파일 ${uploaded.length}개를 업로드했습니다.`);
		} catch (error) {
			setMessage(errorMessage(error));
		} finally {
			setUploading(false);
		}
	};

	const validationMessage = (): string => {
		if (sourceType === 'ARTIFACT' && !sourceArtifact) return '숏츠로 만들 기존 콘텐츠를 선택하세요.';
		if (sourceType === 'APPEAL' && !appealId) return '소구포인트를 선택하세요.';
		if (sourceType === 'TOPIC' && !topicTitle.trim()) return '새 주제(제목)를 입력하세요.';
		if (!effectiveSkuId) return '연관 SKU를 선택하세요.';
		return '';
	};

	const generate = async () => {
		const invalid = validationMessage();
		if (invalid) {
			setMessage(invalid);
			return;
		}
		const est = plan?.estimate;
		const confirmText = `숏츠 대본/장면을 생성합니다.\nAI 호출: 대본 ${est?.writerCalls ?? 1}회 + 장면 이미지 ${est?.imageCalls ?? '-'}장\n(음성은 대본 확인 후 [음성 만들기]에서 별도로 만듭니다. 영상 렌더링은 아직 연결되지 않았습니다)\n진행할까요?`;
		if (!window.confirm(confirmText)) return;
		setGenerating(true);
		setMessage('');
		try {
			const response = await axios.post<{ item?: { artifact_id?: string } }>(`${baseUrl}/content/shorts/generate`, {
				source_type: sourceType,
				sku_id: effectiveSkuId,
				appeal_id: sourceType === 'APPEAL' ? appealId : null,
				source_artifact_id: sourceType === 'ARTIFACT' ? sourceArtifactId : null,
				topic_title: topicTitle,
				additional_context: additionalContext,
				attachment_asset_ids: uploadedAssets.map((asset) => asset.asset_id),
				config,
				actor: 'shorts_generator',
			});
			await reload();
			const id = response.data?.item?.artifact_id;
			setMessage('숏츠 대본/장면을 생성했습니다.');
			if (id) onCreated(id);
		} catch (error) {
			setMessage(errorMessage(error));
		} finally {
			setGenerating(false);
		}
	};

	if (registryError) return <section style={ui.card}>숏츠 제작 설정을 불러오지 못했습니다: {registryError}</section>;
	if (!registry) return <section style={ui.card}>숏츠 제작 설정을 불러오는 중...</section>;

	const currentScene = scenePlan[previewIndex % Math.max(1, scenePlan.length)] || null;
	const previewMotion = resolvedTemplate?.motion[previewIndex % resolvedTemplate.motion.length] || 'zoom_in';
	const previewText = currentScene ? (currentScene.stage === 'HOOK' && resolvedTone?.sample ? resolvedTone.sample : `${currentScene.stageLabel} · ${currentScene.purpose}`) : '';
	const previewHighlight = resolved && resolved.subtitle.highlightMode !== 'NORMAL' && currentScene ? [currentScene.stage === 'HOOK' ? previewText.slice(0, Math.min(6, previewText.length)) : currentScene.stageLabel] : [];

	return (
		<div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 7fr) minmax(300px, 3fr)', gap: 16, alignItems: 'start' }} data-testid="shorts-generator">
			<style>{PREVIEW_KEYFRAMES}</style>
			<div style={{ display: 'grid', gap: 14 }}>
				<section style={{ ...ui.card, display: 'grid', gap: 10 }}>
					<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
						<div>
							<h2 style={{ margin: 0 }}>숏츠 제작</h2>
							<div style={{ ...ui.muted, marginTop: 4 }}>콘텐츠 센터가 “무슨 말을 할지”를, 사용자는 “어떻게 보여줄지”를 고릅니다. 모든 항목의 기본값은 AI 추천입니다.</div>
						</div>
						<div style={{ display: 'flex', gap: 6, background: '#f1f5f9', padding: 4, borderRadius: 12 }}>
							<button type="button" style={mode === 'QUICK' ? ui.primary : ui.button} onClick={() => setMode('QUICK')}>빠른 생성</button>
							<button type="button" style={mode === 'CUSTOM' ? ui.primary : ui.button} onClick={() => setMode('CUSTOM')}>맞춤 생성</button>
						</div>
					</div>
					<div style={ui.muted}>{mode === 'QUICK' ? '빠른 생성: 콘텐츠와 영상 길이만 고르면 구성·목소리·말투·음악·자막은 AI 추천으로 채웁니다.' : '맞춤 생성: 영상 구성·목소리·말투·음악·자막을 직접 선택합니다.'}</div>
				</section>

				<Section no="①" title="콘텐츠 소스" help="상품 URL이 아니라 이미 검증된 콘텐츠·소구에서 시작합니다.">
					<div style={grid(170)}>
						{registry.contentSources.map((source) => (
							<ChoiceButton key={source.id} active={sourceType === source.id} disabled={source.enabled === false} onClick={() => setSourceType(source.id as typeof sourceType)}>
								{source.label}{source.note ? <span style={{ color: '#94a3b8', fontSize: 11 }}> · {source.note}</span> : null}
							</ChoiceButton>
						))}
					</div>
					{sourceType === 'ARTIFACT' ? (
						<label style={ui.label}>
							기존 콘텐츠 (블로그/인스타그램/숏츠)
							<select value={sourceArtifactId} onChange={(event) => setSourceArtifactId(event.target.value)} style={ui.input}>
								<option value="">콘텐츠 선택</option>
								{sourceArtifacts.map((item) => <option key={item.artifact_id} value={item.artifact_id}>[{item.channel}] {item.title || item.artifact_id} · v{item.revision_no || 1}</option>)}
							</select>
						</label>
					) : (
						<label style={ui.label}>
							연관 SKU 제품
							<select value={skuId} onChange={(event) => { setSkuId(event.target.value); setUploadedAssets([]); }} style={ui.input}>
								<option value="">SKU 선택</option>
								{activeSkus.map((item) => <option key={item.sku_id} value={item.sku_id}>{item.title || item.sku_id}</option>)}
							</select>
						</label>
					)}
					{sourceType === 'APPEAL' ? (
						<label style={ui.label}>
							소구포인트 (CLEAR {skuAppeals.length}개)
							<select value={appealId} onChange={(event) => setAppealId(event.target.value)} style={ui.input}>
								<option value="">소구 선택</option>
								{skuAppeals.map((item) => <option key={item.appeal_id} value={item.appeal_id}>{item.label}</option>)}
							</select>
						</label>
					) : null}
					{sourceType === 'TOPIC' ? (
						<label style={ui.label}>
							새 주제 (제목)
							<input value={topicTitle} onChange={(event) => setTopicTitle(event.target.value)} placeholder="예: 새치 염색 주기를 늘리는 헤나 관리법" style={ui.input} />
						</label>
					) : null}
					{sourceType !== 'APPEAL' ? (
						<>
							<label style={ui.label}>
								추가 정보 / 반드시 포함할 내용
								<textarea value={additionalContext} onChange={(event) => setAdditionalContext(event.target.value)} rows={3} placeholder="제품 특징, 강조할 문구, 제외할 표현 등을 입력하세요." style={{ ...ui.input, fontWeight: 600, lineHeight: 1.5, resize: 'vertical' }} />
							</label>
							<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
								<input key={`${effectiveSkuId}-${uploadedAssets.length}`} type="file" multiple onChange={(event) => setFiles(event.target.files)} disabled={uploading || !effectiveSkuId} style={{ border: '1px solid #cbd5e1', borderRadius: 10, padding: '7px 10px', fontSize: 12 }} />
								<button type="button" style={uploading || !effectiveSkuId ? ui.disabled : ui.button} disabled={uploading || !effectiveSkuId} onClick={() => void uploadFiles()}>{uploading ? '업로드 중...' : '첨부 업로드'}</button>
								{uploadedAssets.map((asset) => <span key={asset.asset_id} style={{ fontSize: 11, fontWeight: 800, color: '#2563eb' }}>{asset.original_filename || asset.filename}</span>)}
							</div>
						</>
					) : null}
					<div>
						<div style={{ ...ui.label, marginBottom: 6 }}>영상 길이</div>
						<div style={grid(110)}>
							<AiChoice active={duration === AUTO} onClick={() => setDuration(AUTO)} recommended={recommend('duration', resolved ? `${resolved.duration}초` : undefined)} />
							{registry.durations.map((sec) => <ChoiceButton key={sec} active={duration === String(sec)} onClick={() => setDuration(String(sec))}>{sec}초</ChoiceButton>)}
						</div>
					</div>
				</Section>

				{custom ? (
					<>
						<Section no="②" title="콘텐츠 유형" help="무엇을 이야기할지(스토리 구조)를 고릅니다. 영상 디자인과는 별개입니다.">
							<div style={grid(190)}>
								<AiChoice active={storyType === AUTO} onClick={() => setStoryType(AUTO)} recommended={recommend('storyType', resolved ? storyById.get(resolved.storyType)?.label : undefined)} />
								{registry.storyTypes.map((story) => (
									<ChoiceButton key={story.id} active={storyType === story.id} onClick={() => setStoryType(story.id)}>
										<div>{story.label}</div>
										<div style={{ color: '#64748b', fontSize: 11, marginTop: 3 }}>{story.purpose} · {story.stageDetails.map((s) => s.label).join(' → ')}</div>
									</ChoiceButton>
								))}
							</div>
						</Section>

						<Section no="③" title="영상 구성" help="어떻게 보여줄지(디자인 템플릿)와 속도를 고릅니다. 미리보기를 보고 선택하세요.">
							<div style={grid(110)}>
								<div style={{ display: 'grid', gap: 6 }}>
									<AiChoice active={templateId === AUTO} onClick={() => setTemplateId(AUTO)} recommended={recommend('templateId', resolvedTemplate?.label)} />
								</div>
								{registry.visualTemplates.map((template) => (
									<button key={template.id} type="button" onClick={() => setTemplateId(template.id)} style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', textAlign: 'left', display: 'grid', gap: 6 }}>
										<TemplatePreview template={template} active={templateId === template.id} />
										<div style={{ fontSize: 11, color: '#475569', fontWeight: 800 }}>{template.description}</div>
									</button>
								))}
							</div>
							<div style={grid(130)}>
								<AiChoice active={pace === AUTO} onClick={() => setPace(AUTO)} recommended={recommend('pace', resolved ? paceById.get(resolved.pace)?.label : undefined)} />
								{registry.paces.map((item) => <ChoiceButton key={item.id} active={pace === item.id} onClick={() => setPace(item.id)}>{item.label}</ChoiceButton>)}
							</div>
						</Section>

						<Section no="④" title="목소리" help={registry.voiceProvider.note} right={<span style={{ fontSize: 11, fontWeight: 900, color: '#7c3aed' }}>AI 생성 음성 · 미리듣기는 저장본 재생</span>}>
							<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
								<select value={voiceGender} onChange={(event) => setVoiceGender(event.target.value)} style={{ ...ui.input, padding: '6px 10px' }}>
									<option value="">성별 전체</option>
									<option value="female">여성</option>
									<option value="male">남성</option>
								</select>
								<select value={voiceAge} onChange={(event) => setVoiceAge(event.target.value)} style={{ ...ui.input, padding: '6px 10px' }}>
									<option value="">연령 전체</option>
									<option value="20">20대</option>
									<option value="30">30대</option>
									<option value="40">40대</option>
								</select>
							</div>
							{voiceProfile ? (
								<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 10, padding: '8px 10px', marginBottom: 8 }} data-testid="shorts-voice-profile">
									<strong style={{ color: '#5b21b6' }}>{voiceProfile.label} 추천 목소리 (사람 검수 통과)</strong>
									{profileVoiceIds(voiceProfile).map((id) => {
										const role = profileRole(voiceProfile, id);
										const item = voiceById.get(id);
										return (
											<button key={id} type="button" style={{ ...SMALL_BUTTON, fontWeight: voiceId === id || (voiceId === AUTO && resolved?.voice.voiceId === id) ? 900 : 700 }} onClick={() => setVoiceId(id)}>
												{role ? roleLabels[role] : ''}: {item?.displayName || id}
											</button>
										);
									})}
									<span style={{ color: '#64748b', fontSize: 11 }}>Gemini 음성 · 말투 지시 없음(NO_STYLE)</span>
								</div>
							) : (
								<div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>이 콘텐츠 구성에는 검수된 목소리 프로필이 없어 기존 방식으로 추천합니다.</div>
							)}
							<div style={grid(190)}>
								<AiChoice active={voiceId === AUTO} onClick={() => setVoiceId(AUTO)} recommended={recommend('voiceId', voiceLabel(resolvedVoice))} />
								{filteredVoices.map((voice) => (
									<div key={voice.voiceId} style={{ display: 'grid', gap: 4 }}>
										<ChoiceButton active={voiceId === voice.voiceId} onClick={() => setVoiceId(voice.voiceId)}>
											<div>{voice.displayName}{profileRole(voiceProfile, voice.voiceId) ? <span style={{ marginLeft: 6, fontSize: 10, color: '#7c3aed' }}>{roleLabels[profileRole(voiceProfile, voice.voiceId) as VoiceRole]}</span> : null}</div>
											<div style={{ color: '#64748b', fontSize: 11, marginTop: 3 }}>{voice.gender === 'female' ? '여성' : '남성'} / {voice.ageStyle} / {voice.tone} · {providerLabel(voice.provider)}</div>
										</ChoiceButton>
										<button type="button" style={SMALL_BUTTON} disabled={voicePreviewBusy === voice.voiceId} onClick={() => void previewVoice(voice)}>
											{voicePreviewBusy === voice.voiceId ? '미리듣기 만드는 중...' : voicePreviews[voice.voiceId] ? '▶ 미리듣기' : '▶ 미리듣기 (최초 1회 생성)'}
										</button>
										{voicePreviewErrors[voice.voiceId] ? <div style={{ color: '#b91c1c', fontSize: 11 }}>미리듣기 실패: {voicePreviewErrors[voice.voiceId]}</div> : null}
									</div>
								))}
							</div>
						</Section>

						<Section no="⑤" title="내레이션 말투" help="말투는 표현 방식만 바꾸고, 제품 사실(Fact)은 바꾸지 않습니다.">
							<div style={grid(190)}>
								<AiChoice active={narrationTone === AUTO} onClick={() => setNarrationTone(AUTO)} recommended={recommend('narrationTone', resolvedTone?.label)} />
								{registry.narrationTones.map((tone) => (
									<ChoiceButton key={tone.id} active={narrationTone === tone.id} onClick={() => setNarrationTone(tone.id)}>
										<div>{tone.label}</div>
										<div style={{ color: '#64748b', fontSize: 11, marginTop: 3 }}>“{tone.sample}”</div>
									</ChoiceButton>
								))}
							</div>
						</Section>

						<Section no="⑥" title="배경음악" help="공용 음악 라이브러리에서 고릅니다. 숏츠에는 음질 승인 + 음원 사용 조건 확인(허용) + 영상 길이 이상인 곡만 쓰이고, 맞는 곡이 없으면 자동으로 만들지 않습니다. 확인 전 곡도 미리듣기와 음질 검수는 할 수 있습니다." right={<span style={{ fontSize: 11, fontWeight: 900, color: '#475569' }}>사용 가능 {musicLibrary.tracks.filter((track) => track.eligibility?.eligible).length}곡 · 음질 승인 {musicLibrary.tracks.filter((track) => track.approvalStatus === 'APPROVED').length}곡 · 전체 {musicLibrary.tracks.length}곡</span>}>
							<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
								<button type="button" style={musicMood === AUTO ? ui.primary : ui.button} onClick={() => { setMusicMood(AUTO); setMusicTrackId(AUTO); }}>✨ AI 추천{recommend('musicMood', resolved?.music.mood ? moodById.get(resolved.music.mood)?.label : undefined) ? `: ${moodById.get(String(resolved?.music.mood))?.label}` : ''}</button>
								{registry.musicMoods.map((mood) => <button key={mood.id} type="button" style={musicMood === mood.id ? ui.primary : ui.button} onClick={() => { setMusicMood(mood.id); setMusicTrackId(AUTO); }}>{mood.label}</button>)}
								<button type="button" style={musicMood === 'NONE' ? ui.primary : ui.button} onClick={() => { setMusicMood('NONE'); setMusicTrackId(AUTO); }}>음악 없음</button>
							</div>
							{musicMood !== 'NONE' ? (
								<>
									<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
										<button type="button" style={musicTrackId === AUTO ? { ...ui.primary, padding: '4px 8px', fontSize: 11 } : SMALL_BUTTON} onClick={() => setMusicTrackId(AUTO)}>✨ AI 추천 곡</button>
										<span style={{ color: '#475569', fontWeight: 800 }}>
											{resolvedTrack ? `현재 곡: ${resolvedTrack.title}` : '사용 가능한 곡이 없어 곡 배정 대기입니다.'}
										</span>
										{resolvedTrack?.url ? <button type="button" style={SMALL_BUTTON} onClick={() => void playAudio(baseUrl, String(resolvedTrack.url)).catch(() => undefined)}>▶</button> : null}
									</div>
									{plan?.config.musicSelectionBlocked ? (
										<div style={{ fontSize: 12, fontWeight: 800, color: '#b45309' }} data-testid="shorts-music-selection-blocked">
											고른 곡은 아직 숏츠에 쓸 수 없습니다 ({plan.config.musicSelectionBlocked.blockedReasons.map((r) => (r.startsWith('COMMERCIAL_USE_') ? '음원 사용 조건 확인 필요' : r.startsWith('HUMAN_REVIEW_') ? '음질 검수 승인 필요' : r === 'MUSIC_EXTENSION_REQUIRED' ? '영상보다 짧음' : r)).join(', ')}).
										</div>
									) : null}
									{musicLibrary.error ? <div style={{ color: '#b91c1c', fontSize: 12 }}>음악 라이브러리를 불러오지 못했습니다: {musicLibrary.error}</div> : null}
									<MusicLibrary baseUrl={baseUrl} tracks={musicLibrary.tracks} moods={registry.musicMoods} moodFilter={libraryMoodFilter} selectedId={musicTrackId === AUTO ? null : musicTrackId} onSelect={(track) => setMusicTrackId(track.musicId)} onChanged={musicLibrary.reload} />
								</>
							) : null}
						</Section>

						<Section no="⑦" title="자막" help="자막 스타일과 강조 방식을 고릅니다. 강조 문구는 AI가 장면 자막에서 직접 고릅니다.">
							<div style={grid(130)}>
								<ChoiceButton active={subtitleEnabled} onClick={() => setSubtitleEnabled(true)}>자동 자막</ChoiceButton>
								<ChoiceButton active={!subtitleEnabled} onClick={() => setSubtitleEnabled(false)}>자막 없음</ChoiceButton>
							</div>
							{subtitleEnabled ? (
								<>
									<div style={grid(150)}>
										<AiChoice active={subtitleStyleId === AUTO} onClick={() => setSubtitleStyleId(AUTO)} recommended={recommend('subtitleStyleId', resolvedSubtitle?.label)} />
										{registry.subtitleStyles.map((style) => (
											<ChoiceButton key={style.id} active={subtitleStyleId === style.id} onClick={() => setSubtitleStyleId(style.id)}>
												<div style={{ background: '#334155', borderRadius: 8, padding: '8px 6px', textAlign: 'center' }}>
													<SubtitleText text="2주만 지나도 신경 쓰인다면" style={style} highlights={['2주만']} size={12} />
												</div>
												<div style={{ marginTop: 6 }}>{style.label}</div>
											</ChoiceButton>
										))}
									</div>
									<div style={grid(150)}>
										<AiChoice active={highlightMode === AUTO} onClick={() => setHighlightMode(AUTO)} recommended={recommend('highlightMode', resolved ? highlightById.get(resolved.subtitle.highlightMode)?.label : undefined)} />
										{registry.highlightModes.map((item) => <ChoiceButton key={item.id} active={highlightMode === item.id} onClick={() => setHighlightMode(item.id)}>{item.label}</ChoiceButton>)}
									</div>
								</>
							) : null}
						</Section>
					</>
				) : (
					<section style={{ ...ui.card, display: 'grid', gap: 8 }}>
						<div style={{ fontWeight: 950 }}>AI 추천 설정</div>
						<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
							{resolved ? [
								`구성: ${storyById.get(resolved.storyType)?.label || '-'}`,
								`템플릿: ${resolvedTemplate?.label || '-'}`,
								`속도: ${paceById.get(resolved.pace)?.label || '-'}`,
								`목소리: ${voiceLabel(resolvedVoice)}`,
								`말투: ${resolvedTone?.label || '-'}`,
								`음악: ${resolved.music.enabled ? moodById.get(String(resolved.music.mood))?.label || '-' : '없음'}`,
								`자막: ${resolved.subtitle.enabled ? resolvedSubtitle?.label || '-' : '없음'}`,
							].map((text) => <span key={text} style={{ fontSize: 11, fontWeight: 850, color: '#7c3aed', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 999, padding: '4px 8px' }}>{text}</span>) : null}
						</div>
						<div><button type="button" style={ui.button} onClick={() => setMode('CUSTOM')}>맞춤 생성으로 직접 바꾸기</button></div>
					</section>
				)}

				<Section no={custom ? '⑧' : '②'} title="생성 전 스토리보드" help="생성 전에 장면 구성과 시간 배분을 확인합니다. 실제 대본은 생성 후 장면별로 수정할 수 있습니다.">
					{planError ? <div style={{ color: '#b91c1c', fontSize: 12 }}>{planError}</div> : null}
					<div style={{ display: 'grid', gap: 6 }}>
						{scenePlan.map((scene) => (
							<div key={scene.order} style={{ display: 'grid', gridTemplateColumns: '90px 110px minmax(0,1fr) auto', gap: 10, alignItems: 'center', border: currentScene?.order === scene.order ? '1px solid #93c5fd' : '1px solid #e2e8f0', background: currentScene?.order === scene.order ? '#eff6ff' : '#fff', borderRadius: 10, padding: '8px 10px', fontSize: 12 }}>
								<div style={{ fontWeight: 900, color: '#475569' }}>{scene.startSec}~{scene.endSec}초</div>
								<div style={{ fontWeight: 950 }}>Scene {scene.order} · {scene.stageLabel}</div>
								<div style={{ color: '#64748b' }}>{scene.purpose} <span style={{ color: '#94a3b8' }}>(대사 약 {scene.spokenCharsTarget}자)</span></div>
								<div>{scene.productLocked ? <span style={{ fontSize: 10, fontWeight: 900, color: '#047857', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 999, padding: '2px 6px' }}>실제 제품 PNG 합성</span> : null}</div>
							</div>
						))}
					</div>
				</Section>
			</div>

			<aside style={{ position: 'sticky', top: 16, display: 'grid', gap: 12 }}>
				<section style={{ ...ui.card, display: 'grid', gap: 12 }}>
					<div style={{ position: 'relative', aspectRatio: '9 / 16', borderRadius: 14, overflow: 'hidden', background: '#0f172a' }}>
						<div key={`${previewIndex}-${resolved?.templateId}`} style={{ position: 'absolute', inset: 0, background: PREVIEW_BACKGROUNDS[resolvedTemplate?.preview || 'dynamic'], animation: `${motionAnimation(previewMotion, currentScene?.durationSec || 3)}${previewIndex > 0 && resolvedTemplate?.transition !== 'cut' ? ', shortsFade 0.4s ease-out' : ''}` }} />
						{currentScene?.productLocked ? <div style={{ position: 'absolute', left: '30%', right: '30%', top: '30%', bottom: '34%', borderRadius: 10, background: 'linear-gradient(180deg,#a3e635,#3f6212)', boxShadow: '0 10px 24px rgba(0,0,0,0.25)', display: 'grid', placeItems: 'center', color: '#fff', fontSize: 10, fontWeight: 900 }}>제품 PNG</div> : null}
						<div style={{ position: 'absolute', left: 10, top: 10, fontSize: 10, fontWeight: 900, color: '#fff', background: 'rgba(15,23,42,0.55)', borderRadius: 999, padding: '3px 8px' }}>{currentScene ? `Scene ${currentScene.order} · ${currentScene.startSec}~${currentScene.endSec}s` : '미리보기'}</div>
						{resolved?.subtitle.enabled && currentScene ? (
							<div style={{ position: 'absolute', left: 12, right: 12, textAlign: 'center', ...(resolvedTemplate?.subtitlePosition === 'top' ? { top: '16%' } : resolvedTemplate?.subtitlePosition === 'center' ? { top: '58%' } : { bottom: '12%' }) }}>
								<SubtitleText text={previewText} style={resolvedSubtitle} highlights={previewHighlight} size={14} />
							</div>
						) : null}
					</div>
					<div style={{ display: 'grid', gap: 4, fontSize: 12 }}>
						<strong style={{ fontSize: 15 }}>{resolved ? `${plan?.scene_plan.totalDurationSec}초 · ${storyById.get(resolved.storyType)?.label || ''}` : '-'}</strong>
						<span>{resolvedTemplate?.label || '-'} · {resolved ? paceById.get(resolved.pace)?.label : '-'}</span>
						<span>{voiceLabel(resolvedVoice)}</span>
						<span>말투: {resolvedTone?.label || '-'}</span>
						<span>음악: {resolved?.music.enabled ? `${moodById.get(String(resolved.music.mood))?.label || '-'}${resolved.music.trackId ? '' : ' (곡 배정 대기)'}` : '없음'}</span>
						<span>자막: {resolved?.subtitle.enabled ? `${resolvedSubtitle?.label || '-'} · ${highlightById.get(resolved.subtitle.highlightMode)?.label || ''}` : '없음'}</span>
					</div>
					<div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 10, fontSize: 11, color: '#475569', lineHeight: 1.5 }}>
						<div style={{ fontWeight: 900, color: '#0f172a' }}>예상 생성 비용</div>
						<div>지금: 대본 {plan?.estimate.writerCalls ?? 1}회 + 장면 이미지 {plan?.estimate.imageCalls ?? '-'}장</div>
						<div>음성(대본 확인 후): 장면 {plan?.estimate.audio?.narrationCalls ?? '-'}개 · TTS 최대 {plan?.estimate.audio?.narrationCalls ?? '-'}회 (동일 음성 재사용 시 0회)</div>
						<div>음악: {plan?.estimate.audio?.musicStatus === 'READY' ? '라이브러리 곡 사용 · 추가 호출 0회' : plan?.estimate.audio?.musicStatus === 'DISABLED' ? '음악 없음' : `곡 배정 대기 · 라이브러리 선택 0회 / 새 BGM ${plan?.estimate.audio?.newBgmCalls ?? 1}회`}</div>
						<div style={{ color: '#94a3b8' }}>{plan?.estimate.note}</div>
					</div>
					<div style={{ color: message.includes('생성했습니다') || message.includes('업로드했습니다') ? '#047857' : '#b45309', fontSize: 12, fontWeight: 800 }}>{message || validationMessage()}</div>
					<button type="button" style={generating || uploading ? ui.disabled : ui.primary} disabled={generating || uploading} onClick={() => void generate()}>
						{generating ? '대본/장면 생성 중... (1~2분)' : '숏츠 대본·장면 생성'}
					</button>
				</section>
			</aside>
		</div>
	);
}

const NARRATION_LABEL: Record<NarrationStatus, string> = { READY: '음성 준비됨', STALE: '음성 갱신 필요', PENDING_TTS: '음성 대기', FAILED: '음성 실패' };
const NARRATION_COLOR: Record<NarrationStatus, string> = { READY: '#047857', STALE: '#b45309', PENDING_TTS: '#64748b', FAILED: '#b91c1c' };
const STALE_REASON_LABEL: Record<string, string> = { text: '대사', voice: '목소리', tone: '말투', model: '모델', instructionProfile: '지시 버전', provider: '음성 엔진' };
const MUSIC_STATUS_LABEL: Record<string, string> = { READY: '곡 배정됨', PENDING_TRACK: '곡 배정 대기', TRACK_UNAVAILABLE: '곡 사용 불가', TRACK_NOT_ELIGIBLE: '곡 사용 조건 미충족', DISABLED: '음악 없음' };
const TIMING_LABEL: Record<string, string> = { FIT: '적합', SHORT: '짧음', OVERFLOW: '초과 · 검토 필요', PENDING_MEASUREMENT: '측정 전' };
const TIMING_COLOR: Record<string, string> = { FIT: '#047857', SHORT: '#2563eb', OVERFLOW: '#b91c1c', PENDING_MEASUREMENT: '#64748b' };
const AUTHORITY_LABEL: Record<string, string> = { ACTUAL: '실제 음성 기준', ESTIMATED: '예상치 기준', MIXED: '실제+예상 혼합', NONE: '근거 없음' };

function timingSec(ms?: number | null): string {
	return typeof ms === 'number' ? `${(ms / 1000).toFixed(2)}초` : '-';
}

export function ShortsRenderPlanPanel({
	apiBaseUrl,
	artifactId,
	skuId,
	config,
	scenes,
	unsaved,
	onArtifactUpdated,
	onOpenGenerator,
}: {
	apiBaseUrl?: string;
	artifactId?: string;
	skuId?: string;
	config?: any;
	scenes: any[];
	unsaved?: boolean;
	onArtifactUpdated?: (item: any) => void;
	onOpenGenerator?: () => void;
}): JSX.Element | null {
	const baseUrl = apiBaseUrl || 'http://localhost:5189';
	const [plan, setPlan] = React.useState<PlanResponse | null>(null);
	const [error, setError] = React.useState('');
	const [refreshTick, setRefreshTick] = React.useState(0);
	const [audioBusy, setAudioBusy] = React.useState('');
	const [audioNote, setAudioNote] = React.useState('');
	const [showMusicPicker, setShowMusicPicker] = React.useState(false);
	const [moods, setMoods] = React.useState<Option[]>([]);
	const [voices, setVoices] = React.useState<Voice[]>([]);
	const [voiceProfiles, setVoiceProfiles] = React.useState<VoiceProfile[]>([]);
	const [showVoicePicker, setShowVoicePicker] = React.useState(false);
	const [sequenceScene, setSequenceScene] = React.useState<number | null>(null);
	const musicLibrary = useMusicLibrary(baseUrl, Number(config?.resolved?.duration) || 30);
	const scenesKey = JSON.stringify(scenes || []);
	const configKey = JSON.stringify(config?.resolved || null);
	const hasConfig = Boolean(config && typeof config === 'object' && config.resolved);
	React.useEffect(() => {
		if (!artifactId || !hasConfig) return undefined;
		const timer = window.setTimeout(() => {
			axios.post<PlanResponse>(`${baseUrl}/content/shorts/plan`, { artifact_id: artifactId, sku_id: skuId || null, scenes: JSON.parse(scenesKey) })
				.then((response) => { setPlan(response.data); setError(''); })
				.catch((err) => setError(errorMessage(err)));
		}, 600);
		return () => window.clearTimeout(timer);
	}, [artifactId, baseUrl, hasConfig, scenesKey, skuId, configKey, refreshTick, musicLibrary.tracks]);
	React.useEffect(() => {
		if (!hasConfig) return;
		axios.get<{ registry: Registry }>(`${baseUrl}/content/shorts/registry`)
			.then((response) => {
				setMoods(response.data.registry.musicMoods || []);
				setVoices(response.data.registry.voices || []);
				setVoiceProfiles(response.data.registry.voiceProfiles || []);
			})
			.catch(() => undefined);
	}, [baseUrl, hasConfig]);
	React.useEffect(() => () => stopAudio(), []);

	const audioPlan = plan?.render_plan.audioPlan;
	const summary = audioPlan?.narrationSummary;
	const timeline = audioPlan?.timeline;
	const narrationByOrder = new Map((audioPlan?.narration || []).map((entry) => [entry.sceneOrder, entry]));
	const narrationTodo = summary ? summary.pending + summary.stale + summary.failed : 0;
	const unsavedNote = '저장되지 않은 변경이 있습니다. 먼저 저장한 뒤 진행하세요.';
	const voicePlan = audioPlan?.voice;
	const isGemini = String(voicePlan?.provider || '').toUpperCase() === 'GEMINI';
	const ttsName = `${providerLabel(voicePlan?.provider)} TTS`;
	const fidelityCost = (count: number) => (isGemini ? ` + 대본 충실성 받아쓰기(OpenAI) 최대 ${count}회` : '');
	const readyUrls = (audioPlan?.narration || []).filter((entry) => entry.status === 'READY' && entry.url).map((entry) => String(entry.url));
	const allReady = Boolean(summary && summary.scenes > 0 && readyUrls.length === summary.scenes);
	const panelProfile = voiceProfiles.find((profile) => profile.id === voicePlan?.profileId);
	const voiceById = new Map(voices.map((voice) => [voice.voiceId, voice]));

	const playFullNarration = async () => {
		if (sequenceScene !== null) {
			stopAudio();
			setSequenceScene(null);
			return;
		}
		try {
			await playSequence(baseUrl, readyUrls, (index) => setSequenceScene(index + 1));
		} catch (err) {
			if ((err as Error)?.message !== 'stopped') setAudioNote('전체 나레이션을 재생하지 못했습니다.');
		} finally {
			setSequenceScene(null);
		}
	};
	const changeVoice = async (voice: Voice) => {
		if (!artifactId) return;
		if (unsaved) {
			setAudioNote(unsavedNote);
			return;
		}
		if (!window.confirm(`목소리를 '${voice.displayName}' (${providerLabel(voice.provider)})(으)로 바꾼 새 revision을 만듭니다.\n현재 숏츠의 음성·승인 기록은 그대로 두고, 음성은 새 revision에서 [음성 만들기]로 따로 만듭니다 (지금 TTS 호출 0회).\n진행할까요?`)) return;
		setAudioBusy('voice');
		try {
			const response = await axios.post<{ revision: { artifact_id: string } }>(`${baseUrl}/content/shorts/artifacts/${artifactId}/voice`, { voice_id: voice.voiceId, actor: 'shorts_ui' });
			setAudioNote(`새 revision ${response.data.revision.artifact_id} 을(를) 만들었습니다. 그 숏츠를 열어 음성을 만들고 전체 나레이션을 들어 보세요.`);
			setShowVoicePicker(false);
		} catch (err) {
			setAudioNote(errorMessage(err));
		} finally {
			setAudioBusy('');
		}
	};

	const generateNarration = async (sceneOrders?: number[], force = false) => {
		if (!artifactId || !summary) return;
		if (unsaved) {
			setAudioNote(unsavedNote);
			return;
		}
		const single = Boolean(sceneOrders?.length);
		const text = single
			? `Scene ${sceneOrders?.join(', ')} 음성을 ${force ? '새로 다시 만듭니다' : '만듭니다'} (${ttsName} 최대 ${sceneOrders?.length}회${fidelityCost(sceneOrders?.length || 0)}${force ? '' : ', 같은 음성이 있으면 재사용 0회'}).\n진행할까요?`
			: `장면 음성을 만듭니다.\n대상 ${narrationTodo}개 장면 · ${ttsName} 최대 ${narrationTodo}회${fidelityCost(narrationTodo)} (같은 문장·목소리로 이미 만든 음성은 재사용 0회)\n실패하면 다른 목소리로 바꾸지 않고 실패로 표시합니다.\n준비된 ${summary.ready}개 장면은 그대로 둡니다.\n진행할까요?`;
		if (!window.confirm(text)) return;
		setAudioBusy(single ? `scene-${sceneOrders?.[0]}` : 'all');
		setAudioNote('');
		try {
			const response = await axios.post<{ summary: { generated: number; reused: number; readyKept: number; failed: number; ttsCalls: number; transcribeCalls?: number; fidelityReviewRequired?: number }; item?: any }>(`${baseUrl}/content/shorts/artifacts/${artifactId}/narration`, { scene_orders: sceneOrders || null, force });
			const result = response.data.summary;
			const fidelityNote = result.transcribeCalls ? ` · 받아쓰기 ${result.transcribeCalls}회 · 대본 검수 필요 ${result.fidelityReviewRequired || 0}` : '';
			setAudioNote(`음성 처리 완료: 생성 ${result.generated} · 재사용 ${result.reused} · 유지 ${result.readyKept} · 실패 ${result.failed} (TTS 호출 ${result.ttsCalls}회${fidelityNote})`);
			if (response.data.item) onArtifactUpdated?.(response.data.item);
			setRefreshTick((value) => value + 1);
		} catch (err) {
			setAudioNote(errorMessage(err));
		} finally {
			setAudioBusy('');
		}
	};
	const updateMusic = async (payload: { music_id?: string; disable?: boolean }) => {
		if (!artifactId) return;
		if (unsaved) {
			setAudioNote(unsavedNote);
			return;
		}
		setAudioBusy('music');
		try {
			const response = await axios.post<{ item?: any }>(`${baseUrl}/content/shorts/artifacts/${artifactId}/music`, payload);
			if (response.data.item) onArtifactUpdated?.(response.data.item);
			setShowMusicPicker(false);
			setRefreshTick((value) => value + 1);
		} catch (err) {
			setAudioNote(errorMessage(err));
		} finally {
			setAudioBusy('');
		}
	};
	const play = (url?: string | null) => {
		if (url) playAudio(baseUrl, url).catch(() => setAudioNote('재생하지 못했습니다.'));
	};
	if (!hasConfig) {
		if (!artifactId) return null;
		return (
			<section style={{ border: '1px solid #fde68a', borderRadius: 14, padding: 12, display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', background: '#fffbeb' }} data-testid="shorts-render-plan-legacy">
				<div style={{ fontSize: 12, color: '#92400e', lineHeight: 1.5 }}>
					<strong>숏츠 제작 설정 없음 (예전 방식 생성)</strong>
					<div>이 숏츠는 숏츠 제작 툴 이전 방식으로 만들어져 콘텐츠 유형·템플릿·목소리·말투·음악·자막 설정과 렌더 계획이 없습니다.</div>
				</div>
				{onOpenGenerator ? <button type="button" style={ui.button} onClick={onOpenGenerator}>숏츠 제작 툴에서 다시 만들기</button> : null}
			</section>
		);
	}
	const resolved = config.resolved as ResolvedConfig;
	const chips = [
		`${resolved.duration}초`,
		`구성 ${resolved.storyType}`,
		`템플릿 ${resolved.templateId}`,
		`속도 ${resolved.pace}`,
		`목소리 ${resolved.voice.voiceId}`,
		`말투 ${resolved.narrationTone}`,
		`음악 ${resolved.music.enabled ? resolved.music.mood || '-' : '없음'}`,
		`자막 ${resolved.subtitle.enabled ? `${resolved.subtitle.styleId} · ${resolved.subtitle.highlightMode}` : '없음'}`,
	];
	return (
		<section style={{ border: '1px solid #e2e8f0', borderRadius: 14, padding: 12, display: 'grid', gap: 10, background: '#f8fafc' }} data-testid="shorts-render-plan">
			<div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
				<strong>숏츠 제작 설정 · 렌더 계획</strong>
				<span style={{ fontSize: 11, fontWeight: 900, color: '#b45309' }}>{plan?.render_plan.status === 'PLANNED_NOT_RENDERED' ? '영상 렌더링 대기 (렌더러 연결 전 · 음성/음악은 별도 레이어)' : '계획 확인 중'}</span>
			</div>
			<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
				{chips.map((chip) => <span key={chip} style={{ fontSize: 11, fontWeight: 850, color: '#4338ca', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 999, padding: '3px 8px' }}>{chip}</span>)}
				{(config.aiRecommended || []).length ? <span style={{ fontSize: 11, fontWeight: 850, color: '#7c3aed' }}>✨ AI 추천 {config.aiRecommended.length}개 항목</span> : null}
			</div>
			{error ? <div style={{ color: '#b91c1c', fontSize: 12 }}>{error}</div> : null}
			{plan?.claim_grounding ? (
				<div style={{ fontSize: 11, fontWeight: 800, color: plan.claim_grounding.contentGroundingStatus === 'CONTENT_GROUNDING_PASS' ? '#047857' : '#b45309' }} data-testid="shorts-claim-grounding">
					근거 연결: {CLAIM_GROUNDING_LABEL[plan.claim_grounding.status] || plan.claim_grounding.status}
					{plan.claim_grounding.totals ? ` · 확인 완료 ${plan.claim_grounding.totals.GROUNDED || 0} · 연결 문장 ${plan.claim_grounding.totals.EDITORIAL || 0} · 확인 필요 ${plan.claim_grounding.totals.UNRESOLVED || 0} · 근거 없음 ${plan.claim_grounding.totals.UNSUPPORTED || 0} · 잘못된 참조 ${plan.claim_grounding.totals.INVALID_REF || 0}` : ''}
				</div>
			) : null}
			{plan?.claim_grounding && claimRiskSummary(plan.claim_grounding.riskCounts) ? (
				<div style={{ fontSize: 11, fontWeight: 800, color: '#b45309' }} data-testid="shorts-claim-semantic-risk">
					{claimRiskSummary(plan.claim_grounding.riskCounts)}
				</div>
			) : null}
			{plan?.claim_grounding ? <ClaimGroundingDetails grounding={plan.claim_grounding} /> : null}
			{plan?.claim_grounding && artifactId ? <ShortsNarrationFitPanel baseUrl={baseUrl} artifactId={artifactId} unsaved={unsaved} /> : null}
			{plan && audioPlan && summary ? (
				<div style={{ display: 'grid', gap: 8, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 10 }} data-testid="shorts-audio-plan">
					<div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
						<div style={{ fontSize: 12, fontWeight: 900 }}>
							음성 · 준비 {summary.ready}/{summary.scenes}
							{summary.stale ? ` · 갱신 필요 ${summary.stale}` : ''}{summary.pending ? ` · 대기 ${summary.pending}` : ''}{summary.failed ? ` · 실패 ${summary.failed}` : ''}
							{summary.timingReviewRequired ? <span style={{ color: '#b91c1c' }}> · 길이 검토 {summary.timingReviewRequired}</span> : null}
							{audioPlan.aiVoiceDisclosure.disclosureRequired ? <span style={{ marginLeft: 6, fontSize: 10, color: '#7c3aed', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 999, padding: '2px 6px' }}>AI 생성 음성 · 게시 시 고지 필요</span> : null}
						</div>
						<span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
							<button type="button" style={allReady ? ui.button : ui.disabled} disabled={!allReady} onClick={() => void playFullNarration()} data-testid="shorts-play-full-narration">
								{sequenceScene !== null ? `■ 정지 (Scene ${sequenceScene}/${summary.scenes} 재생 중)` : allReady ? '▶ 전체 나레이션 연속 재생' : `전체 재생은 모든 장면 준비 후 (${readyUrls.length}/${summary.scenes})`}
							</button>
							<button type="button" style={unsaved || audioBusy || !narrationTodo ? ui.disabled : ui.primary} disabled={Boolean(unsaved || audioBusy || !narrationTodo)} onClick={() => void generateNarration()}>
								{audioBusy === 'all' ? '음성 만드는 중...' : !narrationTodo ? '모든 장면 음성 준비됨' : unsaved ? '저장 후 음성 만들기' : `음성 만들기 (${ttsName} 최대 ${narrationTodo}회)`}
							</button>
						</span>
					</div>
					{voicePlan ? (
						<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 12 }} data-testid="shorts-voice-plan">
							<strong>목소리</strong>
							<span>{voicePlan.displayName || voicePlan.voiceId} · {providerLabel(voicePlan.provider)}</span>
							{voicePlan.profileLabel ? <span style={{ color: '#5b21b6', fontWeight: 900 }}>{voicePlan.profileLabel} {voicePlan.profileRole ? DEFAULT_ROLE_LABELS[voicePlan.profileRole] : '프로필 밖 목소리'}</span> : null}
							<span style={{ color: '#64748b' }}>{voicePlan.selectionSource === 'USER_SELECTED' ? '사용자 선택' : voicePlan.selectionSource === 'AI_RECOMMENDED' ? 'AI 추천' : '선택 기록 없음'}</span>
							{voicePlan.estimatorNote ? <span style={{ color: '#b45309' }}>{voicePlan.estimatorNote}</span> : null}
							{summary.fidelityReviewRequired ? <span style={{ color: '#b91c1c', fontWeight: 900 }}>대본 검수 필요 {summary.fidelityReviewRequired}장면</span> : null}
							<button type="button" style={SMALL_BUTTON} disabled={Boolean(audioBusy)} onClick={() => setShowVoicePicker((value) => !value)}>{showVoicePicker ? '닫기' : '목소리 변경 (새 revision)'}</button>
						</div>
					) : null}
					{showVoicePicker ? (
						<div style={{ display: 'grid', gap: 6, fontSize: 12, border: '1px dashed #c4b5fd', borderRadius: 8, padding: 8 }} data-testid="shorts-voice-picker">
							{panelProfile ? (
								<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
									<strong style={{ color: '#5b21b6' }}>{panelProfile.label} 추천</strong>
									{profileVoiceIds(panelProfile).map((id) => {
										const voice = voiceById.get(id);
										const role = profileRole(panelProfile, id);
										return voice ? <button key={id} type="button" style={SMALL_BUTTON} disabled={Boolean(audioBusy) || voicePlan?.voiceId === id} onClick={() => void changeVoice(voice)}>{role ? DEFAULT_ROLE_LABELS[role] : ''}: {voice.displayName}</button> : null;
									})}
								</div>
							) : null}
							<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
								<span style={{ color: '#64748b' }}>전체 목소리</span>
								{voices.map((voice) => <button key={voice.voiceId} type="button" style={SMALL_BUTTON} disabled={Boolean(audioBusy) || voicePlan?.voiceId === voice.voiceId} onClick={() => void changeVoice(voice)}>{voice.displayName} · {providerLabel(voice.provider)}</button>)}
							</div>
						</div>
					) : null}
					{timeline ? (
						<div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, background: timeline.totalTimingStatus === 'OVERFLOW' ? '#fef2f2' : '#f8fafc', border: `1px solid ${timeline.totalTimingStatus === 'OVERFLOW' ? '#fecaca' : '#e2e8f0'}`, borderRadius: 8, padding: '6px 8px' }} data-testid="shorts-timing-total">
							<strong>전체 길이</strong>
							<span>영상 목표 {timingSec(timeline.videoTargetDurationMs)}</span>
							<span>음성 실제 합계 {timeline.narrationActualTotalMs !== null ? timingSec(timeline.narrationActualTotalMs) : `미완료 (측정 ${timeline.measuredScenes}/${summary.scenes}장면 · ${timingSec(timeline.narrationActualMeasuredMs)})`}</span>
							<span>예상 합계 {timingSec(timeline.narrationEstimatedTotalMs)}</span>
							<span style={{ color: TIMING_COLOR[timeline.totalTimingStatus] || '#475569', fontWeight: 900 }}>판정: {TIMING_LABEL[timeline.totalTimingStatus] || timeline.totalTimingStatus} ({AUTHORITY_LABEL[timeline.totalTimingAuthority] || timeline.totalTimingAuthority})</span>
							<span style={{ color: '#64748b' }}>비음성 예약 {timingSec(timeline.reservedNonSpeechDurationMs)} · 자동 길이 조정 없음</span>
						</div>
					) : null}
					<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 12 }}>
						<strong>배경음악</strong>
						<span style={{ color: audioPlan.music.status === 'READY' ? '#047857' : '#b45309', fontWeight: 900 }}>{MUSIC_STATUS_LABEL[audioPlan.music.status] || audioPlan.music.status}</span>
						{audioPlan.music.status === 'TRACK_NOT_ELIGIBLE' && audioPlan.music.eligibility ? <span style={{ color: '#b45309' }}>({musicBlockNote({ musicId: '', title: '', approvalStatus: '', eligibility: audioPlan.music.eligibility })})</span> : null}
						{audioPlan.music.title ? <span>{audioPlan.music.title} · {formatSec(audioPlan.music.durationMs)}</span> : null}
						{audioPlan.music.url ? <button type="button" style={SMALL_BUTTON} onClick={() => play(audioPlan.music.url)}>▶</button> : null}
						{audioPlan.music.status === 'PENDING_TRACK' && plan.music_recommendation ? (
							<button type="button" style={SMALL_BUTTON} disabled={Boolean(audioBusy)} onClick={() => void updateMusic({ music_id: plan.music_recommendation?.musicId })}>✨ AI 추천 곡 사용: {plan.music_recommendation.title}</button>
						) : null}
						<button type="button" style={SMALL_BUTTON} disabled={Boolean(audioBusy)} onClick={() => setShowMusicPicker((value) => !value)}>{showMusicPicker ? '닫기' : '다른 음악 선택'}</button>
						{audioPlan.music.status !== 'DISABLED' ? <button type="button" style={SMALL_BUTTON} disabled={Boolean(audioBusy)} onClick={() => void updateMusic({ disable: true })}>음악 없음</button> : null}
					</div>
					{showMusicPicker ? <MusicLibrary baseUrl={baseUrl} tracks={musicLibrary.tracks} moods={moods} moodFilter={null} selectedId={audioPlan.music.musicId} onSelect={(track) => void updateMusic({ music_id: track.musicId })} onChanged={musicLibrary.reload} /> : null}
					{audioNote ? <div style={{ fontSize: 11, fontWeight: 800, color: '#475569' }}>{audioNote}</div> : null}
				</div>
			) : null}
			{plan ? (
				<div style={{ display: 'grid', gap: 4 }}>
					{plan.render_plan.scenes.map((scene) => {
						const narration = narrationByOrder.get(scene.order);
						return (
							<div key={scene.order} style={{ display: 'grid', gridTemplateColumns: '80px 110px 120px minmax(0,1fr) minmax(230px, 360px)', gap: 8, fontSize: 11, alignItems: 'center', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 8px' }}>
								<span style={{ fontWeight: 900 }}>{scene.startSec}~{scene.endSec}s</span>
								<span>Scene {scene.order} · {scene.stageLabel || scene.stage || '-'}</span>
								<span style={{ color: '#64748b' }}>{scene.motion} / {scene.transitionIn}</span>
								<span style={{ color: '#475569' }}>
									{scene.layers.map((layer) => layer.source === 'PRODUCT_LOCKED_ASSET' ? '🔒제품 PNG' : layer.source === 'scene_image' ? '장면 이미지' : layer.source === 'STALE_SCENE_IMAGE' ? '이미지 갱신 필요' : layer.source === 'INVALID_VISUAL_ASSET' ? '이미지 오류' : '이미지 대기').join(' + ')}
									{scene.subtitle.highlights.length ? ` · 강조: ${scene.subtitle.highlights.join(', ')}` : ''}
								</span>
								{narration ? (
									<span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
										<span style={{ color: NARRATION_COLOR[narration.status], fontWeight: 900 }}>
											{NARRATION_LABEL[narration.status]}{narration.status === 'STALE' && narration.staleReasons?.length ? ` (${narration.staleReasons.map((reason) => STALE_REASON_LABEL[reason] || reason).join('·')} 변경)` : ''}
										</span>
										{narration.url ? <button type="button" style={SMALL_BUTTON} onClick={() => play(narration.url)}>▶</button> : null}
										{narration.fidelity ? (
											<span style={{ color: narration.fidelity.reviewRequired ? '#b91c1c' : '#047857', fontWeight: 900 }} title={narration.fidelity.transcription ? `받아쓰기: ${narration.fidelity.transcription}` : narration.fidelity.error || undefined} data-testid="shorts-scene-fidelity">
												{FIDELITY_LABEL[narration.fidelity.status] || narration.fidelity.status}
											</span>
										) : null}
										<span data-testid="shorts-scene-timing" title={narration.budget ? `말 글자 ${narration.budget.speechChars}자 · 권장 ${narration.budget.preferredTextBudget ?? '-'}자 · 최대 ${narration.budget.hardTextBudget ?? '-'}자` : undefined}>
											목표 {timingSec(narration.targetSceneDurationMs)} · 예상 {timingSec(narration.estimatedNarrationDurationMs)} · 실제 {timingSec(narration.actualNarrationDurationMs)}
										</span>
										<span style={{ color: TIMING_COLOR[narration.timingStatus] || '#475569', fontWeight: 900 }}>
											{TIMING_LABEL[narration.timingStatus] || narration.timingStatus}{narration.timingAuthority === 'ESTIMATED' ? ' (예상)' : ''}
										</span>
										{narration.status !== 'PENDING_TTS' ? <button type="button" style={SMALL_BUTTON} disabled={Boolean(unsaved || audioBusy)} onClick={() => void generateNarration([scene.order], narration.status === 'READY')}>{audioBusy === `scene-${scene.order}` ? '만드는 중...' : narration.status === 'READY' ? '다시 만들기' : '이 장면 만들기'}</button> : null}
									</span>
								) : <span />}
							</div>
						);
					})}
					<div style={{ fontSize: 11, color: '#64748b' }}>{plan.render_plan.productLockedAsset.url ? plan.render_plan.productLockedAsset.rule : '대표 제품 이미지가 없어 제품 PNG 합성 레이어가 비어 있습니다. 제품 이미지 메뉴에서 대표 이미지를 등록하세요.'}</div>
				</div>
			) : null}
		</section>
	);
}
