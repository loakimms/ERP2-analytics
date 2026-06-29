import React from 'react';

export function AiOpsSurfacePanel(props: {
	children: React.ReactNode;
	borderColor?: string;
	background?: string;
	padding?: number;
}): JSX.Element {
	return (
		<div
			style={{
				border: `1px solid ${props.borderColor || 'rgba(148,163,184,0.18)'}`,
				borderRadius: 10,
				padding: props.padding ?? 12,
				background: props.background || 'rgba(15,23,42,0.35)',
			}}
		>
			{props.children}
		</div>
	);
}

export function AiOpsMetricTile(props: { label: string; value: string }): JSX.Element {
	return (
		<div className="card" style={{ padding: 10 }}>
			<div className="card-caption">{props.label}</div>
			<div style={{ marginTop: 6, fontWeight: 800 }}>{props.value}</div>
		</div>
	);
}
