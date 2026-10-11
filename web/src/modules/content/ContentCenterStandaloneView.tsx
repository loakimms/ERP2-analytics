import React from 'react';

type Props = {
	apiBaseUrl?: string;
	initialTab?: string;
};

export function ContentCenterStandaloneView(_props: Props): JSX.Element {
	return (
		<div style={{ width: '100%', height: 'calc(100vh - 96px)', minHeight: 720, background: '#f8fafc', overflow: 'hidden' }}>
			<iframe
				title="AI 콘텐츠 센터"
				src="/ai-content-center.html"
				style={{ width: '100%', height: '100%', border: 0, display: 'block', background: '#f8fafc' }}
			/>
		</div>
	);
}

export default ContentCenterStandaloneView;
