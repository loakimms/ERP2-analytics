import { describe, expect, it } from 'vitest';
import { isTransientPollingError } from './networkDomain';

describe('networkDomain', () => {
	it('일시적 polling 오류를 감지한다', () => {
		expect(isTransientPollingError({ code: 'ECONNABORTED' })).toBe(true);
		expect(isTransientPollingError({ code: 'err_network' })).toBe(true);
		expect(isTransientPollingError({ response: { status: 503 } })).toBe(true);
		expect(isTransientPollingError({ message: 'network timeout while polling' })).toBe(true);
		expect(isTransientPollingError({ response: { status: 400 }, message: 'validation failed' })).toBe(false);
	});
});
