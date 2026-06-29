import React from 'react';
import { CategoryPickerManual } from '../research/CategoryPickerManual';

export function SeoCategoryDictionarySettingsView(props: { apiBaseUrl: string }): JSX.Element {
	return (
		<div style={{ display: 'grid', gap: 14 }}>
			<div className="card">
				<div className="card-title">카테고리 사전</div>
				<div className="card-caption">상품명 SEO(5-1)에서 사용할 카테고리 사전을 관리합니다.</div>
				<div style={{ marginTop: 10 }}>
					{/* 설정 화면에서는 "첨부 → 저장" 흐름이 필요하므로 importMode=manual */}
					<CategoryPickerManual
						apiBaseUrl={props.apiBaseUrl}
						value={null}
						onChange={() => {}}
						showSearchTab={false}
						showPickTab={false}
						showDictionaryManager
						showDictionaryStatusList
						importMode="manual"
					/>
				</div>
			</div>
		</div>
	);
}

