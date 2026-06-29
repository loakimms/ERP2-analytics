import React from 'react';
import axios from 'axios';

import type { AiOpsActionItem } from './AiOpsActionTypes';
import type { AiOpsFreshnessMeta } from './AiOpsCommonTypes';

export function formatPercent01(value: number | null | undefined): string {
	const n = Number(value ?? 0);
	if (!Number.isFinite(n) || n <= 0) return '0%';
	return `${Math.round(n * 100)}%`;
}

export function formatPercent100(value: number | null | undefined): string {
	const n = Number(value ?? 0);
	if (!Number.isFinite(n) || n <= 0) return '0점';
	return `${Math.round(n)}점`;
}

export function formatCount(value: number | null | undefined, unit = '건'): string {
	const n = Number(value ?? 0);
	if (!Number.isFinite(n)) return `0${unit}`;
	return `${n.toLocaleString()}${unit}`;
}

export function formatFreshnessSummary(freshness: AiOpsFreshnessMeta | null | undefined): string {
	const parts: string[] = [];
	if (freshness?.health_as_of) parts.push(`판단 ${freshness.health_as_of}`);
	if (freshness?.ads_as_of) parts.push(`광고 ${freshness.ads_as_of}`);
	if (freshness?.sales_as_of) parts.push(`판매 ${freshness.sales_as_of}`);
	if (parts.length === 0) return '신선도 기준일 정보가 아직 없습니다.';
	return parts.join(' / ');
}

export function useAiOpsSnapshotRebuild(
	apiBaseUrl: string,
	onSuccess?: () => Promise<void> | void,
): {
	rebuilding: boolean;
	rebuildMessage: string | null;
	triggerRebuild: () => Promise<void>;
} {
	const [rebuilding, setRebuilding] = React.useState(false);
	const [rebuildMessage, setRebuildMessage] = React.useState<string | null>(null);

	const triggerRebuild = React.useCallback(async (): Promise<void> => {
		setRebuilding(true);
		setRebuildMessage(null);
		try {
			const res = await axios.post(`${apiBaseUrl}/ai/ops/product-health/rebuild`, {});
			const saved = Number((res?.data as any)?.saved ?? 0);
			if (onSuccess) {
				await onSuccess();
			}
			setRebuildMessage(`스냅샷을 재생성했습니다. ${saved.toLocaleString()}개 SKU를 갱신했습니다.`);
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? '스냅샷 재생성에 실패했습니다.';
			setRebuildMessage(String(msg));
		} finally {
			setRebuilding(false);
		}
	}, [apiBaseUrl, onSuccess]);

	return { rebuilding, rebuildMessage, triggerRebuild };
}

export function approvalButtonLabel(item: AiOpsActionItem): string {
	const recommendation = String(item.approval_recommendation || '').trim();
	if (recommendation === 'APPROVE') return '추천 승인';
	if (recommendation === 'REVIEW') return '검토 후 승인';
	return '승인';
}

export function approvalDefaultNote(
	item: AiOpsActionItem,
	status: 'APPROVED' | 'REJECTED' | 'DONE',
): string | null {
	const explicitReason = String(item.approval_recommendation_reason || item.payload?.approval_recommendation_reason || '').trim();
	if (explicitReason) {
		if (status === 'APPROVED') return explicitReason;
		if (status === 'REJECTED') return `추천 결과와 다르게 반려: ${explicitReason}`;
		if (status === 'DONE') return `추천 결과 기반 실행 완료: ${explicitReason}`;
	}
	const title = String(item.payload?.title || item.action_type || '액션').trim();
	if (status === 'APPROVED') return `${title} 승인`;
	if (status === 'REJECTED') return `${title} 반려`;
	if (status === 'DONE') return `${title} 완료`;
	return null;
}
