import { expect, test } from 'bun:test';
import { browserArtifactHttpError } from '../../src/application/browserArtifactHttpError.ts';

test('artifact HTTP失敗へstatus、URL、response bodyを保持する', async () => {
	const error = await browserArtifactHttpError({
		status: 502,
		url: 'https://example.test/assets/metadata',
		text: async () => '{"error":"Decoder worker failed"}',
	});
	expect(error.message).toBe(
		'Browser artifact request failed: status=502; url=https://example.test/assets/metadata; body={"error":"Decoder worker failed"}',
	);
});
