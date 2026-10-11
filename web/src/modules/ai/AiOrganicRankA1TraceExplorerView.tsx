import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useLocation } from 'react-router-dom';

type RunItem = {
	run_id: string;
	run_date: string;
	surface: string;
	action_version?: string;
	model?: string;
	status?: string;
	created_at?: string;
};

type TraceNode = {
	node_id: string;
	run_id: string;
	sku_id: string;
	node_type: string;
	title: string;
	summary_md?: string;
	severity?: string | null;
	query_sql?: string | null;
	query_params_json?: string | null;
	formula?: string | null;
	blob_id?: string | null;
	content_hash?: string | null;
	content_type?: string | null;
	tags_json?: string | null;
	sort_key?: number;
};

type TraceEdge = {
	from_node_id: string;
	to_node_id: string;
	edge_type: string;
	label?: string | null;
};

type TraceBlob = {
	blob_id: string;
	content_type: string;
	content_hash: string;
	size: number;
	content_text: string;
};

type ExportResponse = {
	ok: boolean;
	run: RunItem | null;
	sku_id: string;
	nodes: TraceNode[];
	edges: TraceEdge[];
	blobs: TraceBlob[];
};

type SkusResponse = {
	ok: boolean;
	run_id: string;
	skus: string[];
	labels?: Record<string, string>;
};

type VerifyResponse = {
	ok: boolean;
	match: boolean;
	message: string;
	stored_hash?: string | null;
	recomputed_hash?: string | null;
	recomputed_preview?: string | null;
};

type ActionReviewItem = {
	review_id: string;
	run_id: string;
	sku_id: string;
	action_title: string;
	accepted: boolean;
	comment?: string | null;
	evidence_refs?: string[];
	created_at?: string | null;
	updated_at?: string | null;
};

type ActionReviewListResponse = {
	ok: boolean;
	run_id: string;
	sku_id: string;
	items: ActionReviewItem[];
};

type ActionReviewState = {
	accepted: boolean;
	comment: string;
	evidence_refs: string[];
	review_id?: string;
};

function ymd(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${dd}`;
}

function safeJsonParse<T>(s: any, fallback: T): T {
	try {
		if (!s) return fallback;
		return JSON.parse(String(s)) as T;
	} catch {
		return fallback;
	}
}

function displaySkuLabel(sku: string, labels: Record<string, string>): string {
	const s = String(sku || '').trim();
	if (s === '__RUN__') return '전체 배치(요약/NO_DATA)';
	const label = labels?.[s];
	if (label && String(label).trim()) return String(label).trim();
	// legacy: "url||keyword" 형태면 keyword만 노출(상품명 미수집 대비)
	if (s.includes('||')) {
		const parts = s.split('||');
		const kw = String(parts[1] ?? '').trim();
		if (kw) return kw;
	}
	return s || '-';
}

function normTitle(v: any): string {
	return String(v?.title ?? v?.action_title ?? '').trim();
}

function ActionReviewControls(props: {
	title: string;
	evidenceRefs: any;
	value?: ActionReviewState;
	disabled?: boolean;
	onSave: (next: { accepted: boolean; comment: string; evidence_refs: string[] }) => Promise<void>;
}): JSX.Element {
	const title = String(props.title || '').trim();
	const disabled = !!props.disabled || !title;
	const initialAccepted = props.value ? !!props.value.accepted : false;
	const initialComment = props.value ? String(props.value.comment || '') : '';
	const initialRefs = props.value?.evidence_refs || (Array.isArray(props.evidenceRefs) ? props.evidenceRefs.map((x) => String(x)) : []);

	const [accepted, setAccepted] = useState<boolean>(initialAccepted);
	const [comment, setComment] = useState<string>(initialComment);
	const [saving, setSaving] = useState(false);
	const [saveFeedback, setSaveFeedback] = useState<{ kind: 'success' | 'error'; text: string; at: number } | null>(null);
	const [savedBaseline, setSavedBaseline] = useState<{ accepted: boolean; comment: string; refsKey: string }>(() => {
		const refsKey = initialRefs.map((x) => String(x || '').trim()).filter(Boolean).join('||');
		return { accepted: initialAccepted, comment: initialComment, refsKey };
	});

	// props 변경 시 동기화(선택 SKU 전환 등)
	useEffect(() => {
		setAccepted(initialAccepted);
		setComment(initialComment);
		setSaveFeedback(null);
		const refsKey = initialRefs.map((x) => String(x || '').trim()).filter(Boolean).join('||');
		setSavedBaseline({ accepted: initialAccepted, comment: initialComment, refsKey });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [props.value?.review_id, title]);

	const statusText = props.value ? (props.value.accepted ? '수락됨' : '미수락') : '미결정';
	const statusColor = props.value ? (props.value.accepted ? '#86efac' : '#fca5a5') : '#94a3b8';

	const fmtTime = (ms: number): string => {
		try {
			const d = new Date(ms);
			const hh = String(d.getHours()).padStart(2, '0');
			const mm = String(d.getMinutes()).padStart(2, '0');
			const ss = String(d.getSeconds()).padStart(2, '0');
			return `${hh}:${mm}:${ss}`;
		} catch {
			return '';
		}
	};

	const refsKey = useMemo(() => initialRefs.map((x) => String(x || '').trim()).filter(Boolean).join('||'), [initialRefs]);
	const isDirty =
		savedBaseline.accepted !== accepted ||
		String(savedBaseline.comment || '') !== String(comment || '') ||
		String(savedBaseline.refsKey || '') !== String(refsKey || '');

	// UX 정책:
	// - 기존 저장값이 있는 경우: 변경 전에는 저장 버튼 비활성화(불필요한 중복 저장 방지)
	// - 아직 저장된 값이 없는 경우(초기 미결정): 첫 저장은 허용
	const hasExisting = !!props.value;
	const saveDisabled = disabled || saving || (hasExisting && !isDirty);

	return (
		<div style={{ marginTop: 10, borderTop: '1px solid rgba(148,163,184,0.12)', paddingTop: 10 }}>
			<div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
				<div style={{ fontSize: 12, fontWeight: 900, color: statusColor }}>6) 수락/미수락: {statusText}</div>
				<button
					type="button"
					className="btn-primary"
					disabled={saveDisabled}
					onClick={async () => {
						if (saveDisabled) return;
						setSaving(true);
						setSaveFeedback(null);
						try {
							await props.onSave({ accepted, comment: String(comment || ''), evidence_refs: initialRefs.filter((x) => String(x).trim()) });
							const now = Date.now();
							setSaveFeedback({ kind: 'success', text: `저장 완료 (${fmtTime(now)})`, at: now });
							// 저장 성공 시점의 상태를 baseline으로 고정 → 변경 전까지 버튼 비활성화
							setSavedBaseline({ accepted, comment: String(comment || ''), refsKey });
						} catch (e: any) {
							const msg = String(e?.response?.data?.detail ?? e?.message ?? e ?? '저장 실패');
							const now = Date.now();
							setSaveFeedback({ kind: 'error', text: `저장 실패: ${msg}`, at: now });
						} finally {
							setSaving(false);
						}
					}}
				>
					{saving ? '저장 중…' : '저장'}
				</button>
			</div>
			{saveFeedback ? (
				<div
					role="status"
					aria-label="save-feedback"
					style={{
						marginTop: 6,
						fontSize: 12,
						fontWeight: 900,
						color: saveFeedback.kind === 'success' ? '#bbf7d0' : '#fda4af',
					}}
				>
					{saveFeedback.text}
				</div>
			) : null}

			<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
				<button type="button" className="btn-ghost" onClick={() => setAccepted(true)} disabled={disabled}>
					수락
				</button>
				<button type="button" className="btn-ghost" onClick={() => setAccepted(false)} disabled={disabled}>
					미수락
				</button>
				<div style={{ fontSize: 11, color: '#94a3b8' }}>현재 선택: {accepted ? '수락' : '미수락'}</div>
			</div>

			<div style={{ marginTop: 8 }}>
				<div className="field-label">의견/추가 내용</div>
				<textarea
					className="input"
					value={comment}
					onChange={(e) => setComment(e.target.value)}
					placeholder="결정 이유/추가 메모를 기록하세요(저장 시 DB에 남습니다)."
					style={{ minHeight: 72 }}
					disabled={disabled}
				/>
			</div>
		</div>
	);
}

export function AiOrganicRankA1TraceExplorerView(props: { apiBaseUrl: string }): JSX.Element {
	const apiBaseUrl = props.apiBaseUrl;
	const location = useLocation();
	const [batchDate, setBatchDate] = useState<string>(() => {
		const d = new Date();
		d.setDate(d.getDate() - 1);
		return ymd(d);
	});
	const [batchSurface, setBatchSurface] = useState<string>('mobile_integrated');
	const [batchRunning, setBatchRunning] = useState(false);
	const [batchToast, setBatchToast] = useState<string | null>(null);
	const [dateFrom, setDateFrom] = useState<string>(() => {
		const d = new Date();
		d.setDate(d.getDate() - 7);
		return ymd(d);
	});
	const [dateTo, setDateTo] = useState<string>(() => ymd(new Date()));

	const [loadingRuns, setLoadingRuns] = useState(false);
	const [runs, setRuns] = useState<RunItem[]>([]);
	const [selectedRunId, setSelectedRunId] = useState<string>('');

	const [loadingSkus, setLoadingSkus] = useState(false);
	const [skus, setSkus] = useState<string[]>([]);
	const [skuLabels, setSkuLabels] = useState<Record<string, string>>({});
	const [selectedSku, setSelectedSku] = useState<string>('');

	const [loadingTrace, setLoadingTrace] = useState(false);
	const [trace, setTrace] = useState<ExportResponse | null>(null);
	const [error, setError] = useState<string | null>(null);

	const [expanded, setExpanded] = useState<Record<string, boolean>>({});
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const [highlightAliases, setHighlightAliases] = useState<Set<string>>(new Set());

	const [verifyLoading, setVerifyLoading] = useState(false);
	const [verifyResult, setVerifyResult] = useState<VerifyResponse | null>(null);

	const [reviewsLoading, setReviewsLoading] = useState(false);
	const [reviewToast, setReviewToast] = useState<string | null>(null);
	const [reviewsByTitle, setReviewsByTitle] = useState<Record<string, ActionReviewState>>({});

	const fetchRuns = async () => {
		setLoadingRuns(true);
		setError(null);
		try {
			const res = await axios.get(`${apiBaseUrl}/ai/a1/runs`, {
				params: { from: dateFrom, to: dateTo, limit: 50 },
				timeout: 20000,
			});
			const items = (res.data as any)?.items || [];
			const list: RunItem[] = Array.isArray(items)
				? items
						.map((x: any) => ({
							run_id: String(x?.run_id ?? ''),
							run_date: String(x?.run_date ?? ''),
							surface: String(x?.surface ?? ''),
							action_version: x?.action_version ? String(x.action_version) : undefined,
							model: x?.model ? String(x.model) : undefined,
							status: x?.status ? String(x.status) : undefined,
							created_at: x?.created_at ? String(x.created_at) : undefined,
						}))
						.filter((x) => x.run_id)
				: [];
			setRuns(list);
			const next = list[0]?.run_id ?? '';
			// URL query(run_id)가 있으면 우선 적용
			const qs = new URLSearchParams(location.search || '');
			const qRun = String(qs.get('run_id') || '').trim();
			setSelectedRunId((prev) => prev || qRun || next);
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? 'run 목록 조회 실패';
			setError(String(msg));
		} finally {
			setLoadingRuns(false);
		}
	};

	const runBatch = async () => {
		if (batchRunning) return;
		setBatchRunning(true);
		setError(null);
		setBatchToast(null);
		try {
			const res = await axios.post(
				`${apiBaseUrl}/ai/a1/batch/run`,
				{
					date: String(batchDate || '').trim() || undefined,
					surface: String(batchSurface || '').trim() || 'mobile_integrated',
					max_items: 200,
					model: 'gpt-4o-mini',
				},
				{ timeout: 90000 },
			);
			const rid = String((res.data as any)?.trace_run_id ?? '').trim();
			setBatchToast(rid ? `배치 완료 (run: ${rid.slice(0, 8)})` : '배치 완료');
			await fetchRuns();
			if (rid) {
				setSelectedRunId(rid);
			}
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? '배치 실행 실패';
			setError(String(msg));
		} finally {
			setBatchRunning(false);
		}
	};

	useEffect(() => {
		void fetchRuns();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const fetchSkus = async (runId: string) => {
		if (!runId) return;
		setLoadingSkus(true);
		setError(null);
		try {
			const res = await axios.get<SkusResponse>(`${apiBaseUrl}/ai/a1/trace/skus`, { params: { run_id: runId, limit: 500 }, timeout: 20000 });
			const list = (res.data as any)?.skus || [];
			const out = Array.isArray(list) ? list.map((x: any) => String(x)).filter((x: string) => x.trim()) : [];
			setSkus(out);
			const labels = (res.data as any)?.labels;
			setSkuLabels(labels && typeof labels === 'object' ? (labels as Record<string, string>) : {});
			// URL query(sku_id)가 있으면 우선 적용
			const qs = new URLSearchParams(location.search || '');
			const qSku = String(qs.get('sku_id') || '').trim();
			setSelectedSku((prev) => prev || qSku || out[0] || '');
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? 'sku 목록 조회 실패';
			setError(String(msg));
			setSkus([]);
			setSkuLabels({});
			setSelectedSku('');
		} finally {
			setLoadingSkus(false);
		}
	};

	useEffect(() => {
		if (!selectedRunId) return;
		void fetchSkus(selectedRunId);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedRunId]);

	const fetchTrace = async (runId: string, skuId: string) => {
		if (!runId || !skuId) return;
		setLoadingTrace(true);
		setError(null);
		setVerifyResult(null);
		try {
			const res = await axios.get(`${apiBaseUrl}/ai/a1/trace/export`, {
				params: { run_id: runId, sku_id: skuId, include_blobs: 1 },
				timeout: 30000,
			});
			const data = res.data as ExportResponse;
			setTrace(data);
			setSelectedNodeId(null);
			setExpanded({});
			setHighlightAliases(new Set());
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? 'trace 조회 실패';
			setError(String(msg));
			setTrace(null);
		} finally {
			setLoadingTrace(false);
		}
	};

	const fetchReviews = async (runId: string, skuId: string) => {
		if (!runId || !skuId) return;
		setReviewsLoading(true);
		setReviewToast(null);
		try {
			const res = await axios.get<ActionReviewListResponse>(`${apiBaseUrl}/ai/a1/reviews/actions`, {
				params: { run_id: runId, sku_id: skuId },
				timeout: 20000,
			});
			const items = (res.data as any)?.items || [];
			const next: Record<string, ActionReviewState> = {};
			if (Array.isArray(items)) {
				for (const it of items) {
					const title = String((it as any)?.action_title ?? '').trim();
					if (!title) continue;
					next[title] = {
						review_id: String((it as any)?.review_id ?? ''),
						accepted: !!(it as any)?.accepted,
						comment: String((it as any)?.comment ?? ''),
						evidence_refs: Array.isArray((it as any)?.evidence_refs) ? (it as any).evidence_refs.map((x: any) => String(x)) : [],
					};
				}
			}
			setReviewsByTitle(next);
		} catch {
			// 리뷰는 부가 기능이므로 실패해도 Trace 열람은 진행
			setReviewsByTitle({});
		} finally {
			setReviewsLoading(false);
		}
	};

	useEffect(() => {
		if (!selectedRunId || !selectedSku) return;
		void fetchTrace(selectedRunId, selectedSku);
		void fetchReviews(selectedRunId, selectedSku);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedRunId, selectedSku]);

	const nodeById = useMemo(() => {
		const m: Record<string, TraceNode> = {};
		for (const n of trace?.nodes || []) m[n.node_id] = n;
		return m;
	}, [trace?.nodes]);

	const blobById = useMemo(() => {
		const m: Record<string, TraceBlob> = {};
		for (const b of trace?.blobs || []) m[b.blob_id] = b;
		return m;
	}, [trace?.blobs]);

	const aliasToNodeId = useMemo(() => {
		const m: Record<string, string> = {};
		for (const n of trace?.nodes || []) {
			const tags = safeJsonParse<any>(n.tags_json, null);
			const alias = tags && typeof tags === 'object' ? String(tags?.alias ?? '') : '';
			if (alias) m[alias] = n.node_id;
		}
		return m;
	}, [trace?.nodes]);

	const childrenById = useMemo(() => {
		const m: Record<string, string[]> = {};
		for (const e of trace?.edges || []) {
			const fromNodeId = String(e.from_node_id || '').trim();
			const toNodeId = String(e.to_node_id || '').trim();
			if (!fromNodeId || !toNodeId) continue;
			const children = m[fromNodeId] ?? [];
			children.push(toNodeId);
			m[fromNodeId] = children;
		}
		for (const k of Object.keys(m)) m[k] = Array.from(new Set(m[k])).filter(Boolean);
		return m;
	}, [trace?.edges]);

	const rootIds = useMemo(() => {
		const all = new Set((trace?.nodes || []).map((n) => n.node_id));
		const to = new Set((trace?.edges || []).map((e) => e.to_node_id));
		const roots = Array.from(all).filter((id) => !to.has(id));
		// 정렬: sort_key 우선
		return roots.sort((a, b) => (Number(nodeById[a]?.sort_key ?? 0) || 0) - (Number(nodeById[b]?.sort_key ?? 0) || 0));
	}, [trace?.nodes, trace?.edges, nodeById]);

	const selectedNode = selectedNodeId ? nodeById[selectedNodeId] || null : null;
	const selectedBlob = selectedNode?.blob_id ? blobById[selectedNode.blob_id] || null : null;

	const gptResult = useMemo(() => {
		// GptOutput 또는 FinalRecommendation blob을 우선 사용
		const n = (trace?.nodes || []).find((x) => x.node_type === 'GptOutput') || (trace?.nodes || []).find((x) => x.node_type === 'FinalRecommendation') || null;
		const b = n?.blob_id ? blobById[n.blob_id] : null;
		if (!b?.content_text) return null;
		return safeJsonParse<any>(b.content_text, null);
	}, [trace?.nodes, blobById]);

	const actions = Array.isArray(gptResult?.recommended_actions) ? gptResult.recommended_actions : [];

	const actionHints = useMemo(() => {
		// 서버 결정론 액션 템플릿(ActionHints) blob
		const n = (trace?.nodes || []).find((x) => x.node_type === 'ActionHints') || null;
		const b = n?.blob_id ? blobById[n.blob_id] : null;
		if (!b?.content_text) return [];
		const arr = safeJsonParse<any>(b.content_text, []);
		return Array.isArray(arr) ? arr : [];
	}, [trace?.nodes, blobById]);

	const [showAiOnlyActions, setShowAiOnlyActions] = useState(false);

	const actionDiff = useMemo(() => {
		const normText = (v: any) => String(v ?? '').trim();
		const normPri = (v: any) => normText(v).toUpperCase();

		const isNonEmptyText = (value: string): value is string => Boolean(value);
		const hintTitles = new Set<string>(actionHints.map(normTitle).filter(isNonEmptyText));
		const aiTitles = new Set<string>(actions.map(normTitle).filter(isNonEmptyText));
		let overlap = 0;
		for (const t of hintTitles) if (aiTitles.has(t)) overlap += 1;
		const templateOnly = Array.from(hintTitles).filter((t) => !aiTitles.has(t)).length;
		const aiOnly = Array.from(aiTitles).filter((t) => !hintTitles.has(t)).length;

		const hintByTitle: Record<string, any> = {};
		for (const h of actionHints) {
			const t = normTitle(h);
			if (!t) continue;
			if (!hintByTitle[t]) hintByTitle[t] = h;
		}
		const aiByTitle: Record<string, any> = {};
		for (const a of actions) {
			const t = normTitle(a);
			if (!t) continue;
			if (!aiByTitle[t]) aiByTitle[t] = a;
		}

		const conflictTitles = new Set<string>();
		for (const t of Array.from(hintTitles)) {
			if (!aiTitles.has(t)) continue;
			const h = hintByTitle[t];
			const a = aiByTitle[t];
			if (!h || !a) continue;
			const samePri = normPri(h?.priority) === normPri(a?.priority);
			const sameWhy = normText(h?.why) === normText(a?.why);
			const sameHow = normText(h?.how) === normText(a?.how);
			if (!(samePri && sameWhy && sameHow)) conflictTitles.add(t);
		}

		const gptOnlyActions = actions.filter((a: any) => {
			const t = normTitle(a);
			return t ? !hintTitles.has(t) : true;
		});
		const gptIncludedActions = actions.filter((a: any) => {
			const t = normTitle(a);
			return t ? hintTitles.has(t) : false;
		});

		return {
			hints: hintTitles.size,
			ai: aiTitles.size,
			overlap,
			templateOnly,
			aiOnly,
			hasHint: (title: string) => hintTitles.has(String(title || '').trim()),
			hasAi: (title: string) => aiTitles.has(String(title || '').trim()),
			isConflict: (title: string) => conflictTitles.has(String(title || '').trim()),
			gptOnlyActions,
			gptIncludedActions,
		};
	}, [actionHints, actions]);

	const toggleExpand = (id: string) => {
		setExpanded((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }));
	};

	const highlightFromEvidenceRefs = (refs: any) => {
		const next = new Set<string>();
		const arr = Array.isArray(refs) ? refs : [];
		for (const r of arr) {
			const s = String(r ?? '').trim();
			if (!s) continue;
			if (s.startsWith('node:')) next.add(s.slice('node:'.length));
			else if (s.startsWith('kw:')) next.add(s);
			else next.add(s);
		}
		setHighlightAliases(next);
		// 첫 대상 노드로 점프
		for (const alias of Array.from(next)) {
			const nid = aliasToNodeId[alias];
			if (nid) {
				setSelectedNodeId(nid);
				break;
			}
		}
	};

	const runVerify = async () => {
		if (!selectedNodeId) return;
		setVerifyLoading(true);
		setVerifyResult(null);
		try {
			const res = await axios.post(`${apiBaseUrl}/ai/a1/trace/verify`, { node_id: selectedNodeId }, { timeout: 30000 });
			setVerifyResult(res.data as VerifyResponse);
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? '검증 실패';
			setVerifyResult({ ok: false, match: false, message: String(msg) });
		} finally {
			setVerifyLoading(false);
		}
	};

	const renderTree = (nodeId: string, depth: number) => {
		const n = nodeById[nodeId];
		if (!n) return null;
		const kids = childrenById[nodeId] || [];
		const isExpanded = expanded[nodeId] ?? true;
		const tags = safeJsonParse<any>(n.tags_json, null);
		const alias = tags && typeof tags === 'object' ? String(tags?.alias ?? '') : '';
		const isHighlighted = alias ? highlightAliases.has(alias) : false;
		const isSelected = nodeId === selectedNodeId;

		return (
			<div key={nodeId}>
				<button
					type="button"
					className="btn-ghost"
					onClick={() => {
						setSelectedNodeId(nodeId);
						setVerifyResult(null);
					}}
					style={{
						width: '100%',
						textAlign: 'left',
						padding: '6px 8px',
						marginLeft: depth * 12,
						border: isSelected ? '1px solid rgba(34,197,94,0.55)' : '1px solid rgba(148,163,184,0.18)',
						background: isHighlighted ? 'rgba(250,204,21,0.12)' : isSelected ? 'rgba(34,197,94,0.08)' : 'transparent',
					}}
				>
					<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
						{kids.length > 0 ? (
							<span
								onClick={(e) => {
									e.preventDefault();
									e.stopPropagation();
									toggleExpand(nodeId);
								}}
								title={isExpanded ? '접기' : '펼치기'}
								style={{ width: 16, display: 'inline-flex', justifyContent: 'center' }}
							>
								{isExpanded ? '▾' : '▸'}
							</span>
						) : (
							<span style={{ width: 16 }} />
						)}
						<span style={{ fontWeight: 900, color: '#e2e8f0' }}>{n.title}</span>
						{n.node_type ? <span style={{ fontSize: 11, color: '#94a3b8' }}>({n.node_type})</span> : null}
					</div>
				</button>
				{kids.length > 0 && isExpanded ? (
					<div style={{ marginTop: 4 }}>
						{kids
							.slice()
							.sort((a, b) => (Number(nodeById[a]?.sort_key ?? 0) || 0) - (Number(nodeById[b]?.sort_key ?? 0) || 0))
							.map((cid) => renderTree(cid, depth + 1))}
					</div>
				) : null}
			</div>
		);
	};

	return (
		<div style={{ display: 'grid', gap: 12 }}>
			<div className="card" style={{ display: 'grid', gap: 10 }}>
				<div className="card-title">A-1 검증(역추적) — 최종 제안 근거 트리</div>
				<div className="card-caption">
					최종 제안만 보지 않고, <b>규칙/근거 수치/원본 테이블/쿼리</b>까지 클릭으로 확인합니다. (검증: 해시 비교)
				</div>

				<div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
					<div style={{ display: 'grid', gap: 6 }}>
						<label className="field-label">배치 실행일(전일)</label>
						<input className="input" type="date" value={batchDate} onChange={(e) => setBatchDate(e.target.value)} />
					</div>
					<div style={{ display: 'grid', gap: 6, width: 180 }}>
						<label className="field-label">지면(surface)</label>
						<input className="input" value={batchSurface} onChange={(e) => setBatchSurface(e.target.value)} />
					</div>
					<div style={{ marginLeft: 6 }}>
						<button type="button" className="btn-primary" onClick={runBatch} disabled={batchRunning}>
							{batchRunning ? '배치 실행 중…' : '배치 실행(Trace 생성)'}
						</button>
					</div>
					{batchToast ? <div style={{ fontSize: 12, fontWeight: 900, color: '#bbf7d0' }}>{batchToast}</div> : null}

					<div style={{ display: 'grid', gap: 6 }}>
						<label className="field-label">기간(from)</label>
						<input className="input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
					</div>
					<div style={{ display: 'grid', gap: 6 }}>
						<label className="field-label">기간(to)</label>
						<input className="input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
					</div>
					<div style={{ marginLeft: 6 }}>
						<button type="button" className="btn-primary" onClick={fetchRuns} disabled={loadingRuns}>
							{loadingRuns ? '조회 중…' : 'Run 조회'}
						</button>
					</div>

					{error ? <div style={{ fontSize: 12, fontWeight: 900, color: '#fda4af', marginLeft: 8 }}>{error}</div> : null}
				</div>

				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
					<div style={{ display: 'grid', gap: 6 }}>
						<label className="field-label">Run 선택</label>
						<select
							className="input"
							value={selectedRunId}
							onChange={(e) => setSelectedRunId(e.target.value)}
							disabled={loadingRuns || runs.length === 0}
						>
							{runs.map((r) => (
								<option key={r.run_id} value={r.run_id}>
									{r.run_date} · {r.surface} · {r.status || '-'} · {r.run_id.slice(0, 8)}
								</option>
							))}
						</select>
					</div>
					<div style={{ display: 'grid', gap: 6 }}>
						<label className="field-label">SKU 선택</label>
						<select
							className="input"
							value={selectedSku}
							onChange={(e) => setSelectedSku(e.target.value)}
							disabled={loadingSkus || skus.length === 0}
						>
							{skus.map((s) => (
								<option key={s} value={s}>
									{displaySkuLabel(s, skuLabels)}
								</option>
							))}
						</select>
						{!loadingSkus && selectedRunId && skus.length === 0 ? (
							<div style={{ fontSize: 11, color: '#fbbf24', marginTop: 6 }}>
								선택 가능한 SKU가 없습니다. (대상 이벤트 0개 / NO_DATA) → 아래 “배치 실행” 또는 날짜/지면을 바꾸고, 데이터 수집/생성을 확인하세요.
							</div>
						) : null}
					</div>
				</div>
				<div style={{ fontSize: 11, color: '#94a3b8' }}>
					{loadingSkus ? 'SKU 목록 조회 중…' : null} {loadingTrace ? 'Trace 로딩 중…' : null}
				</div>
			</div>

			<div style={{ display: 'grid', gridTemplateColumns: '360px 1fr 520px', gap: 12, alignItems: 'start' }}>
				{/* LEFT: Tree */}
				<div className="card" style={{ padding: 12 }}>
					<div className="card-title" style={{ marginBottom: 8 }}>
						트리(역추적)
					</div>
					<div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8 }}>
						노드를 클릭하면 우측에서 원본/쿼리/검증을 확인할 수 있습니다.
					</div>
					<div style={{ maxHeight: 720, overflow: 'auto', display: 'grid', gap: 6 }}>
						{trace && rootIds.length > 0 ? rootIds.map((rid) => renderTree(rid, 0)) : <div style={{ fontSize: 12, color: '#94a3b8' }}>데이터가 없습니다.</div>}
					</div>
				</div>

				{/* MID: Final summary + actions */}
				<div className="card" style={{ padding: 12 }}>
					<div className="card-title">최종 제안(요약)</div>
					<div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 8 }}>
						<div>
							<b>상품</b>: {displaySkuLabel(selectedSku, skuLabels)}
						</div>
						<div>
							<b>Run</b>: {selectedRunId ? selectedRunId.slice(0, 12) : '-'}
						</div>
					</div>
					{reviewToast ? <div style={{ marginTop: 8, fontSize: 12, fontWeight: 900, color: '#bbf7d0' }}>{reviewToast}</div> : null}
					{reviewsLoading ? <div style={{ marginTop: 6, fontSize: 11, color: '#94a3b8' }}>수락/미수락 기록 로딩 중…</div> : null}

					{/* NO_DATA 안내 */}
					{trace?.run?.status === 'NO_DATA' ? (
						<div className="card" style={{ padding: 10, marginTop: 12, border: '1px solid rgba(251,191,36,0.25)' }}>
							<div style={{ fontWeight: 900, color: '#fbbf24' }}>NO_DATA: 지금은 분석 대상이 없습니다.</div>
							<div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 6, lineHeight: 1.5 }}>
								이 배치는 <b>sku_event_daily</b>에서 <b>HIGH/CRITICAL</b> 이벤트가 있는 SKU만 대상으로 삼습니다. 현재 날짜/지면에는 대상 이벤트가 없어 분석이 비었습니다.
								<br />
								<b>다음에 무엇을 하면 되나요?</b>
								<ul style={{ marginTop: 6, paddingLeft: 18 }}>
									<li>1) 데이터 수집/배치 파이프라인 실행 → sku_event_daily가 생성되는지 확인</li>
									<li>2) 대상 날짜(전일)·지면(surface)을 바꿔 재시도</li>
									<li>3) 트리에서 “대상 이벤트 조회(원본)” 노드를 선택 후 <b>검증(재계산)</b>으로 누락 없이 확인</li>
								</ul>
							</div>
						</div>
					) : null}

					{/* Deterministic action hints + diff */}
					{Array.isArray(actionHints) && actionHints.length > 0 ? (
						<div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
							<div className="field-label">결정론 액션(템플릿) — 설정 기준 기반</div>
							<div style={{ fontSize: 11, color: '#94a3b8' }}>
								diff: 템플릿 {actionDiff.hints} · GPT {actionDiff.ai} · 일치 {actionDiff.overlap} · 템플릿만 {actionDiff.templateOnly} · GPT만 {actionDiff.aiOnly}
							</div>
							{actionHints.slice(0, 10).map((a: any, idx: number) => {
								const title = String(a?.title ?? '');
								const why = String(a?.why ?? '');
								const how = String(a?.how ?? '');
								const priority = String(a?.priority ?? '');
								const refs = a?.evidence_refs;
								const inAi = actionDiff.hasAi(title);
								const conflict = actionDiff.isConflict(title);
								return (
									<div key={`hint-${idx}`} className="card" style={{ padding: 10, border: '1px solid rgba(148,163,184,0.18)' }}>
										<div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
											<div style={{ fontWeight: 900, color: '#e2e8f0' }}>
												[{priority || 'P?'}] {title}{' '}
												<span style={{ fontSize: 11, color: conflict ? '#fbbf24' : inAi ? '#86efac' : '#fca5a5' }}>
													{conflict ? '(충돌)' : inAi ? '(GPT 반영)' : '(GPT 미반영)'}
												</span>
											</div>
											<button type="button" className="btn-ghost" onClick={() => highlightFromEvidenceRefs(refs)} style={{ padding: '4px 8px' }}>
												왜? (근거)
											</button>
										</div>
										{why ? (
											<div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 6 }}>
												<b>이유</b>: {why}
											</div>
										) : null}
										{how ? (
											<div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 4 }}>
												<b>방법</b>: {how}
											</div>
										) : null}
										{Array.isArray(refs) && refs.length > 0 ? (
											<div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>
												근거 참조: {refs.map((x: any) => String(x)).join(', ')}
											</div>
										) : null}

										<ActionReviewControls
											title={title}
											evidenceRefs={refs}
											value={reviewsByTitle[title]}
											disabled={!selectedRunId || !selectedSku}
											onSave={async (next) => {
												await axios.post(
													`${apiBaseUrl}/ai/a1/reviews/actions`,
													{
														run_id: selectedRunId,
														sku_id: selectedSku,
														action_title: title,
														accepted: !!next.accepted,
														comment: String(next.comment || ''),
														evidence_refs: next.evidence_refs || [],
													},
													{ timeout: 20000 },
												);
												setReviewsByTitle((prev) => ({ ...prev, [title]: { accepted: !!next.accepted, comment: String(next.comment || ''), evidence_refs: next.evidence_refs || [] } }));
												setReviewToast('저장 완료');
												window.setTimeout(() => setReviewToast(null), 1200);
											}}
										/>
									</div>
								);
							})}
						</div>
					) : null}

					{Array.isArray(actions) && actions.length > 0 ? (
						<div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
							<div className="field-label">추천 액션(클릭 → 근거 하이라이트)</div>
							{(Array.isArray(actionHints) && actionHints.length > 0 ? actionDiff.gptIncludedActions : actions).slice(0, 10).map((a: any, idx: number) => {
								const title = String(a?.title ?? '');
								const why = String(a?.why ?? '');
								const how = String(a?.how ?? '');
								const priority = String(a?.priority ?? '');
								const refs = a?.evidence_refs;
								const inTemplate = actionDiff.hasHint(title);
								const conflict = actionDiff.isConflict(title);
								return (
									<div key={idx} className="card" style={{ padding: 10, border: '1px solid rgba(148,163,184,0.18)' }}>
										<div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
											<div style={{ fontWeight: 900, color: '#e2e8f0' }}>
												[{priority || 'P?'}] {title}{' '}
												{Array.isArray(actionHints) && actionHints.length > 0 ? (
													<span style={{ fontSize: 11, color: conflict ? '#fbbf24' : inTemplate ? '#86efac' : '#fbbf24' }}>
														{conflict ? '(충돌)' : inTemplate ? '(템플릿 포함)' : '(GPT 단독)'}
													</span>
												) : null}
											</div>
											<button type="button" className="btn-ghost" onClick={() => highlightFromEvidenceRefs(refs)} style={{ padding: '4px 8px' }}>
												왜? (근거)
											</button>
										</div>
										{why ? <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 6 }}><b>이유</b>: {why}</div> : null}
										{how ? <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 4 }}><b>방법</b>: {how}</div> : null}
										{Array.isArray(refs) && refs.length > 0 ? (
											<div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>
												근거 참조: {refs.map((x: any) => String(x)).join(', ')}
											</div>
										) : null}

										<ActionReviewControls
											title={title}
											evidenceRefs={refs}
											value={reviewsByTitle[title]}
											disabled={!selectedRunId || !selectedSku}
											onSave={async (next) => {
												await axios.post(
													`${apiBaseUrl}/ai/a1/reviews/actions`,
													{
														run_id: selectedRunId,
														sku_id: selectedSku,
														action_title: title,
														accepted: !!next.accepted,
														comment: String(next.comment || ''),
														evidence_refs: next.evidence_refs || [],
													},
													{ timeout: 20000 },
												);
												setReviewsByTitle((prev) => ({ ...prev, [title]: { accepted: !!next.accepted, comment: String(next.comment || ''), evidence_refs: next.evidence_refs || [] } }));
												setReviewToast('저장 완료');
												window.setTimeout(() => setReviewToast(null), 1200);
											}}
										/>
									</div>
								);
							})}

							{/* GPT only actions (toggle) */}
							{Array.isArray(actionHints) && actionHints.length > 0 && actionDiff.gptOnlyActions.length > 0 ? (
								<div style={{ marginTop: 6 }}>
									<button
										type="button"
										className="btn-ghost"
										onClick={() => setShowAiOnlyActions((v) => !v)}
										style={{ padding: '6px 8px' }}
									>
										{showAiOnlyActions ? 'GPT 단독 액션 숨김' : `GPT 단독 액션 보기 (${actionDiff.gptOnlyActions.length})`}
									</button>
									{showAiOnlyActions ? (
										<div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
											{actionDiff.gptOnlyActions.slice(0, 10).map((a: any, idx: number) => {
												const title = String(a?.title ?? '');
												const why = String(a?.why ?? '');
												const how = String(a?.how ?? '');
												const priority = String(a?.priority ?? '');
												const refs = a?.evidence_refs;
												return (
													<div key={`ai-only-${idx}`} className="card" style={{ padding: 10, border: '1px solid rgba(148,163,184,0.18)' }}>
														<div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
															<div style={{ fontWeight: 900, color: '#e2e8f0' }}>
																[{priority || 'P?'}] {title}{' '}
																<span style={{ fontSize: 11, color: '#fbbf24' }}>(GPT 단독)</span>
															</div>
															<button type="button" className="btn-ghost" onClick={() => highlightFromEvidenceRefs(refs)} style={{ padding: '4px 8px' }}>
																왜? (근거)
															</button>
														</div>
														{why ? (
															<div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 6 }}>
																<b>이유</b>: {why}
															</div>
														) : null}
														{how ? (
															<div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 4 }}>
																<b>방법</b>: {how}
															</div>
														) : null}
														{Array.isArray(refs) && refs.length > 0 ? (
															<div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>
																근거 참조: {refs.map((x: any) => String(x)).join(', ')}
															</div>
														) : null}

														<ActionReviewControls
															title={title}
															evidenceRefs={refs}
															value={reviewsByTitle[title]}
															disabled={!selectedRunId || !selectedSku}
															onSave={async (next) => {
																await axios.post(
																	`${apiBaseUrl}/ai/a1/reviews/actions`,
																	{
																		run_id: selectedRunId,
																		sku_id: selectedSku,
																		action_title: title,
																		accepted: !!next.accepted,
																		comment: String(next.comment || ''),
																		evidence_refs: next.evidence_refs || [],
																	},
																	{ timeout: 20000 },
																);
																setReviewsByTitle((prev) => ({ ...prev, [title]: { accepted: !!next.accepted, comment: String(next.comment || ''), evidence_refs: next.evidence_refs || [] } }));
																setReviewToast('저장 완료');
																window.setTimeout(() => setReviewToast(null), 1200);
															}}
														/>
													</div>
												);
											})}
										</div>
									) : null}
								</div>
							) : null}
						</div>
					) : (
						<div style={{ marginTop: 12, fontSize: 12, color: '#94a3b8' }}>추천 액션이 없습니다(또는 아직 생성되지 않았습니다).</div>
					)}
				</div>

				{/* RIGHT: Detail */}
				<div className="card" style={{ padding: 12 }}>
					<div className="card-title">노드 상세</div>
					{selectedNode ? (
						<div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
							<div style={{ fontSize: 12, color: '#cbd5e1' }}>
								<div>
									<b>제목</b>: {selectedNode.title}
								</div>
								<div>
									<b>유형</b>: {selectedNode.node_type}
								</div>
								{selectedNode.content_hash ? (
									<div>
										<b>해시</b>: <code>{selectedNode.content_hash}</code>
									</div>
								) : null}
							</div>

							{selectedNode.summary_md ? (
								<div>
									<div className="field-label">요약</div>
									<pre
										style={{
											whiteSpace: 'pre-wrap',
											wordBreak: 'break-word',
											fontSize: 12,
											color: '#e2e8f0',
											background: 'rgba(15,23,42,0.35)',
											border: '1px solid rgba(148,163,184,0.18)',
											borderRadius: 8,
											padding: 10,
										}}
									>
										{selectedNode.summary_md}
									</pre>
								</div>
							) : null}

							{selectedBlob?.content_text ? (
								<div>
									<div className="field-label">원본(JSON/텍스트)</div>
									<pre
										style={{
											whiteSpace: 'pre-wrap',
											wordBreak: 'break-word',
											fontSize: 12,
											color: '#e2e8f0',
											background: 'rgba(15,23,42,0.35)',
											border: '1px solid rgba(148,163,184,0.18)',
											borderRadius: 8,
											padding: 10,
											maxHeight: 320,
											overflow: 'auto',
										}}
									>
										{(() => {
											const obj = safeJsonParse<any>(selectedBlob.content_text, null);
											return obj ? JSON.stringify(obj, null, 2) : String(selectedBlob.content_text);
										})()}
									</pre>
									<div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>
										blob_id: <code>{selectedBlob.blob_id}</code> · size: {selectedBlob.size?.toLocaleString?.() ?? selectedBlob.size}
									</div>
								</div>
							) : null}

							{selectedNode.query_sql ? (
								<div>
									<div className="field-label">SQL(검증용)</div>
									<pre
										style={{
											whiteSpace: 'pre-wrap',
											wordBreak: 'break-word',
											fontSize: 12,
											color: '#e2e8f0',
											background: 'rgba(15,23,42,0.35)',
											border: '1px solid rgba(148,163,184,0.18)',
											borderRadius: 8,
											padding: 10,
										}}
									>
										{selectedNode.query_sql}
									</pre>
									{selectedNode.query_params_json ? (
										<div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>
											params: <code>{selectedNode.query_params_json}</code>
										</div>
									) : null}
								</div>
							) : null}

							<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
								<button type="button" className="btn-primary" onClick={runVerify} disabled={!selectedNode.query_sql || verifyLoading}>
									{verifyLoading ? '검증 중…' : '검증(재계산)'}
								</button>
								{verifyResult ? (
									<span style={{ fontSize: 12, fontWeight: 900, color: verifyResult.ok && verifyResult.match ? '#86efac' : '#fca5a5' }}>
										{verifyResult.ok ? (verifyResult.match ? '일치(OK)' : '불일치/미검증') : '검증 실패'}
									</span>
								) : null}
							</div>
							{verifyResult ? (
								<pre
									style={{
										whiteSpace: 'pre-wrap',
										wordBreak: 'break-word',
										fontSize: 12,
										color: '#e2e8f0',
										background: 'rgba(15,23,42,0.35)',
										border: '1px solid rgba(148,163,184,0.18)',
										borderRadius: 8,
										padding: 10,
										maxHeight: 220,
										overflow: 'auto',
									}}
								>
									{JSON.stringify(verifyResult, null, 2)}
								</pre>
							) : null}
						</div>
					) : (
						<div style={{ marginTop: 10, fontSize: 12, color: '#94a3b8' }}>좌측 트리에서 노드를 선택하세요.</div>
					)}
				</div>
			</div>
		</div>
	);
}

