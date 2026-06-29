import React from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

import { buildAiOpsPathWithActionBucket, buildKeywordInsightsPath, buildPurchaseKeywordsPath } from '../../shared/navigation/analyticsNavigation';
import { labelAiOpsActionBucket } from '../../shared/presentation/analyticsLabels';
import type { AiOpsViewProps } from './AiOpsCommonTypes';
import { AiOpsPageShell, FocusCard, MiniKpiCard } from './AiOpsCenterLayout';
import type { AiOpsTrendInsightsResponse } from './AiOpsTrendTypes';
import { deriveTrendScenario, formatCtrPercent, formatNumber, formatPercentRounded } from './AiOpsTrendUtils';

export function AiOpsTrendsView(props: AiOpsViewProps): JSX.Element {
	const navigate = useNavigate();
	const [keyword, setKeyword] = React.useState('헤어에센스');
	const [loading, setLoading] = React.useState(true);
	const [error, setError] = React.useState<string | null>(null);
	const [data, setData] = React.useState<AiOpsTrendInsightsResponse | null>(null);

	const loadTrendData = React.useCallback(async (nextKeyword?: string): Promise<void> => {
		const targetKeyword = String(nextKeyword || keyword || '').trim() || '헤어에센스';
		const today = new Date();
		const dateTo = today.toISOString().slice(0, 10);
		const from = new Date(today);
		from.setDate(today.getDate() - 29);
		const dateFrom = from.toISOString().slice(0, 10);

		setLoading(true);
		setError(null);
		try {
			const apiBaseUrl = String(props.apiBaseUrl || '').replace(/\/$/, '');
			const res = await axios.get(`${apiBaseUrl}/research/keyword-insights`, {
				params: {
					keyword: targetKeyword,
					date_from: dateFrom,
					date_to: dateTo,
				},
			});
			setData((res?.data as AiOpsTrendInsightsResponse) ?? null);
			setKeyword(targetKeyword);
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? '수요·트렌드 데이터를 불러오지 못했습니다.';
			setError(String(msg));
		} finally {
			setLoading(false);
		}
	}, [props.apiBaseUrl, keyword]);

	React.useEffect(() => {
		void loadTrendData(keyword);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const summary = data?.keywordSummary ?? null;
	const trendPoints = Array.isArray(data?.trend?.estimatedDailySearches?.points) ? data.trend!.estimatedDailySearches!.points! : [];
	const firstSearches = Number(trendPoints[0]?.searches ?? 0);
	const latestSearches = Number(trendPoints[trendPoints.length - 1]?.searches ?? 0);
	const growthRate = firstSearches > 0 ? (latestSearches - firstSearches) / firstSearches : 0;
	const relatedKeywords = Array.isArray(data?.relatedKeywords) ? data.relatedKeywords.slice(0, 5) : [];
	const scenario = deriveTrendScenario(data);
	const keywordInsightsPath = buildKeywordInsightsPath({
		keyword: data?.keyword || keyword,
		fromYmd: data?.date_from,
		toYmd: data?.date_to,
		autoRun: true,
	});
	const purchaseKeywordsPath = buildPurchaseKeywordsPath({
		keyword: data?.keyword || keyword,
	});

	return (
		<AiOpsPageShell
			title="수요·트렌드 판단"
			description="검색량, 구매 키워드, 오가닉 변화를 결합해 수요 모멘텀과 lifecycle을 판단합니다."
		>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
				<MiniKpiCard label="월 검색량" value={formatNumber(summary?.totalSearch)} caption="키워드 인사이트 기준" tone="good" />
				<MiniKpiCard label="최신 일검색 추정" value={formatNumber(latestSearches)} caption="추정 일검색량 최신값" tone="neutral" />
				<MiniKpiCard
					label="증가율"
					value={formatPercentRounded(growthRate)}
					caption="첫 시점 대비 최신 시점"
					tone={growthRate >= 0.15 ? 'good' : growthRate <= -0.1 ? 'bad' : 'warn'}
				/>
			</div>
			<div className="card" style={{ padding: 14 }}>
				<div className="card-title">트렌드 스냅샷</div>
				<div className="card-caption" style={{ marginTop: 6 }}>
					키워드 인사이트 응답을 직접 읽어 현재 수요 상태를 확장/방어/축소 시나리오로 해석합니다.
				</div>
				<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
					<input
						aria-label="trend-keyword-input"
						value={keyword}
						onChange={(event) => setKeyword(event.target.value)}
						placeholder="트렌드를 볼 키워드를 입력하세요"
						style={{
							minWidth: 240,
							borderRadius: 8,
							border: '1px solid rgba(148,163,184,0.22)',
							background: 'rgba(2,6,23,0.5)',
							color: '#e2e8f0',
							padding: '10px 12px',
						}}
					/>
					<button type="button" className="btn-ghost" onClick={() => void loadTrendData(keyword)} disabled={loading}>
						{loading ? '계산 중...' : '트렌드 다시 계산'}
					</button>
					{['헤어에센스', '염색약', '탈모샴푸'].map((preset) => (
						<button key={preset} type="button" className="btn-ghost" onClick={() => void loadTrendData(preset)} disabled={loading}>
							{preset}
						</button>
					))}
				</div>
				{loading ? <div style={{ marginTop: 12, color: '#94a3b8' }}>트렌드 데이터를 불러오는 중...</div> : null}
				{error ? <div style={{ marginTop: 12, color: '#fda4af' }}>{error}</div> : null}
				{!loading && !error ? (
					<div style={{ marginTop: 12, fontSize: 12, color: '#94a3b8' }}>
						{data?.keyword || keyword} 기준 증가율 {formatPercentRounded(growthRate)} / 조회 구간 {data?.date_from || '-'} ~ {data?.date_to || '-'}
					</div>
				) : null}
				{!loading && !error ? (
					<div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 12, marginTop: 12 }}>
						<div
							style={{
								border: '1px solid rgba(148,163,184,0.18)',
								borderRadius: 10,
								padding: 14,
								background: 'rgba(15,23,42,0.35)',
							}}
						>
							<div className="card-title">현재 수요 판단</div>
							<div style={{ marginTop: 8, fontSize: 18, fontWeight: 900, color: '#fcd34d' }}>{scenario.label}</div>
							<div style={{ marginTop: 8, fontSize: 13, color: '#cbd5e1' }}>{scenario.headline}</div>
							<div style={{ marginTop: 10, fontSize: 12, color: '#93c5fd' }}>실행 버킷 {labelAiOpsActionBucket(scenario.bucket)}</div>
							<div style={{ marginTop: 10, fontSize: 12, color: '#94a3b8' }}>
								카테고리 {data?.shopping?.categoryPath || '-'} / 상품수 {formatNumber(summary?.productCount)} / 평균 CTR {formatCtrPercent(summary?.avgCtr)}
							</div>
							<ul style={{ marginTop: 12, paddingLeft: 18, color: '#cbd5e1', fontSize: 13 }}>
								{scenario.bullets.map((bullet) => (
									<li key={bullet} style={{ marginBottom: 6 }}>
										{bullet}
									</li>
								))}
							</ul>
							<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
								<button
									type="button"
									className="btn-ghost"
									onClick={() => navigate(buildAiOpsPathWithActionBucket('/analytics/ai/actions', scenario.bucket))}
								>
									관련 실행 큐 보기
								</button>
								<button
									type="button"
									className="btn-ghost"
									onClick={() => navigate(buildAiOpsPathWithActionBucket('/analytics/ai/logs', scenario.bucket))}
								>
									관련 검증 로그 보기
								</button>
								<button type="button" className="btn-ghost" onClick={() => navigate(keywordInsightsPath)}>
									키워드 인사이트 열기
								</button>
								<button type="button" className="btn-ghost" onClick={() => navigate(purchaseKeywordsPath)}>
									구매 키워드 분석 열기
								</button>
							</div>
						</div>
						<div
							style={{
								border: '1px solid rgba(148,163,184,0.18)',
								borderRadius: 10,
								padding: 14,
								background: 'rgba(15,23,42,0.35)',
							}}
						>
							<div className="card-title">연관 키워드</div>
							<div className="card-caption" style={{ marginTop: 6 }}>
								확장/방어 판단에 바로 참고할 상위 연관 키워드입니다.
							</div>
							{relatedKeywords.length === 0 ? (
								<div style={{ marginTop: 12, color: '#94a3b8' }}>표시할 연관 키워드가 없습니다.</div>
							) : (
								<div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
									{relatedKeywords.map((item, index) => (
										<div key={`${String(item.relKeyword || '')}:${index}`} style={{ padding: 10, borderRadius: 8, background: 'rgba(2,6,23,0.45)' }}>
											<div style={{ fontWeight: 800 }}>{item.relKeyword || '-'}</div>
											<div style={{ marginTop: 4, fontSize: 12, color: '#94a3b8' }}>
												총검색량 {formatNumber(item.totalSearchQcCnt)} / 평균 CTR {formatCtrPercent(item.avgCtr)}
											</div>
										</div>
									))}
								</div>
							)}
						</div>
					</div>
				) : null}
			</div>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
				<FocusCard
					title="즉시 확인 경로"
					description="트렌드 판단은 별도 원천 화면을 버리지 않고, 기존 사실 확인 화면을 source-of-truth로 사용합니다."
					bullets={[
						'검색량과 오가닉 변화는 키워드 인사이트 화면에서 확인합니다.',
						'구매 수요 변화는 구매 키워드 분석과 판매 판단을 함께 봅니다.',
						'광고 확대/축소 여부는 광고 운영 판단과 실행 큐에서 최종 결정합니다.',
					]}
					links={[
						{ label: '키워드 인사이트 열기', path: keywordInsightsPath },
						{ label: '구매 키워드 분석 열기', path: purchaseKeywordsPath },
						{ label: '광고 운영 판단 열기', path: '/analytics/ai/ads' },
					]}
				/>
				<FocusCard
					title="다음 데이터 결합 목표"
					description="다음 단계에서는 Datalab/구매 키워드/오가닉 변화를 한 화면에서 정량 비교하도록 확장합니다."
					bullets={[
						'상승률, 구매전환률, 오가닉 강도 변화를 한 SKU 카드에 통합합니다.',
						'수요 lifecycle에 따라 확장/방어/축소 버킷을 자동 분류합니다.',
						'트렌드 변화가 실행 큐와 검증 로그로 바로 이어지도록 연결합니다.',
					]}
					links={[
						{ label: '실행 큐 열기', path: '/analytics/ai/actions' },
						{ label: '검증 로그 열기', path: '/analytics/ai/logs' },
						{ label: 'SKU 정책 센터 열기', path: '/analytics/ai/policies' },
					]}
				/>
			</div>
		</AiOpsPageShell>
	);
}
