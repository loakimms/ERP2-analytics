import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';

type A1Thresholds = {
	uncertain: { min_valid_days_14d: number; missing_rank_value: number };
	stable: { avg_rank_14d_max: number; rank_volatility_14d_max: number; down_days_14d_max: number };
	unstable: {
		avg_rank_14d_min: number;
		avg_rank_14d_max: number;
		rank_volatility_14d_min: number;
		drop_7d_min: number;
		drop_delta_min: number;
	};
	weak: { avg_rank_14d_min: number; improve_days_7d_eq: number };
};

type A1SurfaceConfig = { page1: { organic_slots: number; ad_slots: number } };
type A1PromptTemplates = { inputs_json: string; outputs_template: string };
type AiOpsGrowthThresholds = {
	organic_strength_min: number;
	sales_growth_min: number;
	review_risk_max: number;
	qna_barrier_max: number;
};
type AiOpsDefenseThresholds = { organic_strength_max: number };
type AiOpsRuleScope = { mall_names: string[] };
type AiOpsThresholds = {
	qna_barrier_high: number;
	review_risk_high: number;
	growth: AiOpsGrowthThresholds;
	defense: AiOpsDefenseThresholds;
};
type AiOpsRuleConfigV2 = { scope: AiOpsRuleScope; thresholds: AiOpsThresholds };

type A1RuleConfigV2 = {
	surfaces: Record<string, A1SurfaceConfig>;
	thresholds: A1Thresholds;
	prompt_templates: A1PromptTemplates;
	// 확장: “중요 숫자”를 UI에서 조정할 수 있게 dict 형태로 보관(백엔드는 그대로 저장)
	sku_strategy?: any;
	quality_targets?: any;
};

type AiRulePackV2 = { id: string; enabled: boolean; title: string; a1?: A1RuleConfigV2; ai_ops?: AiOpsRuleConfigV2 };
type AiSettingsV2 = { format_version: 'v2'; common_rules: string; rule_packs: AiRulePackV2[] };

function createDefaultA1Pack(): AiRulePackV2 {
	return {
		id: 'A-1',
		enabled: true,
		title: 'A-1 오가닉 자동화(규칙 v2)',
		a1: {
			surfaces: a1DefaultSurfaces(),
			thresholds: a1DefaultThresholds(),
			prompt_templates: { inputs_json: '', outputs_template: '' },
			sku_strategy: a1DefaultSkuStrategy(),
			quality_targets: a1DefaultQualityTargets(),
		},
	};
}

function createDefaultAiOpsPack(id = 'AI_OPS', title = 'AI Ops 정책 엔진'): AiRulePackV2 {
	return {
		id,
		enabled: true,
		title,
		ai_ops: {
			scope: aiOpsDefaultScope(),
			thresholds: aiOpsDefaultThresholds(),
		},
	};
}

function a1DefaultThresholds(): A1Thresholds {
	return {
		uncertain: { min_valid_days_14d: 7, missing_rank_value: 999 },
		stable: { avg_rank_14d_max: 3.0, rank_volatility_14d_max: 1.2, down_days_14d_max: 2 },
		unstable: { avg_rank_14d_min: 4.0, avg_rank_14d_max: 10.0, rank_volatility_14d_min: 2.0, drop_7d_min: 3, drop_delta_min: 3 },
		weak: { avg_rank_14d_min: 11.0, improve_days_7d_eq: 0 },
	};
}

function a1DefaultSurfaces(): Record<string, A1SurfaceConfig> {
	return {
		mobile_integrated: { page1: { organic_slots: 10, ad_slots: 4 } },
		pc_integrated: { page1: { organic_slots: 10, ad_slots: 4 } },
	};
}

function a1DefaultSkuStrategy(): any {
	return {
		rank_targets_by_state: {
			STABLE: { target_avg_rank_14d_max: 3.0 },
			UNSTABLE: { target_avg_rank_14d_max: 6.0 },
			WEAK: { target_avg_rank_14d_max: 10.0 },
			UNCERTAIN: { target_avg_rank_14d_max: 999 },
		},
		sku_strategy: {
			brand_organic_product: { min_top1_3_kw_cnt: 2, min_top7_10_kw_cnt: 0 },
			main_ad_revenue_product: { min_ad_revenue_30d: 1000000 },
			sub_ad_revenue_product: { min_ad_revenue_30d: 300000 },
		},
	};
}

function a1DefaultQualityTargets(): any {
	return {
		ad_quality_index_min: 3.5,
		ad_quality_index_increase_min: 0.2,
		organic_quality_index_min: 3.5,
		organic_quality_index_increase_min: 0.2,
	};
}

function aiOpsDefaultThresholds(): AiOpsThresholds {
	return {
		qna_barrier_high: 70,
		review_risk_high: 65,
		growth: {
			organic_strength_min: 80,
			sales_growth_min: 60,
			review_risk_max: 45,
			qna_barrier_max: 45,
		},
		defense: {
			organic_strength_max: 55,
		},
	};
}

function aiOpsDefaultScope(): AiOpsRuleScope {
	return {
		mall_names: [],
	};
}

function defaultSettingsV2(): AiSettingsV2 {
	return {
		format_version: 'v2',
		common_rules: '',
		rule_packs: [createDefaultA1Pack(), createDefaultAiOpsPack()],
	};
}

function normalizeSettings(raw: any): AiSettingsV2 {
	const base = defaultSettingsV2();
	const o = raw || {};
	const common_rules = String(o.common_rules ?? '');
	const packs0: any[] = Array.isArray(o.rule_packs) ? o.rule_packs : [];
	const packs: AiRulePackV2[] = packs0
		.map((p) => {
			const id = String(p?.id ?? '').trim();
			if (!id) return null;
			const enabled = Boolean(p?.enabled ?? true);
			const title = String(p?.title ?? '');
			const out: AiRulePackV2 = { id, enabled, title };
			if (String(id).toUpperCase().replace(/\s+/g, '').replace(/[_-]/g, '') === 'A1') {
				const a1 = p?.a1 && typeof p.a1 === 'object' ? p.a1 : {};
				out.a1 = {
					surfaces: { ...a1DefaultSurfaces(), ...(a1?.surfaces || {}) },
					thresholds: { ...a1DefaultThresholds(), ...(a1?.thresholds || {}) },
					prompt_templates: {
						inputs_json: String(a1?.prompt_templates?.inputs_json ?? ''),
						outputs_template: String(a1?.prompt_templates?.outputs_template ?? ''),
					},
					sku_strategy: a1?.sku_strategy && typeof a1.sku_strategy === 'object' ? a1.sku_strategy : a1DefaultSkuStrategy(),
					quality_targets: a1?.quality_targets && typeof a1.quality_targets === 'object' ? a1.quality_targets : a1DefaultQualityTargets(),
				};
			}
			if (p?.ai_ops && typeof p.ai_ops === 'object') {
				const aiOps = p?.ai_ops && typeof p.ai_ops === 'object' ? p.ai_ops : {};
				out.ai_ops = {
					scope: {
						mall_names: Array.isArray(aiOps?.scope?.mall_names)
							? aiOps.scope.mall_names.map((item: any) => String(item ?? '').trim()).filter(Boolean)
							: aiOpsDefaultScope().mall_names,
					},
					thresholds: {
						...aiOpsDefaultThresholds(),
						...(aiOps?.thresholds || {}),
						growth: { ...aiOpsDefaultThresholds().growth, ...(aiOps?.thresholds?.growth || {}) },
						defense: { ...aiOpsDefaultThresholds().defense, ...(aiOps?.thresholds?.defense || {}) },
					},
				};
			}
			return out;
		})
		.filter(Boolean) as AiRulePackV2[];

	if (!packs.some((p) => String(p.id).toUpperCase().replace(/\s+/g, '').replace(/[_-]/g, '') === 'A1')) {
		packs.unshift(createDefaultA1Pack());
	}
	if (!packs.some((p) => p.ai_ops && typeof p.ai_ops === 'object')) {
		packs.push(createDefaultAiOpsPack());
	}

	return { format_version: 'v2', common_rules, rule_packs: packs };
}

function getA1Pack(settings: AiSettingsV2): { pack: AiRulePackV2; idx: number } {
	const idx = settings.rule_packs.findIndex((p) => String(p.id).toUpperCase().replace(/\s+/g, '').replace(/[_-]/g, '') === 'A1');
	const pack = idx >= 0 ? settings.rule_packs[idx] : null;
	if (pack) return { pack, idx };
	return { pack: createDefaultA1Pack(), idx: -1 };
}

function getAiOpsPacks(settings: AiSettingsV2): Array<{ pack: AiRulePackV2; idx: number }> {
	const items = settings.rule_packs
		.map((pack, idx) => ({ pack, idx }))
		.filter(({ pack }) => pack.ai_ops && typeof pack.ai_ops === 'object');
	if (items.length > 0) return items;
	const fallback = createDefaultAiOpsPack();
	return [{ pack: fallback, idx: -1 }];
}

export function AiSettingsView(props: { apiBaseUrl: string }): JSX.Element {
	const apiBaseUrl = props.apiBaseUrl;
	const [tab, setTab] = useState<'common' | 'a1' | 'ai_ops'>('common');
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [restoring, setRestoring] = useState(false);
	const [backupOpen, setBackupOpen] = useState(false);
	const [backupLoading, setBackupLoading] = useState(false);
	const [backupItems, setBackupItems] = useState<Array<{ key: string; updated_at: string; len: number }>>([]);
	const [selectedBackupKey, setSelectedBackupKey] = useState<string>('');
	const [toast, setToast] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const [settings, setSettings] = useState<AiSettingsV2>(defaultSettingsV2());
	const [selectedAiOpsPackId, setSelectedAiOpsPackId] = useState<string>('AI_OPS');
	const [showAdvancedSkuStrategy, setShowAdvancedSkuStrategy] = useState(false);
	const [showAdvancedQualityTargets, setShowAdvancedQualityTargets] = useState(false);

	useEffect(() => {
		if (!toast) return;
		const t = window.setTimeout(() => setToast(null), 4500);
		return () => window.clearTimeout(t);
	}, [toast]);

	const { pack: a1Pack } = useMemo(() => getA1Pack(settings), [settings]);
	const aiOpsPacks = useMemo(() => getAiOpsPacks(settings), [settings]);
	const aiOpsPack = useMemo(() => {
		return aiOpsPacks.find(({ pack }) => String(pack.id) === selectedAiOpsPackId)?.pack || aiOpsPacks[0]?.pack || createDefaultAiOpsPack();
	}, [aiOpsPacks, selectedAiOpsPackId]);
	useEffect(() => {
		if (!aiOpsPacks.some(({ pack }) => String(pack.id) === selectedAiOpsPackId)) {
			setSelectedAiOpsPackId(String(aiOpsPacks[0]?.pack?.id || 'AI_OPS'));
		}
	}, [aiOpsPacks, selectedAiOpsPackId]);
	const a1 = (a1Pack.a1 || createDefaultA1Pack().a1!) as A1RuleConfigV2;
	const aiOps = (aiOpsPack.ai_ops || { scope: aiOpsDefaultScope(), thresholds: aiOpsDefaultThresholds() }) as AiOpsRuleConfigV2;
	const skuStrategy: any = a1.sku_strategy && typeof a1.sku_strategy === 'object' ? a1.sku_strategy : a1DefaultSkuStrategy();
	const qualityTargets: any = a1.quality_targets && typeof a1.quality_targets === 'object' ? a1.quality_targets : a1DefaultQualityTargets();

	const num = (v: any, fallback: number): number => {
		const n = Number(v);
		return Number.isFinite(n) ? n : fallback;
	};
	const intn = (v: any, fallback: number): number => {
		const n = Math.trunc(Number(v));
		return Number.isFinite(n) ? n : fallback;
	};

	const setA1 = (next: Partial<A1RuleConfigV2>) => {
		setSettings((prev) => {
			const { idx } = getA1Pack(prev);
			const packs = [...prev.rule_packs];
			const cur = idx >= 0 ? packs[idx] : createDefaultA1Pack();
			if (!cur) return prev;
			const curA1 = (cur.a1 || createDefaultA1Pack().a1!) as A1RuleConfigV2;
			const nextPack: AiRulePackV2 = { ...cur, a1: { ...curA1, ...next } };
			if (idx >= 0) packs[idx] = nextPack;
			else packs.unshift(nextPack);
			return { ...prev, rule_packs: packs };
		});
	};

	const setAiOpsPack = (packId: string, next: Partial<AiOpsRuleConfigV2>) => {
		setSettings((prev) => {
			const idx = prev.rule_packs.findIndex((pack) => String(pack.id) === String(packId));
			const packs = [...prev.rule_packs];
			const cur = idx >= 0 ? packs[idx] : createDefaultAiOpsPack(packId, packId);
			if (!cur) return prev;
			const curAiOps = (cur.ai_ops || { scope: aiOpsDefaultScope(), thresholds: aiOpsDefaultThresholds() }) as AiOpsRuleConfigV2;
			const nextPack: AiRulePackV2 = { ...cur, ai_ops: { ...curAiOps, ...next } };
			if (idx >= 0) packs[idx] = nextPack;
			else packs.push(nextPack);
			return { ...prev, rule_packs: packs };
		});
	};

	const updateA1ThresholdField = (group: keyof A1Thresholds, field: string, raw: string, opts?: { integer?: boolean }) => {
		const v0 = raw === '' ? NaN : Number(raw);
		if (!Number.isFinite(v0)) return;
		const v = opts?.integer ? Math.trunc(v0) : v0;
		setA1({
			thresholds: {
				...a1.thresholds,
				[group]: { ...(a1.thresholds as any)[group], [field]: v },
			} as any,
		});
	};

	const updateAiOpsThresholdField = (packId: string, path: string[], raw: string) => {
		const v0 = raw === '' ? NaN : Number(raw);
		if (!Number.isFinite(v0)) return;
		const targetPack = aiOpsPacks.find(({ pack }) => String(pack.id) === String(packId))?.pack;
		const next = JSON.parse(JSON.stringify(targetPack?.ai_ops?.thresholds || aiOpsDefaultThresholds()));
		let cur: any = next;
		for (let i = 0; i < path.length - 1; i++) {
			const key = path[i];
			if (!key) return;
			if (!cur[key] || typeof cur[key] !== 'object') cur[key] = {};
			cur = cur[key];
		}
		const leafKey = path[path.length - 1];
		if (!leafKey) return;
		cur[leafKey] = Number(v0);
		setAiOpsPack(packId, { thresholds: next });
	};

	const updateAiOpsScopeMallNames = (packId: string, raw: string) => {
		const mallNames = String(raw || '')
			.split(',')
			.map((item) => item.trim())
			.filter(Boolean);
		const targetPack = aiOpsPacks.find(({ pack }) => String(pack.id) === String(packId))?.pack;
		setAiOpsPack(packId, {
			scope: {
				...(targetPack?.ai_ops?.scope || aiOpsDefaultScope()),
				mall_names: mallNames,
			},
		});
	};

	const addAiOpsPack = () => {
		const newId = `AI_OPS_SCOPE_${aiOpsPacks.length + 1}`;
		setSelectedAiOpsPackId(newId);
		setSettings((prev) => {
			return {
				...prev,
				rule_packs: [
					...prev.rule_packs,
					createDefaultAiOpsPack(newId, `AI Ops 정책팩 ${aiOpsPacks.length + 1}`),
				],
			};
		});
	};

	const removeAiOpsPack = (packId: string) => {
		if (String(packId) === 'AI_OPS') return;
		setSettings((prev) => ({
			...prev,
			rule_packs: prev.rule_packs.filter((pack) => String(pack.id) !== String(packId)),
		}));
	};

	const updateSurfaceSlots = (surfaceId: string, field: 'organic_slots' | 'ad_slots', raw: string) => {
		const v0 = raw === '' ? NaN : Number(raw);
		if (!Number.isFinite(v0)) return;
		const v = Math.max(0, Math.trunc(v0));
		const cur = a1.surfaces?.[surfaceId] ?? { page1: { organic_slots: 10, ad_slots: 4 } };
		setA1({
			surfaces: {
				...a1.surfaces,
				[surfaceId]: { ...cur, page1: { ...cur.page1, [field]: v } },
			},
		});
	};

	const updateSkuStrategyField = (path: string[], raw: string, opts?: { integer?: boolean }) => {
		const v0 = raw === '' ? NaN : Number(raw);
		if (!Number.isFinite(v0)) return;
		const v = opts?.integer ? Math.trunc(v0) : v0;
		const next = JSON.parse(JSON.stringify(skuStrategy || {}));
		let cur: any = next;
		for (let i = 0; i < path.length - 1; i++) {
			const k = path[i];
			if (!k) return;
			if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
			cur = cur[k];
		}
		const leafKey = path[path.length - 1];
		if (!leafKey) return;
		cur[leafKey] = v;
		setA1({ sku_strategy: next });
	};

	const updateQualityTargetField = (key: string, raw: string) => {
		const v0 = raw === '' ? NaN : Number(raw);
		if (!Number.isFinite(v0)) return;
		const v = Number(v0);
		const next = { ...(qualityTargets || {}) };
		next[key] = v;
		setA1({ quality_targets: next });
	};

	const load = async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await axios.get(`${apiBaseUrl}/settings/ai`);
			setSettings(normalizeSettings(res.data));
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? '불러오기에 실패했습니다.';
			setError(String(msg));
		} finally {
			setLoading(false);
		}
	};

	const save = async () => {
		setSaving(true);
		setError(null);
		try {
			await axios.put(`${apiBaseUrl}/settings/ai`, settings);
			setToast('저장 완료');
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? '저장에 실패했습니다.';
			setError(String(msg));
		} finally {
			setSaving(false);
		}
	};

	const downloadJson = () => {
		try {
			const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json;charset=utf-8' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `ai-settings-${new Date().toISOString().slice(0, 10)}.json`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
			setToast('AI 세팅 JSON을 다운로드했습니다.');
		} catch (e: any) {
			setError(String(e?.message ?? e ?? '내보내기 실패'));
		}
	};

	const importJsonFile = async (file: File) => {
		setSaving(true);
		setError(null);
		try {
			const text = await file.text();
			const obj = JSON.parse(text || '{}');
			const next = normalizeSettings(obj);
			await axios.put(`${apiBaseUrl}/settings/ai`, next);
			await load();
			setToast('AI 세팅 JSON을 가져왔습니다.');
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? '가져오기에 실패했습니다.';
			setError(String(msg));
		} finally {
			setSaving(false);
		}
	};

	const openBackups = async () => {
		setBackupOpen(true);
		setBackupLoading(true);
		setError(null);
		try {
			const res = await axios.get(`${apiBaseUrl}/settings/ai/backups`, { params: { limit: 30 } });
			const items = Array.isArray((res as any)?.data?.items) ? ((res as any).data.items as any[]) : [];
			const mapped = items
				.map((x) => ({
					key: String(x?.key ?? ''),
					updated_at: String(x?.updated_at ?? ''),
					len: Number(x?.len ?? 0) || 0,
				}))
				.filter((x) => x.key);
			setBackupItems(mapped);
			setSelectedBackupKey(mapped[0]?.key ?? '');
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? '백업 목록을 불러오지 못했습니다.';
			setError(String(msg));
		} finally {
			setBackupLoading(false);
		}
	};

	const restoreBackup = async () => {
		if (!selectedBackupKey) return;
		setRestoring(true);
		setError(null);
		try {
			const res = await axios.post(`${apiBaseUrl}/settings/ai/restore-backup`, null, { params: { key: selectedBackupKey } });
			const restored = Boolean((res as any)?.data?.restored);
			if (!restored) {
				setError('선택한 백업으로 복구하지 못했습니다.');
				return;
			}
			await load();
			setToast('백업 스냅샷으로 AI 세팅을 복구했습니다.');
			setBackupOpen(false);
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? '백업 복구에 실패했습니다.';
			setError(String(msg));
		} finally {
			setRestoring(false);
		}
	};

	const restoreLatest = async () => {
		setRestoring(true);
		setError(null);
		try {
			const res = await axios.post(`${apiBaseUrl}/settings/ai/restore-latest`);
			const ok = Boolean((res as any)?.data?.ok);
			const restored = Boolean((res as any)?.data?.restored);
			const source = String((res as any)?.data?.source ?? '');
			const clen = Number((res as any)?.data?.current_common_len ?? 0);
			const rcnt = Number((res as any)?.data?.current_rules_count ?? 0);
			if (!ok) {
				setError('복구에 실패했습니다.');
				return;
			}
			if (!restored) {
				try {
					const st = await axios.get(`${apiBaseUrl}/settings/ai/status`);
					const exists = Boolean((st as any)?.data?.latest_a1_log_exists);
					setError(exists ? '복구에 실패했습니다. (서버 로그에서 규칙 스냅샷을 찾지 못함)' : '복구할 로그가 없습니다. (A-1 분석 실행 후 다시 시도)');
				} catch {
					setError('복구할 로그가 없습니다. (A-1 분석 실행 후 다시 시도)');
				}
				return;
			}
			await load();
			setToast(`복구 완료(${source || 'unknown'}): 공통규칙 ${Number.isFinite(clen) ? clen : 0}자 · 규칙 ${Number.isFinite(rcnt) ? rcnt : 0}개`);
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? '복구에 실패했습니다.';
			setError(String(msg));
		} finally {
			setRestoring(false);
		}
	};

	useEffect(() => {
		load();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [apiBaseUrl]);

	return (
		<div style={{ display: 'grid', gap: 14 }}>
			<div className="card">
				<div className="card-title">AI 세팅</div>
				<div className="card-caption">A-1 자동화와 AI Ops 정책 판단의 기준 숫자(임계값)를 구조화(v2)로 저장/조정합니다.</div>
				<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
					{toast ? <span style={{ fontSize: 12, fontWeight: 900, color: '#bbf7d0' }}>{toast}</span> : null}
					{error ? <span style={{ fontSize: 12, fontWeight: 900, color: '#fda4af' }}>{error}</span> : null}
					<div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
						<input
							type="file"
							accept="application/json,.json"
							style={{ display: 'none' }}
							id="ai-settings-import"
							onChange={async (e) => {
								const f = e.target.files?.[0];
								try {
									e.currentTarget.value = '';
								} catch {}
								if (!f) return;
								await importJsonFile(f);
							}}
						/>
						<button type="button" className="btn-ghost" onClick={downloadJson} disabled={loading || saving || restoring}>
							내보내기
						</button>
						<button type="button" className="btn-ghost" onClick={() => document.getElementById('ai-settings-import')?.click()} disabled={loading || saving || restoring}>
							가져오기
						</button>
						<button type="button" className="btn-ghost" onClick={openBackups} disabled={loading || saving || restoring}>
							백업 목록
						</button>
						<button type="button" className="btn-ghost" onClick={restoreLatest} disabled={loading || saving || restoring}>
							{restoring ? '복구 중…' : '최근 로그로 복구'}
						</button>
						<button type="button" className="btn-ghost" onClick={load} disabled={loading || saving}>
							{loading ? '불러오는 중…' : '불러오기'}
						</button>
						<button type="button" className="btn-primary" onClick={save} disabled={loading || saving}>
							{saving ? '저장 중…' : '저장'}
						</button>
					</div>
				</div>
			</div>

			{backupOpen ? (
				<div className="card">
					<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
						<div>
							<div className="card-title" style={{ margin: 0 }}>
								AI 세팅 백업 스냅샷
							</div>
							<div className="card-caption">“저장” 시 자동으로 남긴 과거 스냅샷 목록입니다.</div>
						</div>
						<button type="button" className="btn-ghost" onClick={() => setBackupOpen(false)}>
							닫기
						</button>
					</div>
					<div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
						{backupLoading ? (
							<div style={{ fontSize: 12, color: '#94a3b8' }}>불러오는 중…</div>
						) : backupItems.length === 0 ? (
							<div style={{ fontSize: 12, color: '#94a3b8' }}>백업이 없습니다.</div>
						) : (
							<>
								<select className="input" value={selectedBackupKey} onChange={(e) => setSelectedBackupKey(e.target.value)}>
									{backupItems.map((b) => (
										<option key={b.key} value={b.key}>
											{b.updated_at || b.key} · {b.len.toLocaleString()}B
										</option>
									))}
								</select>
								<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
									<button type="button" className="btn-primary" onClick={restoreBackup} disabled={restoring || !selectedBackupKey}>
										{restoring ? '복구 중…' : '선택 백업으로 복구'}
									</button>
								</div>
							</>
						)}
					</div>
				</div>
			) : null}

			<div className="card" style={{ padding: 0 }}>
				<div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(148,163,184,0.12)' }}>
					<button type="button" className="btn-ghost" onClick={() => setTab('common')} style={{ borderRadius: 0, padding: '10px 12px', fontWeight: 900, color: tab === 'common' ? '#e2e8f0' : '#94a3b8' }}>
						공통 규칙
					</button>
					<button type="button" className="btn-ghost" onClick={() => setTab('a1')} style={{ borderRadius: 0, padding: '10px 12px', fontWeight: 900, color: tab === 'a1' ? '#e2e8f0' : '#94a3b8' }}>
						A-1 규칙(숫자 조정)
					</button>
					<button type="button" className="btn-ghost" onClick={() => setTab('ai_ops')} style={{ borderRadius: 0, padding: '10px 12px', fontWeight: 900, color: tab === 'ai_ops' ? '#e2e8f0' : '#94a3b8' }}>
						AI Ops 정책 기준
					</button>
				</div>

				<div style={{ padding: 12 }}>
					{tab === 'common' ? (
						<div style={{ display: 'grid', gap: 8 }}>
							<div className="field-label">공통 규칙(마크다운/텍스트)</div>
							<textarea className="input" style={{ minHeight: 320, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }} value={settings.common_rules} onChange={(e) => setSettings((prev) => ({ ...prev, common_rules: e.target.value }))} />
						</div>
					) : tab === 'a1' ? (
						<div style={{ display: 'grid', gap: 12 }}>
							<div className="card" style={{ padding: 10 }}>
								<div className="card-title" style={{ margin: 0 }}>
									오가닉/광고 지면 기준(1페이지)
								</div>
								<div className="card-caption" style={{ margin: 0 }}>
									네이버 통합검색 MO/PC 지면별 “1페이지 슬롯 수(오가닉/광고)”를 조정합니다.
								</div>
								<div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
									{(['mobile_integrated', 'pc_integrated'] as const).map((sid) => (
										<div key={sid} className="card" style={{ padding: 10 }}>
											<div className="field-label">{sid === 'mobile_integrated' ? 'MO(모바일 통합검색)' : 'PC(PC 통합검색)'}</div>
											<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
												<div style={{ display: 'grid', gap: 4 }}>
													<div className="field-label">오가닉 지면수</div>
													<input className="input" type="number" step="1" value={a1.surfaces?.[sid]?.page1?.organic_slots ?? 10} onChange={(e) => updateSurfaceSlots(sid, 'organic_slots', e.target.value)} />
												</div>
												<div style={{ display: 'grid', gap: 4 }}>
													<div className="field-label">광고 지면수</div>
													<input className="input" type="number" step="1" value={a1.surfaces?.[sid]?.page1?.ad_slots ?? 4} onChange={(e) => updateSurfaceSlots(sid, 'ad_slots', e.target.value)} />
												</div>
											</div>
										</div>
									))}
								</div>
							</div>

							<div className="card" style={{ padding: 10 }}>
								<div className="card-title" style={{ margin: 0 }}>
									SKU 상태(단계)별 오가닉 기준(임계값)
								</div>
								<div className="card-caption" style={{ margin: 0 }}>
									상태 판정에 쓰이는 핵심 숫자입니다. (A-1 단건/포트폴리오/배치가 동일 기준을 사용)
								</div>

								<div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
									<div className="card" style={{ padding: 10 }}>
										<div className="field-label">STABLE(안정)</div>
										<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
											<div style={{ display: 'grid', gap: 4 }}>
												<div className="field-label">14일 평균 순위(최대)</div>
												<input className="input" type="number" step="0.1" aria-label="a1.stable.avg_rank_14d_max" value={a1.thresholds.stable.avg_rank_14d_max} onChange={(e) => updateA1ThresholdField('stable', 'avg_rank_14d_max', e.target.value)} />
											</div>
											<div style={{ display: 'grid', gap: 4 }}>
												<div className="field-label">14일 변동성(최대)</div>
												<input className="input" type="number" step="0.1" aria-label="a1.stable.rank_volatility_14d_max" value={a1.thresholds.stable.rank_volatility_14d_max} onChange={(e) => updateA1ThresholdField('stable', 'rank_volatility_14d_max', e.target.value)} />
											</div>
											<div style={{ display: 'grid', gap: 4 }}>
												<div className="field-label">14일 악화일(최대)</div>
												<input className="input" type="number" step="1" aria-label="a1.stable.down_days_14d_max" value={a1.thresholds.stable.down_days_14d_max} onChange={(e) => updateA1ThresholdField('stable', 'down_days_14d_max', e.target.value, { integer: true })} />
											</div>
										</div>
									</div>

									<div className="card" style={{ padding: 10 }}>
										<div className="field-label">UNSTABLE(불안정)</div>
										<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
											<div style={{ display: 'grid', gap: 4 }}>
												<div className="field-label">14일 평균 순위(최소)</div>
												<input className="input" type="number" step="0.1" aria-label="a1.unstable.avg_rank_14d_min" value={a1.thresholds.unstable.avg_rank_14d_min} onChange={(e) => updateA1ThresholdField('unstable', 'avg_rank_14d_min', e.target.value)} />
											</div>
											<div style={{ display: 'grid', gap: 4 }}>
												<div className="field-label">14일 평균 순위(최대)</div>
												<input className="input" type="number" step="0.1" aria-label="a1.unstable.avg_rank_14d_max" value={a1.thresholds.unstable.avg_rank_14d_max} onChange={(e) => updateA1ThresholdField('unstable', 'avg_rank_14d_max', e.target.value)} />
											</div>
											<div style={{ display: 'grid', gap: 4 }}>
												<div className="field-label">14일 변동성(최소)</div>
												<input className="input" type="number" step="0.1" aria-label="a1.unstable.rank_volatility_14d_min" value={a1.thresholds.unstable.rank_volatility_14d_min} onChange={(e) => updateA1ThresholdField('unstable', 'rank_volatility_14d_min', e.target.value)} />
											</div>
											<div style={{ display: 'grid', gap: 4 }}>
												<div className="field-label">7일 급락일(최소)</div>
												<input className="input" type="number" step="1" aria-label="a1.unstable.drop_7d_min" value={a1.thresholds.unstable.drop_7d_min} onChange={(e) => updateA1ThresholdField('unstable', 'drop_7d_min', e.target.value, { integer: true })} />
											</div>
											<div style={{ display: 'grid', gap: 4 }}>
												<div className="field-label">급락 판정 Δ(최소)</div>
												<input className="input" type="number" step="1" aria-label="a1.unstable.drop_delta_min" value={a1.thresholds.unstable.drop_delta_min} onChange={(e) => updateA1ThresholdField('unstable', 'drop_delta_min', e.target.value, { integer: true })} />
											</div>
										</div>
									</div>

									<div className="card" style={{ padding: 10 }}>
										<div className="field-label">WEAK(취약)</div>
										<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
											<div style={{ display: 'grid', gap: 4 }}>
												<div className="field-label">14일 평균 순위(최소)</div>
												<input className="input" type="number" step="0.1" aria-label="a1.weak.avg_rank_14d_min" value={a1.thresholds.weak.avg_rank_14d_min} onChange={(e) => updateA1ThresholdField('weak', 'avg_rank_14d_min', e.target.value)} />
											</div>
											<div style={{ display: 'grid', gap: 4 }}>
												<div className="field-label">7일 개선일(=)</div>
												<input className="input" type="number" step="1" aria-label="a1.weak.improve_days_7d_eq" value={a1.thresholds.weak.improve_days_7d_eq} onChange={(e) => updateA1ThresholdField('weak', 'improve_days_7d_eq', e.target.value, { integer: true })} />
											</div>
										</div>
									</div>

									<div className="card" style={{ padding: 10 }}>
										<div className="field-label">UNCERTAIN(불확실)</div>
										<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
											<div style={{ display: 'grid', gap: 4 }}>
												<div className="field-label">14일 유효 데이터 최소 일수</div>
												<input className="input" type="number" step="1" aria-label="a1.uncertain.min_valid_days_14d" value={a1.thresholds.uncertain.min_valid_days_14d} onChange={(e) => updateA1ThresholdField('uncertain', 'min_valid_days_14d', e.target.value, { integer: true })} />
											</div>
											<div style={{ display: 'grid', gap: 4 }}>
												<div className="field-label">미노출/결측 값</div>
												<input className="input" type="number" step="1" aria-label="a1.uncertain.missing_rank_value" value={a1.thresholds.uncertain.missing_rank_value} onChange={(e) => updateA1ThresholdField('uncertain', 'missing_rank_value', e.target.value, { integer: true })} />
											</div>
										</div>
									</div>
								</div>
							</div>

							<div className="card" style={{ padding: 10 }}>
								<div className="card-title" style={{ margin: 0 }}>
									SKU 전략 / 품질지수(확장 설정)
								</div>
								<div className="card-caption" style={{ margin: 0 }}>
									향후 “SKU 컨디션/광고 품질지수 상승/오가닉 품질지수 상승” 자동화에 쓰일 숫자를 구조화로 저장합니다.
								</div>

								<div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
									<div className="card" style={{ padding: 10 }}>
										<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
											<div className="field-label">SKU 전략 분류(임계값)</div>
											<button type="button" className="btn-ghost" onClick={() => setShowAdvancedSkuStrategy((v) => !v)}>
												{showAdvancedSkuStrategy ? '고급(JSON) 닫기' : '고급(JSON)'}
											</button>
										</div>

										<div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
											<div className="field-label">상태별 목표(예: 평균순위)</div>
											<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
												{(['STABLE', 'UNSTABLE', 'WEAK', 'UNCERTAIN'] as const).map((st) => (
													<div key={st} style={{ display: 'grid', gap: 4 }}>
														<div style={{ fontSize: 12, fontWeight: 900 }}>{st}</div>
														<input
															className="input"
															type="number"
															step="0.1"
															value={num(skuStrategy?.rank_targets_by_state?.[st]?.target_avg_rank_14d_max, st === 'UNCERTAIN' ? 999 : st === 'WEAK' ? 10 : st === 'UNSTABLE' ? 6 : 3)}
															onChange={(e) => updateSkuStrategyField(['rank_targets_by_state', st, 'target_avg_rank_14d_max'], e.target.value)}
														/>
													</div>
												))}
											</div>

											<div className="field-label" style={{ marginTop: 6 }}>
												SKU 전략 타입(예시)
											</div>
											<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
												<div className="card" style={{ padding: 10 }}>
													<div style={{ fontSize: 12, fontWeight: 900 }}>1) 브랜드 오가닉 제품</div>
													<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
														<div style={{ display: 'grid', gap: 4 }}>
															<div className="field-label">Top1~3 키워드 최소</div>
															<input
																className="input"
																type="number"
																step="1"
																value={intn(skuStrategy?.sku_strategy?.brand_organic_product?.min_top1_3_kw_cnt, 2)}
																onChange={(e) => updateSkuStrategyField(['sku_strategy', 'brand_organic_product', 'min_top1_3_kw_cnt'], e.target.value, { integer: true })}
															/>
														</div>
														<div style={{ display: 'grid', gap: 4 }}>
															<div className="field-label">Top7~10 키워드 최소</div>
															<input
																className="input"
																type="number"
																step="1"
																value={intn(skuStrategy?.sku_strategy?.brand_organic_product?.min_top7_10_kw_cnt, 0)}
																onChange={(e) => updateSkuStrategyField(['sku_strategy', 'brand_organic_product', 'min_top7_10_kw_cnt'], e.target.value, { integer: true })}
															/>
														</div>
													</div>
												</div>

												<div className="card" style={{ padding: 10 }}>
													<div style={{ fontSize: 12, fontWeight: 900 }}>2) 주력 광고 매출 제품</div>
													<div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
														<div className="field-label">30일 광고매출 최소</div>
														<input
															className="input"
															type="number"
															step="10000"
															value={intn(skuStrategy?.sku_strategy?.main_ad_revenue_product?.min_ad_revenue_30d, 1000000)}
															onChange={(e) => updateSkuStrategyField(['sku_strategy', 'main_ad_revenue_product', 'min_ad_revenue_30d'], e.target.value, { integer: true })}
														/>
													</div>
													<div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>단위는 “원” 기준(필요 시 변경 가능)</div>
												</div>

												<div className="card" style={{ padding: 10 }}>
													<div style={{ fontSize: 12, fontWeight: 900 }}>3) 보조 광고 매출 제품</div>
													<div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
														<div className="field-label">30일 광고매출 최소</div>
														<input
															className="input"
															type="number"
															step="10000"
															value={intn(skuStrategy?.sku_strategy?.sub_ad_revenue_product?.min_ad_revenue_30d, 300000)}
															onChange={(e) => updateSkuStrategyField(['sku_strategy', 'sub_ad_revenue_product', 'min_ad_revenue_30d'], e.target.value, { integer: true })}
														/>
													</div>
													<div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>단위는 “원” 기준(필요 시 변경 가능)</div>
												</div>
											</div>

											{showAdvancedSkuStrategy ? (
												<div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
													<div className="field-label">고급 편집(JSON)</div>
													<textarea
														className="input"
														style={{ minHeight: 200, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}
														value={JSON.stringify(skuStrategy ?? a1DefaultSkuStrategy(), null, 2)}
														onChange={(e) => {
															try {
																setA1({ sku_strategy: JSON.parse(e.target.value || '{}') });
															} catch {}
														}}
													/>
												</div>
											) : null}
										</div>
									</div>

									<div className="card" style={{ padding: 10 }}>
										<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
											<div className="field-label">품질지수 목표(임계값)</div>
											<button type="button" className="btn-ghost" onClick={() => setShowAdvancedQualityTargets((v) => !v)}>
												{showAdvancedQualityTargets ? '고급(JSON) 닫기' : '고급(JSON)'}
											</button>
										</div>

										<div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
											<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
												<div className="card" style={{ padding: 10 }}>
													<div style={{ fontSize: 12, fontWeight: 900 }}>광고 품질지수</div>
													<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
														<div style={{ display: 'grid', gap: 4 }}>
															<div className="field-label">최소</div>
															<input className="input" type="number" step="0.1" value={num(qualityTargets?.ad_quality_index_min, 3.5)} onChange={(e) => updateQualityTargetField('ad_quality_index_min', e.target.value)} />
														</div>
														<div style={{ display: 'grid', gap: 4 }}>
															<div className="field-label">증가 목표(최소)</div>
															<input className="input" type="number" step="0.1" value={num(qualityTargets?.ad_quality_index_increase_min, 0.2)} onChange={(e) => updateQualityTargetField('ad_quality_index_increase_min', e.target.value)} />
														</div>
													</div>
												</div>

												<div className="card" style={{ padding: 10 }}>
													<div style={{ fontSize: 12, fontWeight: 900 }}>오가닉 품질지수</div>
													<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
														<div style={{ display: 'grid', gap: 4 }}>
															<div className="field-label">최소</div>
															<input className="input" type="number" step="0.1" value={num(qualityTargets?.organic_quality_index_min, 3.5)} onChange={(e) => updateQualityTargetField('organic_quality_index_min', e.target.value)} />
														</div>
														<div style={{ display: 'grid', gap: 4 }}>
															<div className="field-label">증가 목표(최소)</div>
															<input className="input" type="number" step="0.1" value={num(qualityTargets?.organic_quality_index_increase_min, 0.2)} onChange={(e) => updateQualityTargetField('organic_quality_index_increase_min', e.target.value)} />
														</div>
													</div>
												</div>
											</div>

											{showAdvancedQualityTargets ? (
												<div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
													<div className="field-label">고급 편집(JSON)</div>
													<textarea
														className="input"
														style={{ minHeight: 200, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}
														value={JSON.stringify(qualityTargets ?? a1DefaultQualityTargets(), null, 2)}
														onChange={(e) => {
															try {
																setA1({ quality_targets: JSON.parse(e.target.value || '{}') });
															} catch {}
														}}
													/>
												</div>
											) : null}
										</div>
									</div>
								</div>
							</div>

							<div className="card" style={{ padding: 10 }}>
								<div className="card-title" style={{ margin: 0 }}>
									GPT 규칙/출력 템플릿
								</div>
								<div className="card-caption" style={{ margin: 0 }}>
									A-1 단건/포트폴리오/배치의 LLM 메시지에 그대로 포함됩니다.
								</div>
								<div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
									<div style={{ display: 'grid', gap: 6 }}>
										<label className="field-label">inputs_json</label>
										<textarea className="input" style={{ minHeight: 140 }} value={a1.prompt_templates.inputs_json} onChange={(e) => setA1({ prompt_templates: { ...a1.prompt_templates, inputs_json: e.target.value } })} />
									</div>
									<div style={{ display: 'grid', gap: 6 }}>
										<label className="field-label">outputs_template</label>
										<textarea className="input" style={{ minHeight: 140 }} value={a1.prompt_templates.outputs_template} onChange={(e) => setA1({ prompt_templates: { ...a1.prompt_templates, outputs_template: e.target.value } })} />
									</div>
								</div>
							</div>
						</div>
					) : (
						<div style={{ display: 'grid', gap: 12 }}>
							<div className="card" style={{ padding: 10 }}>
								<div className="card-title" style={{ margin: 0 }}>
									AI Ops 정책 임계값
								</div>
								<div className="card-caption" style={{ margin: 0 }}>
									SKU 정책 센터와 상품별 운영 판단에서 사용하는 정책 우선순위 기준입니다. `mall_name` 기준으로 브랜드별 정책팩을 분리할 수 있습니다.
								</div>
								<div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
									<div className="field-label">현재 정책팩</div>
									<select
										className="input"
										style={{ maxWidth: 280 }}
										value={selectedAiOpsPackId}
										onChange={(e) => setSelectedAiOpsPackId(e.target.value)}
									>
										{aiOpsPacks.map(({ pack }) => (
											<option key={pack.id} value={pack.id}>
												{pack.id} · {pack.title || pack.id}
											</option>
										))}
									</select>
									<button type="button" className="btn-ghost" onClick={addAiOpsPack}>
										정책팩 추가
									</button>
									{String(aiOpsPack.id) !== 'AI_OPS' ? (
										<button type="button" className="btn-ghost" onClick={() => removeAiOpsPack(String(aiOpsPack.id))}>
											선택 정책팩 삭제
										</button>
									) : null}
								</div>
								<div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
									<div className="card" style={{ padding: 10 }}>
										<div className="field-label">정책팩 메타</div>
										<div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
											<div style={{ display: 'grid', gap: 4 }}>
												<div className="field-label">정책팩 ID</div>
												<input
													className="input"
													type="text"
													value={String(aiOpsPack.id || '')}
													onChange={(e) => {
														const nextId = e.target.value;
														setSelectedAiOpsPackId(nextId);
														setSettings((prev) => ({
															...prev,
															rule_packs: prev.rule_packs.map((pack) =>
																String(pack.id) === String(aiOpsPack.id) ? { ...pack, id: nextId } : pack,
															),
														}));
													}}
												/>
											</div>
											<div style={{ display: 'grid', gap: 4 }}>
												<div className="field-label">정책팩 제목</div>
												<input
													className="input"
													type="text"
													value={String(aiOpsPack.title || '')}
													onChange={(e) =>
														setSettings((prev) => ({
															...prev,
															rule_packs: prev.rule_packs.map((pack) =>
																String(pack.id) === String(aiOpsPack.id) ? { ...pack, title: e.target.value } : pack,
															),
														}))
													}
												/>
											</div>
											<div style={{ display: 'grid', gap: 4 }}>
												<div className="field-label">적용 mall_name 목록(쉼표 구분)</div>
												<input
													className="input"
													type="text"
													aria-label={String(aiOpsPack.id) === 'AI_OPS' ? 'ai_ops.scope.mall_names' : `ai_ops.pack.${String(aiOpsPack.id)}.scope.mall_names`}
													placeholder="예: 브랜드A몰, 브랜드B몰"
													value={(aiOps.scope?.mall_names || []).join(', ')}
													onChange={(e) => updateAiOpsScopeMallNames(String(aiOpsPack.id), e.target.value)}
												/>
											</div>
											<div style={{ fontSize: 12, color: '#94a3b8' }}>
												비워두면 공통 정책팩으로 동작합니다. 같은 `mall_name`이 있으면 전용 정책팩이 공통 정책팩보다 우선합니다.
											</div>
										</div>
									</div>

									<div className="card" style={{ padding: 10 }}>
										<div className="field-label">즉시 개선 우선 조건</div>
										<div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
											<div style={{ display: 'grid', gap: 4 }}>
												<div className="field-label">Q&A 장벽 점수 기준 이상</div>
												<input
													className="input"
													type="number"
													step="1"
													aria-label={String(aiOpsPack.id) === 'AI_OPS' ? 'ai_ops.qna_barrier_high' : `ai_ops.pack.${String(aiOpsPack.id)}.qna_barrier_high`}
													value={aiOps.thresholds.qna_barrier_high}
													onChange={(e) => updateAiOpsThresholdField(String(aiOpsPack.id), ['qna_barrier_high'], e.target.value)}
												/>
											</div>
											<div style={{ display: 'grid', gap: 4 }}>
												<div className="field-label">리뷰 리스크 점수 기준 이상</div>
												<input
													className="input"
													type="number"
													step="1"
													aria-label={String(aiOpsPack.id) === 'AI_OPS' ? 'ai_ops.review_risk_high' : `ai_ops.pack.${String(aiOpsPack.id)}.review_risk_high`}
													value={aiOps.thresholds.review_risk_high}
													onChange={(e) => updateAiOpsThresholdField(String(aiOpsPack.id), ['review_risk_high'], e.target.value)}
												/>
											</div>
										</div>
									</div>

									<div className="card" style={{ padding: 10 }}>
										<div className="field-label">광고 성장형 조건</div>
										<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
											<div style={{ display: 'grid', gap: 4 }}>
												<div className="field-label">오가닉 강도 최소</div>
												<input className="input" type="number" step="1" aria-label={String(aiOpsPack.id) === 'AI_OPS' ? 'ai_ops.growth.organic_strength_min' : `ai_ops.pack.${String(aiOpsPack.id)}.growth.organic_strength_min`} value={aiOps.thresholds.growth.organic_strength_min} onChange={(e) => updateAiOpsThresholdField(String(aiOpsPack.id), ['growth', 'organic_strength_min'], e.target.value)} />
											</div>
											<div style={{ display: 'grid', gap: 4 }}>
												<div className="field-label">판매 성장 최소</div>
												<input className="input" type="number" step="1" aria-label={String(aiOpsPack.id) === 'AI_OPS' ? 'ai_ops.growth.sales_growth_min' : `ai_ops.pack.${String(aiOpsPack.id)}.growth.sales_growth_min`} value={aiOps.thresholds.growth.sales_growth_min} onChange={(e) => updateAiOpsThresholdField(String(aiOpsPack.id), ['growth', 'sales_growth_min'], e.target.value)} />
											</div>
											<div style={{ display: 'grid', gap: 4 }}>
												<div className="field-label">허용 리뷰 리스크 최대</div>
												<input className="input" type="number" step="1" aria-label={String(aiOpsPack.id) === 'AI_OPS' ? 'ai_ops.growth.review_risk_max' : `ai_ops.pack.${String(aiOpsPack.id)}.growth.review_risk_max`} value={aiOps.thresholds.growth.review_risk_max} onChange={(e) => updateAiOpsThresholdField(String(aiOpsPack.id), ['growth', 'review_risk_max'], e.target.value)} />
											</div>
											<div style={{ display: 'grid', gap: 4 }}>
												<div className="field-label">허용 Q&A 장벽 최대</div>
												<input className="input" type="number" step="1" aria-label={String(aiOpsPack.id) === 'AI_OPS' ? 'ai_ops.growth.qna_barrier_max' : `ai_ops.pack.${String(aiOpsPack.id)}.growth.qna_barrier_max`} value={aiOps.thresholds.growth.qna_barrier_max} onChange={(e) => updateAiOpsThresholdField(String(aiOpsPack.id), ['growth', 'qna_barrier_max'], e.target.value)} />
											</div>
										</div>
									</div>

									<div className="card" style={{ padding: 10 }}>
										<div className="field-label">광고 방어형 조건</div>
										<div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
											<div style={{ display: 'grid', gap: 4 }}>
												<div className="field-label">오가닉 강도 최대</div>
												<input
													className="input"
													type="number"
													step="1"
													aria-label={String(aiOpsPack.id) === 'AI_OPS' ? 'ai_ops.defense.organic_strength_max' : `ai_ops.pack.${String(aiOpsPack.id)}.defense.organic_strength_max`}
													value={aiOps.thresholds.defense.organic_strength_max}
													onChange={(e) => updateAiOpsThresholdField(String(aiOpsPack.id), ['defense', 'organic_strength_max'], e.target.value)}
												/>
											</div>
										</div>
									</div>

									<div className="card" style={{ padding: 10 }}>
										<div className="field-label">운영 해석</div>
										<div style={{ display: 'grid', gap: 8, marginTop: 8, fontSize: 12, color: '#cbd5e1' }}>
											<div>Q&A 장벽이 높으면 `FAQ_CONTENT_IMPROVEMENT`를 우선합니다.</div>
											<div>리뷰 리스크가 높으면 `VOC_IMPROVEMENT_PRIORITY`를 우선합니다.</div>
											<div>오가닉/판매가 기준을 넘고 리스크가 낮으면 `AD_GROWTH`를 선택합니다.</div>
											<div>오가닉 강도가 낮으면 `AD_DEFENSE`로 방어 운영을 선택합니다.</div>
										</div>
									</div>
								</div>
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

