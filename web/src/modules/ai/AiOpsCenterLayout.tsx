import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { buildAiOpsPathWithActionBucket } from '../../shared/navigation/analyticsNavigation';
import { labelAiOpsActionBucket } from '../../shared/presentation/analyticsLabels';
import { ContextBar } from '../../shared/ui/ContextBar';
import type { QuickLink } from './AiOpsCommonTypes';
import type { AiOpsDecisionCard } from './AiOpsDecisionCardTypes';

function QuickLinkButton(props: QuickLink): JSX.Element {
	const navigate = useNavigate();
	return (
		<button type="button" className="btn-ghost" onClick={() => navigate(props.path)} data-testid={props.testId}>
			{props.label}
		</button>
	);
}

export function MiniKpiCard(props: {
	label: string;
	value: string;
	caption: string;
	tone?: 'neutral' | 'warn' | 'good' | 'bad';
}): JSX.Element {
	const tone = props.tone ?? 'neutral';
	const accent =
		tone === 'good'
			? '#86efac'
			: tone === 'warn'
				? '#fde68a'
				: tone === 'bad'
					? '#fda4af'
					: '#93c5fd';
	return (
		<div className="card" style={{ padding: 12 }}>
			<div className="card-caption">{props.label}</div>
			<div style={{ fontSize: 22, fontWeight: 900, color: accent, marginTop: 8 }}>{props.value}</div>
			<div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>{props.caption}</div>
		</div>
	);
}

export function FocusCard(props: {
	title: string;
	description: string;
	bullets: string[];
	links?: QuickLink[];
}): JSX.Element {
	return (
		<div className="card" style={{ padding: 14 }}>
			<div className="card-title">{props.title}</div>
			<div className="card-caption" style={{ marginTop: 6 }}>
				{props.description}
			</div>
			<ul style={{ marginTop: 10, paddingLeft: 18, color: '#cbd5e1', fontSize: 13 }}>
				{props.bullets.map((bullet) => (
					<li key={bullet} style={{ marginBottom: 6 }}>
						{bullet}
					</li>
				))}
			</ul>
			{props.links?.length ? (
				<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
					{props.links.map((link) => (
						<QuickLinkButton key={`${props.title}:${link.path}`} {...link} />
					))}
				</div>
			) : null}
		</div>
	);
}

export function VerificationPathCard(props: {
	sourceLink: QuickLink;
	sourceAriaLabel?: string;
	queueLink?: QuickLink | null;
	queueAriaLabel?: string;
	logsLink?: QuickLink | null;
	logsAriaLabel?: string;
	currentStep?: 'source' | 'actions' | 'logs';
}): JSX.Element {
	const navigate = useNavigate();
	const actions: Array<{ id: 'source' | 'actions' | 'logs'; link: QuickLink; ariaLabel?: string }> = [
		{ id: 'source', link: props.sourceLink, ariaLabel: props.sourceAriaLabel },
		...(props.queueLink ? [{ id: 'actions' as const, link: props.queueLink, ariaLabel: props.queueAriaLabel }] : []),
		...(props.logsLink ? [{ id: 'logs' as const, link: props.logsLink, ariaLabel: props.logsAriaLabel }] : []),
	];

	return (
		<div
			style={{
				marginTop: 10,
				padding: 10,
				borderRadius: 10,
				border: '1px solid rgba(148,163,184,0.18)',
				background: 'rgba(2,6,23,0.35)',
			}}
		>
			<div className="card-caption">검증 경로</div>
			<div style={{ marginTop: 6, fontSize: 12, color: '#94a3b8' }}>원천 분석에서 실행 큐, 검증 로그까지 같은 컨텍스트로 이동합니다.</div>
			<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
				{actions.map(({ id, link, ariaLabel }) => {
					const isCurrent = props.currentStep === id;
					return (
						<button
							key={`${id}:${link.path}`}
							type="button"
							className="btn-ghost"
							aria-label={ariaLabel}
							onClick={() => navigate(link.path)}
							style={{
								border: isCurrent ? '1px solid rgba(250,204,21,0.45)' : undefined,
								color: isCurrent ? '#fcd34d' : undefined,
							}}
						>
							{link.label}
						</button>
					);
				})}
			</div>
		</div>
	);
}

export function AiOpsDecisionCardPanel(props: {
	card: AiOpsDecisionCard;
	badgeColor?: string;
	summaryColor?: string;
	note?: React.ReactNode;
	extraContent?: React.ReactNode;
	actions?: React.ReactNode;
}): JSX.Element {
	return (
		<div
			style={{
				border: '1px solid rgba(148,163,184,0.18)',
				borderRadius: 10,
				padding: 12,
				background: 'rgba(15,23,42,0.35)',
			}}
		>
			<div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
				<div style={{ fontWeight: 800 }}>{props.card.title}</div>
				<div style={{ fontSize: 12, color: props.badgeColor || '#93c5fd' }}>{props.card.badgeLabel}</div>
			</div>
			{props.card.contextLine ? (
				<div style={{ marginTop: 6, fontSize: 12, color: '#94a3b8' }}>{props.card.contextLine}</div>
			) : null}
			<div style={{ marginTop: 6, fontSize: 12, color: props.summaryColor || '#fcd34d' }}>{props.card.summary}</div>
			<div style={{ marginTop: 6, fontSize: 12, color: '#86efac' }}>권장 액션: {props.card.recommendedAction}</div>
			{props.card.metrics.length ? (
				<div style={{ marginTop: 6, fontSize: 12, color: '#cbd5e1' }}>
					{props.card.metrics.map((metric, metricIndex) => (
						<React.Fragment key={`${props.card.id}:${metric.label}`}>
							{metricIndex > 0 ? ' / ' : ''}
							{metric.label} {metric.value}
						</React.Fragment>
					))}
				</div>
			) : null}
			{props.note ? <div style={{ marginTop: 6, fontSize: 12, color: '#93c5fd' }}>{props.note}</div> : null}
			{props.extraContent ? <div style={{ marginTop: 10 }}>{props.extraContent}</div> : null}
			{props.actions ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>{props.actions}</div> : null}
		</div>
	);
}

type AiOpsFlowStage = 'home' | 'analysis' | 'actions' | 'logs' | 'policies';

type AiOpsFlowStep = {
	id: AiOpsFlowStage;
	label: string;
	description: string;
	path: string;
	testId: string;
};

const AI_OPS_FLOW_STEPS: AiOpsFlowStep[] = [
	{ id: 'home', label: '1. 오늘의 실행', description: '오늘 바로 볼 우선순위', path: '/analytics/ai/home', testId: 'ai-ops-flow-step-home' },
	{ id: 'analysis', label: '2. 판단 생성', description: '상품·광고·판매·VOC 분석', path: '/analytics/ai/products', testId: 'ai-ops-flow-step-analysis' },
	{ id: 'actions', label: '3. 실행 큐', description: '사람 검토와 승인 대기열', path: '/analytics/ai/actions', testId: 'ai-ops-flow-step-actions' },
	{ id: 'logs', label: '4. 검증 로그', description: '근거와 결과 추적', path: '/analytics/ai/logs', testId: 'ai-ops-flow-step-logs' },
	{ id: 'policies', label: '5. 정책 학습', description: '정책팩과 운영 기준 고정', path: '/analytics/ai/policies', testId: 'ai-ops-flow-step-policies' },
];

function resolveAiOpsFlowStage(pathname: string, title: string): AiOpsFlowStage {
	if (pathname === '/analytics/ai/home') return 'home';
	if (
		pathname === '/analytics/ai/products' ||
		pathname === '/analytics/ai/ads' ||
		pathname === '/analytics/ai/sales' ||
		pathname === '/analytics/ai/reviews' ||
		pathname === '/analytics/ai/qna' ||
		pathname === '/analytics/ai/trends' ||
		pathname === '/analytics/ai/organic-rank'
	) {
		return 'analysis';
	}
	if (pathname === '/analytics/ai/actions') return 'actions';
	if (pathname === '/analytics/ai/logs' || pathname === '/analytics/ai/organic-rank/trace') return 'logs';
	if (pathname === '/analytics/ai/policies') return 'policies';

	if (title === '오늘의 실행') return 'home';
	if (
		title === '상품별 운영 판단' ||
		title === '광고 운영 판단' ||
		title === '판매·전환 판단' ||
		title === '리뷰·VOC 판단' ||
		title === 'Q&A 전환장벽 판단' ||
		title === '수요·트렌드 판단'
	) {
		return 'analysis';
	}
	if (title === '실행 큐') return 'actions';
	if (title === '검증/설명 로그') return 'logs';
	return 'policies';
}

function buildAiOpsFlowContextLines(stage: AiOpsFlowStage, title: string): string[] {
	switch (stage) {
		case 'home':
			return [`현재 단계: 오늘의 실행 - ${title}`, '다음 권장: 판단 화면에서 상품, 광고, 판매 이슈를 구체 액션 후보로 좁히세요.'];
		case 'analysis':
			return [`현재 단계: 판단 생성 - ${title}`, '다음 권장: 실행 큐로 보내기 전, 어떤 버킷이 즉시 실행 대상인지 먼저 확인하세요.'];
		case 'actions':
			return [`현재 단계: 실행 큐 - ${title}`, '다음 권장: 승인 또는 반려 후 검증 로그에서 실제 결과를 추적하세요.'];
		case 'logs':
			return [`현재 단계: 검증 로그 - ${title}`, '다음 권장: 반복 개선되는 패턴은 정책 학습 단계로 승격해 장기 운영 기준으로 고정하세요.'];
		case 'policies':
			return [`현재 단계: 정책 학습 - ${title}`, '다음 권장: 정책팩 비교 결과를 실행 큐에 연결하고, 검증 로그로 효과를 확인하세요.'];
	}
}

function buildAiOpsFlowQuickLinks(stage: AiOpsFlowStage): QuickLink[] {
	switch (stage) {
		case 'home':
			return [
				{ label: '상품 판단', path: '/analytics/ai/products', testId: 'ai-ops-flow-quicklink-products' },
				{ label: '광고 판단', path: '/analytics/ai/ads', testId: 'ai-ops-flow-quicklink-ads' },
				{ label: '판매 판단', path: '/analytics/ai/sales', testId: 'ai-ops-flow-quicklink-sales' },
				{ label: '실행 큐', path: '/analytics/ai/actions', testId: 'ai-ops-flow-quicklink-actions' },
				{ label: '검증 로그', path: '/analytics/ai/logs', testId: 'ai-ops-flow-quicklink-logs' },
			];
		case 'analysis':
			return [
				{ label: '상품 판단', path: '/analytics/ai/products', testId: 'ai-ops-flow-quicklink-products' },
				{ label: '광고 판단', path: '/analytics/ai/ads', testId: 'ai-ops-flow-quicklink-ads' },
				{ label: '판매 판단', path: '/analytics/ai/sales', testId: 'ai-ops-flow-quicklink-sales' },
				{ label: '리뷰·VOC', path: '/analytics/ai/reviews', testId: 'ai-ops-flow-quicklink-reviews' },
				{ label: 'Q&A 판단', path: '/analytics/ai/qna', testId: 'ai-ops-flow-quicklink-qna' },
				{ label: '수요·트렌드', path: '/analytics/ai/trends', testId: 'ai-ops-flow-quicklink-trends' },
				{ label: '오가닉 A-1', path: '/analytics/ai/organic-rank', testId: 'ai-ops-flow-quicklink-organic-rank' },
			];
		case 'actions':
			return [
				{ label: '실행 큐', path: '/analytics/ai/actions', testId: 'ai-ops-flow-quicklink-actions' },
				{ label: '검증 로그', path: '/analytics/ai/logs', testId: 'ai-ops-flow-quicklink-logs' },
				{ label: 'SKU 정책 센터', path: '/analytics/ai/policies', testId: 'ai-ops-flow-quicklink-policies' },
			];
		case 'logs':
			return [
				{ label: '검증 로그', path: '/analytics/ai/logs', testId: 'ai-ops-flow-quicklink-logs' },
				{ label: 'A-1 Trace', path: '/analytics/ai/organic-rank/trace', testId: 'ai-ops-flow-quicklink-organic-trace' },
				{ label: '실행 큐', path: '/analytics/ai/actions', testId: 'ai-ops-flow-quicklink-actions' },
				{ label: 'SKU 정책 센터', path: '/analytics/ai/policies', testId: 'ai-ops-flow-quicklink-policies' },
			];
		case 'policies':
			return [
				{ label: 'SKU 정책 센터', path: '/analytics/ai/policies', testId: 'ai-ops-flow-quicklink-policies' },
				{ label: '오늘의 실행', path: '/analytics/ai/home', testId: 'ai-ops-flow-quicklink-home' },
				{ label: '실행 큐', path: '/analytics/ai/actions', testId: 'ai-ops-flow-quicklink-actions' },
				{ label: '검증 로그', path: '/analytics/ai/logs', testId: 'ai-ops-flow-quicklink-logs' },
			];
	}
}

export function AiOpsPageShell(props: {
	title: string;
	description: string;
	children: React.ReactNode;
}): JSX.Element {
	const location = useLocation();
	const navigate = useNavigate();
	const currentStage = React.useMemo(() => resolveAiOpsFlowStage(location.pathname, props.title), [location.pathname, props.title]);
	const contextLines = React.useMemo(() => buildAiOpsFlowContextLines(currentStage, props.title), [currentStage, props.title]);
	const quickLinks = React.useMemo(() => buildAiOpsFlowQuickLinks(currentStage), [currentStage]);

	return (
		<div style={{ display: 'grid', gap: 12 }}>
			<div className="card" style={{ padding: 14 }}>
				<div className="card-title">운영 플로우</div>
				<div className="card-caption" style={{ marginTop: 6 }}>
					오늘의 실행부터 정책 학습까지, 같은 기준으로 판단하고 검증하는 흐름입니다.
				</div>
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8, marginTop: 12 }}>
					{AI_OPS_FLOW_STEPS.map((step) => {
						const isCurrent = step.id === currentStage;
						return (
							<button
								key={step.id}
								type="button"
								className="btn-ghost"
								onClick={() => navigate(step.path)}
								data-testid={step.testId}
								style={{
									padding: 12,
									borderRadius: 10,
									textAlign: 'left',
									border: isCurrent ? '1px solid rgba(250,204,21,0.45)' : '1px solid rgba(148,163,184,0.18)',
									background: isCurrent ? 'rgba(120,53,15,0.2)' : 'rgba(15,23,42,0.35)',
									color: isCurrent ? '#fcd34d' : '#e2e8f0',
								}}
							>
								<div style={{ fontWeight: 800, fontSize: 13 }}>{step.label}</div>
								<div style={{ marginTop: 6, fontSize: 12, color: isCurrent ? '#fde68a' : '#94a3b8' }}>{step.description}</div>
							</button>
						);
					})}
				</div>
				<ContextBar contextLines={contextLines} />
				<div style={{ marginTop: 12 }}>
					<div className="card-caption">빠른 이동</div>
					<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
						{quickLinks.map((link) => (
							<QuickLinkButton key={`flow:${link.path}`} {...link} />
						))}
					</div>
				</div>
			</div>
			<div className="card" style={{ padding: 14 }}>
				<div className="card-title">{props.title}</div>
				<div className="card-caption" style={{ marginTop: 6 }}>
					{props.description}
				</div>
				<div style={{ marginTop: 12 }}>{props.children}</div>
			</div>
		</div>
	);
}

export function ActionBucketFilterBar(props: {
	selectedActionBucket: string;
	currentPath: string;
	showHomeLink?: boolean;
}): JSX.Element | null {
	const navigate = useNavigate();
	if (!props.selectedActionBucket) return null;
	const peerLinks: QuickLink[] = [
		{ label: '광고 운영 판단으로 이동', path: '/analytics/ai/ads' },
		{ label: '판매·전환 판단으로 이동', path: '/analytics/ai/sales' },
		{ label: '실행 큐로 이동', path: '/analytics/ai/actions' },
		{ label: '검증 로그로 이동', path: '/analytics/ai/logs' },
	].filter((link) => link.path !== props.currentPath);
	return (
		<ContextBar
			contextLines={[`현재 필터: ${labelAiOpsActionBucket(props.selectedActionBucket)}`]}
			actions={[
				{ label: '필터 해제', onClick: () => navigate(props.currentPath) },
				...(props.showHomeLink === false
					? []
					: [
							{
								label: '홈으로 돌아가기',
								onClick: () => navigate(buildAiOpsPathWithActionBucket('/analytics/ai/home', props.selectedActionBucket)),
							},
					  ]),
				...peerLinks.map((link) => ({
					label: link.label,
					onClick: () => navigate(buildAiOpsPathWithActionBucket(link.path, props.selectedActionBucket)),
				})),
			]}
		/>
	);
}
