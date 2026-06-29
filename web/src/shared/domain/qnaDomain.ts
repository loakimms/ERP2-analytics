import type { AnalyticsQnaSection } from '../navigation/analyticsNavigation';

export function qnaStatusClassName(status: string | null | undefined): string {
	const value = String(status || '').trim();
	if (value === 'submitted' || value === 'answered') return 'is-completed';
	if (value === 'approved') return 'is-approved';
	if (value === 'generated') return 'is-pending';
	if (value === 'failed' || value === 'rejected') return 'is-rejected';
	return 'is-new';
}

export function resolveQnaGuideSection(guide: { title?: string | null; target_area?: string | null }): AnalyticsQnaSection {
	const target = `${String(guide.title || '')} ${String(guide.target_area || '')}`.toLowerCase();
	if (target.includes('faq') || target.includes('상세페이지')) return 'faq';
	if (target.includes('상품 개선') || target.includes('품질')) return 'quality';
	if (target.includes('광고') || target.includes('마케팅')) return 'marketing';
	if (target.includes('전환') || target.includes('랜딩')) return 'conversion';
	return 'summary';
}
