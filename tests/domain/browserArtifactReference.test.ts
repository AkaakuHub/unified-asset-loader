import { expect, test } from 'bun:test';
import { locallyMaterializedBrowserArtifactReference } from '../../src/domain/browserArtifactReference.ts';

test('catalog参照へ呼出元固有fieldを保存しない', () => {
	const catalogEntry = {
		assetPath: 'models/example.glb',
		checksum: 'source-checksum',
		size: 534414,
		label: 'example-texture',
		dependencies: ['textures/example.png'],
		contentNames: ['emoji'],
		archiveId: 'archive-id',
	};

	expect(locallyMaterializedBrowserArtifactReference(catalogEntry)).toEqual({
		assetPath: 'models/example.glb',
		checksum: 'source-checksum',
		size: 534414,
		url: null,
	});
});
