import type { ContentArtifactLoadProgress } from '../domain/contentArtifactLoadProgress.ts';

const contentArtifactLoadStageLabels = {
	'cache-check': 'OPFS保存データ照合中',
	queue: '取得待ち',
	request: '配信情報取得',
	metadata: '配信情報確認',
	transfer: 'データ取得',
	validate: 'データ検証',
	decode: 'データ展開',
	'scene-build': 'scene構築',
} satisfies Record<ContentArtifactLoadProgress['stage'], string>;

export function contentArtifactLoadStageLabel(
	stage: ContentArtifactLoadProgress['stage'],
): string {
	return contentArtifactLoadStageLabels[stage];
}


const stateLabels: Readonly<Record<string, string>> = {
 prepare: '準備', waiting: '開始待ち', complete: '完了', failed: '失敗', processing: '処理中',
};

export function formatArtifactLoadLabel(label: string): string {
 if (Object.hasOwn(contentArtifactLoadStageLabels, label)) {
  return contentArtifactLoadStageLabel(label as ContentArtifactLoadProgress['stage']);
 }
 return stateLabels[label] ?? label;
}
