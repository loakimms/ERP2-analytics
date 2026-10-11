import React, { useEffect, useState } from 'react';

type ScrollToTopCardProps = {
	scrollParentRef: React.RefObject<HTMLElement | null>;
	thresholdPx?: number;
	resetKey?: string;
};

export function ScrollToTopCard({ scrollParentRef, thresholdPx = 280, resetKey }: ScrollToTopCardProps): JSX.Element | null {
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		const el = scrollParentRef.current;
		if (!el) return undefined;

		const onScroll = () => {
			const viewportThreshold = Math.max(thresholdPx, Math.floor(el.clientHeight * 0.55));
			setVisible(el.scrollTop >= viewportThreshold);
		};
		onScroll();
		el.addEventListener('scroll', onScroll, { passive: true });
		return () => el.removeEventListener('scroll', onScroll);
	}, [scrollParentRef, thresholdPx, resetKey]);

	if (!visible) return null;

	return (
		<button
			type="button"
			className="scroll-to-top-card"
			onClick={() => {
				const el = scrollParentRef.current;
				if (!el) return;
				el.scrollTo({ top: 0, behavior: 'smooth' });
			}}
			aria-label="화면 맨 위로 이동"
			title="맨 위로"
		>
			<span className="scroll-to-top-card-arrow" aria-hidden>
				↑
			</span>
			<span className="scroll-to-top-card-label">맨 위로</span>
		</button>
	);
}
