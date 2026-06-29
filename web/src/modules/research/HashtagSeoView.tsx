import React from 'react';
import { HashtagSeoSettingsView } from './HashtagSeoSettingsView';

type SavedHashtagSet = {
	id: string;
	title: string;
	tags: string[];
	createdAt: string;
};

const LS_HASHTAG_SETS_KEY = 'seoHashtagSets.v1';

function safeJsonParse<T>(s: string | null, fallback: T): T {
	try {
		if (!s) return fallback;
		return JSON.parse(s) as T;
	} catch {
		return fallback;
	}
}

export function HashtagSeoView(props: { apiBaseUrl: string }): JSX.Element {
	return <HashtagSeoSettingsView apiBaseUrl={props.apiBaseUrl} />;
}




