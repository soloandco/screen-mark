import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const input = process.argv[2] || 'test-results/stability/result.json';
const result = JSON.parse(await readFile(input, 'utf8'));
assert.equal(result.selection, 'all');
assert.equal(result.version, '1.0.3');
assert.ok(result.scenarios.length && result.scenarios.every(item => item.ok), 'Full stability run must pass');
assert.deepEqual(result.pageErrors, []); assert.ok(!result.error);
const directory = 'docs/stability'; await mkdir(directory, { recursive: true });
await writeFile(path.join(directory, 'v1.0.3-after.json'), JSON.stringify(result, null, 2) + '\n');

// Publish useful failure messages without local stack paths or machine account names.
function publicEvidence(value) {
  if (Array.isArray(value)) return value.map(publicEvidence);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'error' && typeof item === 'string' ? item.split('\n')[0] : publicEvidence(item)]));
  return value;
}
if (process.argv[3]) {
  const before = publicEvidence(JSON.parse(await readFile(process.argv[3], 'utf8')));
  assert.equal(before.version, '1.0.2'); assert.equal(before.scenarios.filter(item => !item.ok).length, 2);
  await writeFile(path.join(directory, 'v1.0.2-before.json'), JSON.stringify(before, null, 2) + '\n');
}
if (process.argv[4]) {
  const intermediate = publicEvidence(JSON.parse(await readFile(process.argv[4], 'utf8')));
  intermediate.stage = 'Working tree after atomic-save fix, before unsaved replacement confirmation';
  await writeFile(path.join(directory, 'replacement-before.json'), JSON.stringify(intermediate, null, 2) + '\n');
}
const labels = new Map([
  ['12 alternating visible/full captures keep source pixels and restore the page', '두 원본 탭의 연속 캡처·색상·크기·페이지 복원'],
  ['three independent editor tabs survive rapid saves, repeated copy and reload', '세 편집 탭의 연속 저장·복사·새로고침'],
  ['replacing long and small images repeatedly clears the previous image and labels', '긴 이미지와 작은 이미지의 반복 교체·복사'],
  ['duplicate editor cannot silently overwrite a newer save from another tab', '같은 작업의 저장 충돌·복사 복구·교체 취소와 승인'],
  ['recent edits keep an older capture alive during temporary cleanup', '오래된 캡처의 최근 편집 보존'],
  ['atomic document revisions reject simultaneous stale writers and missing records', '동시 저장의 버전 검사·삭제된 작업 보호'],
  ['temporary cleanup supports legacy timestamps and removes only inactive records', '기존 데이터 호환·비활성 작업 정리'],
  ['image replacement freezes edits until the old save queue and decode finish', '파일 교체 로딩 중 이전 작업 편집 차단'],
  ['overlapping capture is rejected and switching source tabs restores and unlocks capture', '캡처 중 탭 전환 취소·잠금 해제·재시도'],
  ['idle extension worker restart preserves edits and permits another capture', '유휴 worker 재시작 후 편집 복원·새 캡처']
]);
const table = result.scenarios.map(item => { assert.ok(labels.has(item.name), item.name); return `| ${labels.get(item.name)} | 통과 |`; }).join('\n');
const text = `# Screen Mark v1.0.3 안정성 검증

검증일: ${result.date} (KST). ${result.environment.chrome.product}의 별도 headless 프로필에서 실제 확장을 실행했다. 사용자 Chrome 프로필과 개인 웹페이지는 열지 않았다.

## 발견하고 수정한 결함

1. **같은 캡처를 두 편집 탭에서 열면 저장본을 덮어씀.** 각 탭이 가진 이전 표시 목록을 그대로 저장하던 문제였다. 단일 IndexedDB 쓰기 트랜잭션에서 문서 버전을 확인하고 저장하도록 변경했다. 충돌한 탭의 후속 저장도 차단하며, 로컬 표시는 파일 저장·복사로 보관할 수 있다.
2. **생성 후 하루가 지난 캡처는 방금 편집했어도 삭제됨.** 마지막 저장 시각을 기록하고, 정리 트랜잭션 안에서 그 시각을 확인해 비활성 작업만 삭제하도록 변경했다. 기존 데이터는 생성 시각을 기준으로 호환한다.
3. **자동 저장 실패 후 새 파일을 열면 로컬 표시가 확인 없이 사라짐.** 미저장 작업을 버릴지 확인하며, 취소하면 그대로 유지한다. 파일 교체 중에는 이전 문서 변경을 막아 저장 큐와 이미지 교체 사이의 충돌도 방지한다.

첫 두 결함은 v1.0.2의 실제 Chrome 재현 검사에서 모두 실패했다. [수정 전 기록](stability/v1.0.2-before.json), [파일 교체 추가 재현 기록](stability/replacement-before.json), [수정 후 전체 기록](stability/v1.0.3-after.json)을 공개한다. 실패 기록에서는 개인 PC의 스택 경로를 제외하고 실패 메시지를 남겼다.

## 실행 결과

전체 ${result.scenarios.length}개 시나리오 통과, page error ${result.pageErrors.length}개. 실제 캡처 ${result.operations.captures}회, 실제 클립보드 쓰기 ${result.operations.copies}회, 번호 추가 입력 ${result.operations.rapidEdits}회를 실행했다. 입력 횟수에는 충돌 후 로컬 편집도 포함하며, 저장 성공 횟수를 뜻하지 않는다.

| 검사 | 결과 |
|---|---|
${table}

- 두 색상의 원본 탭에서 현재 화면 8회·전체 페이지 4회 캡처 후 실제 PNG의 픽셀과 해상도를 검사했다. 취소 후 재시도와 worker 재시작 후 캡처도 별도로 수행했다.
- 독립 편집 탭 세 개에서 네 차례씩 번호를 추가하고, 실제 복사 24회와 새로고침 12회 후 표시·번호를 대조했다.
- 1600 × 10000px 이미지와 작은 이미지를 네 차례 번갈아 교체하고 PNG 색상·해상도와 표시 초기화를 검사했다.
- 같은 버전의 동시 저장 두 건 중 하나만 성공하고, 나머지는 충돌로 거절되는지 확인했다. 충돌 후 추가 입력 여덟 건이 다른 탭의 저장본을 덮어쓰지 않으며 복사·새로고침 후 정상 저장으로 복구되는지 확인했다.
- 미저장 상태의 파일 교체를 취소하면 로컬 표시 열 개가 유지되고, 명시적으로 승인하면 새 이미지로 교체되는지 검사했다. 디코딩을 잠시 멈춘 동안 실행 취소와 번호 입력이 이전 문서를 변경하지 않는지도 확인했다.
- 캡처의 두 번째 스크롤 뒤 다른 탭으로 전환했다. 중복 캡처 거절, 원래 스크롤·fixed·sticky 복원과 후속 캡처 성공을 확인했다.

## 범위와 재현

한 번에 정해진 작업을 반복하는 기능·동시성 검사다. 24시간 실제 연속 실행이나 메모리 누수 부재를 입증한 것은 아니다. 오래된 작업은 생성 시각을 25시간 전으로 설정해 경계 조건을 재현했다. worker 검사는 유휴 상태의 종료와 재시작이며 캡처 도중 강제 종료 검사는 아니다.

캡처·PNG 다운로드·클립보드는 실제 API를 사용했다. 빠른 편집 입력은 포인터 이벤트로 전달했고, 충돌 시점과 디코딩 중 대기만 테스트에서 제어했다. v1.0.2의 [성능 보고서](performance.md)는 그 버전의 과거 측정이며 v1.0.3의 새 성능 측정으로 간주하지 않는다.

Node.js 22 이상과 설치된 Google Chrome이 있는 환경에서 실행한다.

\`\`\`sh
npm ci
npm run test:stability
node scripts/stability-report.mjs test-results/stability/result.json
\`\`\`

원시 실행 결과는 test-results/stability/result.json에 저장된다. 보고서 생성기는 전체 시나리오 통과와 page error 부재를 확인하고 숫자를 원시 결과에서 계산한다. 최초 실패 기록을 함께 생성하려면 세 번째·네 번째 인자로 해당 JSON 파일을 전달한다.
`;
await writeFile('docs/stability.md', text);
console.log(JSON.stringify({ ok: true, scenarios: result.scenarios.length, operations: result.operations, version: result.version }));
