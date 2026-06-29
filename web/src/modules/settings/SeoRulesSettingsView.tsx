import React, { useEffect, useMemo, useState } from 'react';
import {
	loadSeoRules,
	serializeStopwordsToText,
	serializeSynonymGroupsToText,
	parseStopwordsFromText,
	parseSynonymGroupsFromText,
	type SeoRules,
} from '../research/seoOptimizerRules';

export function SeoRulesSettingsView(): JSX.Element {
	const [seoRules, setSeoRules] = useState<SeoRules>(() => loadSeoRules());
	const [stopwordsText, setStopwordsText] = useState(() => serializeStopwordsToText(loadSeoRules().stopwords));
	const [synonymsText, setSynonymsText] = useState(() => serializeSynonymGroupsToText(loadSeoRules().synonymGroups));
	const [savedToast, setSavedToast] = useState<string | null>(null);

	useEffect(() => {
		if (!savedToast) return;
		const t = window.setTimeout(() => setSavedToast(null), 1600);
		return () => window.clearTimeout(t);
	}, [savedToast]);

	const maxChars = useMemo(() => seoRules.maxChars ?? 25, [seoRules.maxChars]);

	const applyRules = (): void => {
		const next: SeoRules = {
			...seoRules,
			stopwords: parseStopwordsFromText(stopwordsText),
			synonymGroups: parseSynonymGroupsFromText(synonymsText),
			maxChars: 25,
		};
		try {
			localStorage.setItem('seoRules.v1', JSON.stringify(next));
		} catch {
			// ignore
		}
		setSeoRules(next);
		setSavedToast('저장 완료');
		try {
			window.dispatchEvent(new CustomEvent('seo:rules-updated'));
		} catch {
			// ignore
		}
	};

	const resetRules = (): void => {
		const base = loadSeoRules();
		setSeoRules(base);
		setStopwordsText(serializeStopwordsToText(base.stopwords));
		setSynonymsText(serializeSynonymGroupsToText(base.synonymGroups));
		try {
			localStorage.setItem('seoRules.v1', JSON.stringify(base));
		} catch {
			// ignore
		}
		setSavedToast('초기값 복원');
		try {
			window.dispatchEvent(new CustomEvent('seo:rules-updated'));
		} catch {
			// ignore
		}
	};

	return (
		<div style={{ display: 'grid', gap: 14 }}>
			<div className="card">
				<div className="card-title">SEO 규칙 등록</div>
				<div className="card-caption">
					전환 목표 기준으로 <b>금칙어는 완전 배제</b>하고, <b>동의어는 대표어로 통합</b>해 반복/과잉을 방지합니다. (글자수 제한: {maxChars}자)
				</div>
			</div>

			<div className="card">
				<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
					<div>
						<div className="card-title">규칙 편집</div>
						<div className="card-caption">저장하면 즉시 상품명 SEO(5-1)에 반영됩니다.</div>
					</div>
					<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
						{savedToast ? <span style={{ fontSize: 12, fontWeight: 900, color: '#bbf7d0' }}>{savedToast}</span> : null}
						<button type="button" className="btn-primary" onClick={applyRules}>
							저장
						</button>
						<button type="button" className="btn-ghost" onClick={resetRules}>
							초기값 복원
						</button>
					</div>
				</div>

				<div style={{ display: 'grid', gap: 12, marginTop: 10 }}>
					<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
						<div>
							<label className="field-label" htmlFor="seo-stopwords">
								금칙어(1줄 1단어) - 조합/후보/토큰에서 완전 배제
							</label>
							<textarea
								id="seo-stopwords"
								className="input"
								style={{ minHeight: 180, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
								value={stopwordsText}
								onChange={(e) => setStopwordsText(e.target.value)}
							/>
							<div style={{ fontSize: 12, color: '#9ca3af', fontWeight: 800, marginTop: 6 }}>
								팁: “무료배송/당일/특가/최저가/쿠폰/1+1…” 같은 프로모션성 단어를 넣어두면 조합 품질이 즉시 안정됩니다.
							</div>
						</div>

						<div>
							<label className="field-label" htmlFor="seo-synonyms">
								동의어 그룹(대표어=첫 줄, 이후 줄=동의어)
							</label>
							<textarea
								id="seo-synonyms"
								className="input"
								style={{ minHeight: 180, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
								value={synonymsText}
								onChange={(e) => setSynonymsText(e.target.value)}
							/>
							<div style={{ fontSize: 12, color: '#9ca3af', fontWeight: 800, marginTop: 6 }}>
								형식 예: 첫 줄에 대표어, 다음 줄에 동의어를 적고 빈 줄로 그룹을 구분합니다.
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

