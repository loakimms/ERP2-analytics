import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { SalesDateRangeControls } from '../sales/SalesDateRangeControls';

type TagCloudItem = {
	tag: string;
	tag_ko?: string;
	tag_en?: string;
	display_tag?: string;
	count: number;
	review_count: number;
	qna_count: number;
	positive_count?: number;
	negative_count?: number;
	neutral_count?: number;
	mixed_count?: number;
	sentiment?: 'positive' | 'negative' | 'mixed' | 'neutral' | string;
	sentiment_label?: string;
	weight: number;
};

type TagCloudResponse = {
	ok: boolean;
	date_from: string;
	date_to: string;
	sources: {
		review: boolean;
		qna: boolean;
	};
	source_info: {
		review_rows: number;
		qna_rows: number;
		review_token_count: number;
		qna_token_count: number;
	};
	combined: TagCloudItem[];
	review: TagCloudItem[];
	qna: TagCloudItem[];
};

type Props = {
	apiBaseUrl: string;
};

function toYmd(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

function defaultRange(): { fromYmd: string; toYmd: string } {
	const to = new Date();
	const from = new Date();
	from.setDate(to.getDate() - 29);
	return { fromYmd: toYmd(from), toYmd: toYmd(to) };
}

function formatNumber(value: number): string {
	return new Intl.NumberFormat('ko-KR').format(Number.isFinite(value) ? value : 0);
}

function sourceParam(includeReview: boolean, includeQna: boolean): string {
	if (includeReview && includeQna) return 'all';
	if (includeReview) return 'review';
	if (includeQna) return 'qna';
	return 'all';
}

function tagTone(item: TagCloudItem): { color: string; background: string; border: string } {
	const sentiment = String(item.sentiment || 'neutral').toLowerCase();
	if (sentiment === 'negative') return { color: '#dc2626', background: 'rgba(220,38,38,0.08)', border: 'rgba(220,38,38,0.22)' };
	if (sentiment === 'positive') return { color: '#047857', background: 'rgba(4,120,87,0.08)', border: 'rgba(4,120,87,0.22)' };
	if (sentiment === 'mixed') return { color: '#d97706', background: 'rgba(217,119,6,0.08)', border: 'rgba(217,119,6,0.24)' };
	if (item.review_count > 0 && item.qna_count > 0) return { color: '#1d4ed8', background: 'rgba(29,78,216,0.07)', border: 'rgba(29,78,216,0.18)' };
	if (item.qna_count > 0) return { color: '#7c3aed', background: 'rgba(124,58,237,0.07)', border: 'rgba(124,58,237,0.18)' };
	return { color: '#0f766e', background: 'rgba(15,118,110,0.07)', border: 'rgba(15,118,110,0.18)' };
}

function TagCloud({
	title,
	subtitle,
	items,
	emptyText = '표시할 태그가 없습니다.',
}: {
	title: string;
	subtitle?: string;
	items: TagCloudItem[];
	emptyText?: string;
}): JSX.Element {
	const maxCount = Math.max(1, ...items.map((item) => Number(item.count || 0)));
	return (
		<section className="card" style={{ display: 'grid', gap: 14 }}>
			<div>
				<h3 style={{ margin: 0, fontSize: 18 }}>{title}</h3>
				{subtitle ? <div style={{ marginTop: 4, color: '#64748b', fontSize: 13 }}>{subtitle}</div> : null}
			</div>
			{items.length > 0 ? (
				<div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
					{items.map((item) => {
						const weight = Math.max(0.08, Number(item.count || 0) / maxCount);
						const fontSize = Math.round(13 + weight * 24);
						const tone = tagTone(item);
						const label = String(item.display_tag || item.tag || '').trim();
						const sentimentLabel = String(item.sentiment_label || '중립').trim();
						const pos = Number(item.positive_count || 0);
						const neg = Number(item.negative_count || 0);
						const neu = Number(item.neutral_count || 0);
						return (
							<span
								key={`${title}-${item.tag}`}
								title={`${label} / ${sentimentLabel} / 전체 ${formatNumber(item.count)} / 리뷰 ${formatNumber(item.review_count)} / Q&A ${formatNumber(item.qna_count)} / 긍정 ${formatNumber(pos)} / 부정 ${formatNumber(neg)} / 중립 ${formatNumber(neu)}`}
								style={{
									display: 'inline-flex',
									alignItems: 'center',
									gap: 6,
									padding: '7px 10px',
									borderRadius: 999,
									background: tone.background,
									border: `1px solid ${tone.border}`,
									color: tone.color,
									fontSize,
									fontWeight: 900,
									lineHeight: 1,
								}}
							>
								{label}
								<small style={{ fontSize: 12, color: '#64748b', fontWeight: 800 }}>{formatNumber(item.count)}</small>
								<small style={{ fontSize: 11, color: tone.color, fontWeight: 900 }}>
									{sentimentLabel}
								</small>
								<small style={{ fontSize: 11, color: '#64748b', fontWeight: 800 }}>
									긍{formatNumber(pos)} 부{formatNumber(neg)}
								</small>
							</span>
						);
					})}
				</div>
			) : (
				<div style={{ color: '#64748b', fontSize: 14 }}>{emptyText}</div>
			)}
		</section>
	);
}

export function ReviewQnaTagCloudView({ apiBaseUrl }: Props): JSX.Element {
	const initialRange = useMemo(() => defaultRange(), []);
	const [fromYmd, setFromYmd] = useState(initialRange.fromYmd);
	const [toYmd, setToYmd] = useState(initialRange.toYmd);
	const [includeReview, setIncludeReview] = useState(true);
	const [includeQna, setIncludeQna] = useState(true);
	const [data, setData] = useState<TagCloudResponse | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		const run = async () => {
			try {
				setLoading(true);
				setError(null);
				const res = await axios.get<TagCloudResponse>(`${apiBaseUrl}/reviews/qna-tag-cloud`, {
					params: {
						from_date: fromYmd,
						to_date: toYmd,
						sources: sourceParam(includeReview, includeQna),
						limit: 100,
					},
				});
				if (!cancelled) setData(res.data);
			} catch (e: any) {
				if (!cancelled) setError(String(e?.response?.data?.detail ?? e?.message ?? '태그 클라우드 분석을 불러오지 못했습니다.'));
			} finally {
				if (!cancelled) setLoading(false);
			}
		};
		run();
		return () => {
			cancelled = true;
		};
	}, [apiBaseUrl, fromYmd, toYmd, includeReview, includeQna]);

	const topSharedTags = useMemo(() => {
		return (data?.combined || []).filter((item) => item.review_count > 0 && item.qna_count > 0).slice(0, 12);
	}, [data]);

	const toggleReview = () => {
		setIncludeReview((prev) => {
			if (prev && !includeQna) return true;
			return !prev;
		});
	};

	const toggleQna = () => {
		setIncludeQna((prev) => {
			if (prev && !includeReview) return true;
			return !prev;
		});
	};

	return (
		<div className="page-shell" style={{ display: 'grid', gap: 16 }}>
			<div className="page-header">
				<div>
					<h1>리뷰/Q&A 태그 클라우드</h1>
					<p>리뷰와 Q&A 원문을 하나의 분석으로 묶고, 필요하면 각 소스별 태그 흐름을 따로 확인합니다.</p>
				</div>
			</div>

			<SalesDateRangeControls
				fromYmd={fromYmd}
				toYmd={toYmd}
				title="분석 기간"
				ariaLabel="review-qna-tag-cloud-date-range"
				onChange={(next) => {
					setFromYmd(next.fromYmd);
					setToYmd(next.toYmd);
				}}
			/>

			<section className="card" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
				<div style={{ fontWeight: 900, marginRight: 8 }}>분석 대상</div>
				<button type="button" className={includeReview ? 'btn-primary' : 'btn-ghost'} onClick={toggleReview}>
					리뷰
				</button>
				<button type="button" className={includeQna ? 'btn-primary' : 'btn-ghost'} onClick={toggleQna}>
					Q&A
				</button>
				<div style={{ color: '#64748b', fontSize: 13 }}>최소 하나는 선택되어야 합니다.</div>
			</section>

			{error ? <div className="card" style={{ color: '#b91c1c', borderColor: 'rgba(185,28,28,0.24)' }}>{error}</div> : null}

			<section className="card" style={{ display: 'grid', gap: 10 }}>
				<div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
					<div><strong>기간</strong> {data?.date_from || fromYmd} ~ {data?.date_to || toYmd}</div>
					<div><strong>리뷰</strong> {formatNumber(data?.source_info.review_rows || 0)}건</div>
					<div><strong>Q&A</strong> {formatNumber(data?.source_info.qna_rows || 0)}건</div>
					<div><strong>상태</strong> {loading ? '분석 중...' : '분석 완료'}</div>
				</div>
				{topSharedTags.length > 0 ? (
					<div style={{ color: '#334155', fontSize: 14 }}>
						리뷰와 Q&A에 함께 등장한 핵심 태그: {topSharedTags.map((item) => item.display_tag || item.tag).join(', ')}
					</div>
				) : (
					<div style={{ color: '#64748b', fontSize: 14 }}>공통 태그는 선택 기간/대상 데이터가 충분할 때 표시됩니다.</div>
				)}
			</section>

			<TagCloud
				title="통합 태그 클라우드"
				subtitle="리뷰와 Q&A를 하나의 분석 결과로 합산합니다."
				items={data?.combined || []}
			/>

			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
				<TagCloud title="리뷰 태그 클라우드" subtitle="리뷰 원문 기준" items={data?.review || []} />
				<TagCloud title="Q&A 태그 클라우드" subtitle="Q&A 문의 원문 기준" items={data?.qna || []} />
			</div>
		</div>
	);
}

export default ReviewQnaTagCloudView;
