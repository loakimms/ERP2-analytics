import React from 'react';

type ContextBarAction = {
	label: string;
	onClick: () => void;
	ariaLabel?: string;
	disabled?: boolean;
	variant?: 'ghost' | 'primary';
};

export function ContextBar({
	contextLines,
	actions,
}: {
	contextLines: string[];
	actions?: ContextBarAction[];
}): JSX.Element | null {
	const visibleLines = (contextLines || []).map((item) => String(item || '').trim()).filter(Boolean);
	const visibleActions = (actions || []).filter((item) => String(item?.label || '').trim());
	if (!visibleLines.length && !visibleActions.length) return null;

	return (
		<div className="review-analysis-actions" style={{ marginTop: 12 }}>
			<div style={{ flex: '1 1 320px', minWidth: 0 }}>
				{visibleLines.map((line) => (
					<div key={line} className="card-caption">
						{line}
					</div>
				))}
			</div>
			{visibleActions.map((action) => (
				<button
					key={`${action.label}-${action.ariaLabel || ''}`}
					type="button"
					className={action.variant === 'primary' ? 'btn-primary' : 'btn-ghost'}
					onClick={action.onClick}
					aria-label={action.ariaLabel}
					disabled={action.disabled}
				>
					{action.label}
				</button>
			))}
		</div>
	);
}
